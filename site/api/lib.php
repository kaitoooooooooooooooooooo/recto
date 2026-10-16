<?php
// Recto — fonctions communes de l'API : base SQLite, sessions, réponses JSON, limites.
declare(strict_types=1);

const COOKIE = 'recto_sid';
const SESSION_TTL = 60 * 86400;      // rester connecté 60 jours
const MAX_SETS = 300;                // listes par compte
const MAX_CARDS = 3000;              // cartes par liste
const MAX_SET_BYTES = 800_000;       // une liste (cartes + progression), en JSON

function data_dir(): string {
    $dir = getenv('RECTO_DATA_DIR') ?: __DIR__ . '/data';
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    return $dir;
}

// Développement : serveur intégré de PHP (php -S). L'en-tête Host ne compte pas, il se falsifie.
function is_local(): bool {
    return PHP_SAPI === 'cli-server';
}

function is_https(): bool {
    return ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

function secret(): string {
    $file = data_dir() . '/secret.key';
    if (!is_file($file)) file_put_contents($file, bin2hex(random_bytes(32)), LOCK_EX);
    return trim((string) file_get_contents($file));
}

function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $pdo = new PDO('sqlite:' . data_dir() . '/recto.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 4000;');
    $pdo->exec('
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY, username TEXT NOT NULL, username_lc TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE, pass TEXT NOT NULL, created INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sets (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
            data TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (user_id, id)
        );
        CREATE TABLE IF NOT EXISTS attempts (k TEXT NOT NULL, ts INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS attempts_k ON attempts(k, ts);
    ');
    return $pdo;
}

function ok(array $data = []): never {
    echo json_encode(['ok' => true] + $data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(int $status, string $code, array $extra = []): never {
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $code] + $extra, JSON_UNESCAPED_UNICODE);
    exit;
}

function body(): array {
    $raw = file_get_contents('php://input', false, null, 0, 1_200_000);
    $data = json_decode((string) $raw, true);
    return is_array($data) ? $data : [];
}

// Protection contre les requêtes envoyées par un autre site : en-tête maison + JSON.
function require_app_request(): void {
    $type = $_SERVER['CONTENT_TYPE'] ?? '';
    if (($_SERVER['HTTP_X_RECTO'] ?? '') !== '1' || !str_starts_with($type, 'application/json')) fail(400, 'bad_request');
}

// --- Limites (essais de connexion, inscriptions) --------------------------------------
function client_key(): string {
    return substr(hash_hmac('sha256', $_SERVER['REMOTE_ADDR'] ?? '?', secret()), 0, 24);
}
function too_many(string $key, int $max, int $window): bool {
    db()->prepare('DELETE FROM attempts WHERE ts < ?')->execute([time() - 86400]);
    $st = db()->prepare('SELECT COUNT(*) FROM attempts WHERE k = ? AND ts > ?');
    $st->execute([$key, time() - $window]);
    return (int) $st->fetchColumn() >= $max;
}
function note_attempt(string $key): void {
    db()->prepare('INSERT INTO attempts (k, ts) VALUES (?, ?)')->execute([$key, time()]);
}
function clear_attempts(string $key): void {
    db()->prepare('DELETE FROM attempts WHERE k = ?')->execute([$key]);
}

// --- Sessions ------------------------------------------------------------------------
function cookie_path(): string {
    // /recto/api/index.php → /recto/
    return rtrim(str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/api/index.php'))), '/') . '/';
}
function set_cookie(string $value, int $expires): void {
    setcookie(COOKIE, $value, ['expires' => $expires, 'path' => cookie_path(), 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax']);
}
function start_session(int $userId): void {
    $token = bin2hex(random_bytes(32));
    $expires = time() + SESSION_TTL;
    db()->prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)')->execute([hash('sha256', $token), $userId, $expires]);
    db()->prepare('DELETE FROM sessions WHERE expires < ?')->execute([time()]);
    set_cookie($token, $expires);
}
function end_session(): void {
    $token = $_COOKIE[COOKIE] ?? '';
    if ($token !== '') db()->prepare('DELETE FROM sessions WHERE token = ?')->execute([hash('sha256', $token)]);
    set_cookie('', time() - 3600);
}
function current_user(): ?array {
    static $user = false;
    if ($user !== false) return $user;
    $token = $_COOKIE[COOKIE] ?? '';
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) return $user = null;
    $st = db()->prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?');
    $st->execute([hash('sha256', $token), time()]);
    return $user = ($st->fetch() ?: null);
}
function require_user(): array {
    return current_user() ?? fail(401, 'not_logged_in');
}
function public_user(array $u): array {
    return ['username' => $u['username'], 'email' => $u['email'], 'created' => (int) $u['created'] * 1000];
}
