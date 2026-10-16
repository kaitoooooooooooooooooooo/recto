<?php
// Recto — API : comptes (inscription, connexion) et listes de cartes enregistrées.
// Appel : api/index.php?r=sets (en-tête X-Recto: 1 et JSON pour tout ce qui écrit).
declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$route = (string) ($_GET['r'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    // En ligne, uniquement en HTTPS : sinon les mots de passe circuleraient en clair.
    if (!is_local() && !is_https()) fail(403, 'https_required');
    if ($method !== 'GET') require_app_request();
    match ("$method $route") {
        'GET me' => ok(['user' => ($u = current_user()) ? public_user($u) : null]),
        'POST register' => register(body()),
        'POST login' => login(body()),
        'POST logout' => (function () { end_session(); ok(); })(),
        'GET sets' => list_sets(),
        'PUT set' => save_set(body()),
        'POST set/delete' => delete_set(body()),
        'POST account/delete' => delete_account(body()),
        default => fail(404, 'not_found'),
    };
} catch (Throwable $e) {
    error_log('[recto] ' . $e->getMessage());
    fail(500, 'server_error');
}

function password_algo(): string|int|null {
    return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
}

function register(array $in): never {
    if (too_many('register:' . client_key(), 10, 3600)) fail(429, 'rate_limited');
    $username = trim((string) ($in['username'] ?? ''));
    $email = mb_strtolower(trim((string) ($in['email'] ?? '')));
    $pass = (string) ($in['password'] ?? '');
    $errors = [];
    if (!preg_match('/^[A-Za-z0-9_.-]{3,20}$/', $username)) $errors['username'] = 'username_invalid';
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) $errors['email'] = 'email_invalid';
    if (mb_strlen($pass) < 8) $errors['password'] = 'password_short';
    elseif (mb_strlen($pass) > 200) $errors['password'] = 'password_long';
    elseif (in_array(mb_strtolower($pass), [mb_strtolower($username), $email], true)) $errors['password'] = 'password_weak';
    if (!isset($errors['username'])) {
        $st = db()->prepare('SELECT 1 FROM users WHERE username_lc = ?');
        $st->execute([mb_strtolower($username)]);
        if ($st->fetchColumn()) $errors['username'] = 'username_taken';
    }
    if (!isset($errors['email'])) {
        $st = db()->prepare('SELECT 1 FROM users WHERE email = ?');
        $st->execute([$email]);
        if ($st->fetchColumn()) $errors['email'] = 'email_taken';
    }
    if ($errors) fail(422, 'invalid', ['fields' => $errors]);
    note_attempt('register:' . client_key());
    db()->prepare('INSERT INTO users (username, username_lc, email, pass, created) VALUES (?, ?, ?, ?, ?)')
        ->execute([$username, mb_strtolower($username), $email, password_hash($pass, password_algo()), time()]);
    $id = (int) db()->lastInsertId();
    start_session($id);
    ok(['user' => ['username' => $username, 'email' => $email, 'created' => time() * 1000]]);
}

function login(array $in): never {
    $ident = mb_strtolower(trim((string) ($in['login'] ?? '')));
    $pass = (string) ($in['password'] ?? '');
    $ipKey = 'login-ip:' . client_key();
    $idKey = 'login-id:' . substr(hash('sha256', $ident), 0, 24);
    // 20 essais par quart d'heure et par appareil, 8 par compte : freine le forçage de mot de passe.
    if (too_many($ipKey, 20, 900) || too_many($idKey, 8, 900)) fail(429, 'rate_limited');
    $st = db()->prepare('SELECT * FROM users WHERE email = ? OR username_lc = ?');
    $st->execute([$ident, $ident]);
    $u = $st->fetch();
    // Même temps de calcul que le compte existe ou non.
    $hash = $u['pass'] ?? password_hash('compte-inexistant', password_algo());
    if (!password_verify($pass, $hash) || !$u) {
        note_attempt($ipKey);
        note_attempt($idKey);
        fail(401, 'bad_credentials');
    }
    clear_attempts($idKey);
    if (password_needs_rehash($u['pass'], password_algo())) {
        db()->prepare('UPDATE users SET pass = ? WHERE id = ?')->execute([password_hash($pass, password_algo()), $u['id']]);
    }
    start_session((int) $u['id']);
    ok(['user' => public_user($u)]);
}

function list_sets(): never {
    $u = require_user();
    $st = db()->prepare('SELECT data FROM sets WHERE user_id = ? ORDER BY updated DESC');
    $st->execute([$u['id']]);
    ok(['sets' => array_map(fn($d) => json_decode($d, true), $st->fetchAll(PDO::FETCH_COLUMN))]);
}

// Une liste complète (titre, cartes, progression). La version la plus récente gagne :
// si l'autre appareil a enregistré après, on renvoie sa version (409) au lieu d'écraser.
function save_set(array $in): never {
    $u = require_user();
    $set = $in['set'] ?? null;
    if (!is_array($set) || !preg_match('/^[A-Za-z0-9_-]{6,40}$/', (string) ($set['id'] ?? ''))) fail(422, 'invalid');
    $title = trim((string) ($set['title'] ?? ''));
    $cards = $set['cards'] ?? null;
    if ($title === '' || mb_strlen($title) > 120 || !is_array($cards) || count($cards) > MAX_CARDS) fail(422, 'invalid');
    foreach ($cards as $c) {
        if (!is_array($c) || !is_string($c['t'] ?? null) || !is_string($c['d'] ?? null) || !is_string($c['id'] ?? null)) fail(422, 'invalid');
    }
    $updated = (int) ($set['updated'] ?? 0);
    $json = json_encode($set, JSON_UNESCAPED_UNICODE);
    if (strlen($json) > MAX_SET_BYTES) fail(413, 'too_large');

    $pdo = db();
    $pdo->beginTransaction();
    $st = $pdo->prepare('SELECT data, updated FROM sets WHERE user_id = ? AND id = ?');
    $st->execute([$u['id'], $set['id']]);
    $cur = $st->fetch();
    if ($cur && (int) $cur['updated'] > $updated) {
        $pdo->rollBack();
        fail(409, 'newer_on_server', ['set' => json_decode($cur['data'], true)]);
    }
    if (!$cur) {
        $n = $pdo->prepare('SELECT COUNT(*) FROM sets WHERE user_id = ?');
        $n->execute([$u['id']]);
        if ((int) $n->fetchColumn() >= MAX_SETS) { $pdo->rollBack(); fail(409, 'too_many_sets'); }
    }
    $pdo->prepare('INSERT INTO sets (user_id, id, data, updated) VALUES (?, ?, ?, ?)
                   ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, updated = excluded.updated')
        ->execute([$u['id'], $set['id'], $json, $updated]);
    $pdo->commit();
    ok();
}

function delete_set(array $in): never {
    $u = require_user();
    db()->prepare('DELETE FROM sets WHERE user_id = ? AND id = ?')->execute([$u['id'], (string) ($in['id'] ?? '')]);
    ok();
}

function delete_account(array $in): never {
    $u = require_user();
    if (!password_verify((string) ($in['password'] ?? ''), $u['pass'])) fail(401, 'bad_credentials');
    db()->prepare('DELETE FROM users WHERE id = ?')->execute([$u['id']]); // sessions et listes en cascade
    set_cookie('', time() - 3600);
    ok();
}
