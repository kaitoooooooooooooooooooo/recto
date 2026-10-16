// Recto : l'API PHP lancée avec `php -S` sur une base jetable (dossier temporaire). L'app est
// servie dans un sous-dossier (/site/), comme en ligne (/recto/).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = 5300 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}/site/api/index.php?r=`;
let server, dataDir;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'recto-test-'));
  server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', project], { env: { ...process.env, RECTO_DATA_DIR: dataDir }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(base + 'me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('php -S ne répond pas');
});
after(() => { server?.kill(); try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* fichier encore ouvert */ } });

// Un « navigateur » minimal qui garde le cookie de session.
function client() {
  let cookie = '';
  return async (route, { method = 'GET', body, headers } = {}) => {
    const res = await fetch(base + route, {
      method,
      headers: { ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Recto': '1' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = set.match(/recto_sid=([^;]*)/);
      if (m) cookie = m[1] ? `recto_sid=${m[1]}` : '';
    }
    return { status: res.status, json: await res.json(), setCookie: set };
  };
}

const pw = `pw-${Math.random().toString(36).slice(2)}-test`;
const sample = (updated) => ({ id: 'abcdef123456', title: 'Vocabulaire', cards: [{ id: 'k1', t: 'dog', d: 'chien' }], prog: { k1: { lv: 1 } }, updated });

test('inscription : champs vérifiés, cookie HttpOnly limité au dossier de l’app', async () => {
  const c = client();
  const bad = await c('register', { method: 'POST', body: { username: 'x', email: 'pas-un-mail', password: 'court' } });
  assert.equal(bad.status, 422);
  assert.deepEqual(bad.json.fields, { username: 'username_invalid', email: 'email_invalid', password: 'password_short' });
  const r = await c('register', { method: 'POST', body: { username: 'Alice_1', email: 'Alice@Example.test', password: pw } });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.email, 'alice@example.test');
  assert.match(r.setCookie, /HttpOnly/i);
  assert.match(r.setCookie, /path=\/site\//i);
  assert.match(r.setCookie, /samesite=lax/i);
  const taken = await c('register', { method: 'POST', body: { username: 'alice_1', email: 'alice@example.test', password: pw } });
  assert.deepEqual(taken.json.fields, { username: 'username_taken', email: 'email_taken' });
  assert.equal((await c('me')).json.user.username, 'Alice_1');
});

test('requêtes d’un autre site refusées (sans en-tête X-Recto ou sans JSON)', async () => {
  const c = client();
  assert.equal((await c('login', { method: 'POST', body: {}, headers: { 'X-Recto': '' } })).status, 400);
  assert.equal((await c('login', { method: 'POST', body: {}, headers: { 'Content-Type': 'text/plain' } })).status, 400);
});

test('connexion, listes, conflit entre appareils, suppression', async () => {
  const phone = client(), laptop = client();
  assert.equal((await phone('sets')).status, 401);
  assert.equal((await phone('login', { method: 'POST', body: { login: 'alice_1', password: 'faux-mot-de-passe' } })).status, 401);
  assert.equal((await phone('login', { method: 'POST', body: { login: 'ALICE_1', password: pw } })).status, 200);
  assert.equal((await laptop('login', { method: 'POST', body: { login: 'alice@example.test', password: pw } })).status, 200);

  assert.equal((await phone('set', { method: 'PUT', body: { set: sample(2000) } })).status, 200);
  const list = await laptop('sets');
  assert.deepEqual(list.json.sets, [sample(2000)]);

  // Le portable envoie une version plus ancienne : refusée, il reçoit celle du serveur.
  const old = await laptop('set', { method: 'PUT', body: { set: { ...sample(1000), title: 'Ancien' } } });
  assert.equal(old.status, 409);
  assert.equal(old.json.error, 'newer_on_server');
  assert.equal(old.json.set.title, 'Vocabulaire');

  assert.equal((await phone('set', { method: 'PUT', body: { set: { ...sample(3000), id: 'bad id' } } })).status, 422);
  assert.equal((await phone('set', { method: 'PUT', body: { set: { ...sample(3000), cards: [{ t: 1 }] } } })).status, 422);

  assert.equal((await laptop('set/delete', { method: 'POST', body: { id: 'abcdef123456' } })).status, 200);
  assert.deepEqual((await phone('sets')).json.sets, []);
});

test('déconnexion : la session ne sert plus', async () => {
  const c = client();
  await c('login', { method: 'POST', body: { login: 'alice_1', password: pw } });
  const stolen = client();
  const r = await c('logout', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal((await c('me')).json.user, null);
  assert.equal((await stolen('sets')).status, 401);
});

test('trop d’essais de connexion : blocage temporaire', async () => {
  const c = client();
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push((await c('login', { method: 'POST', body: { login: 'bob', password: 'mauvais-' + i } })).status);
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 401, 401, 401, 429]);
});

test('suppression du compte : mot de passe exigé, listes effacées', async () => {
  const c = client();
  await c('login', { method: 'POST', body: { login: 'alice_1', password: pw } });
  await c('set', { method: 'PUT', body: { set: sample(5000) } });
  assert.equal((await c('account/delete', { method: 'POST', body: { password: 'faux' } })).status, 401);
  assert.equal((await c('account/delete', { method: 'POST', body: { password: pw } })).status, 200);
  const again = client();
  assert.equal((await again('login', { method: 'POST', body: { login: 'alice_1', password: pw } })).status, 401);
  const re = await again('register', { method: 'POST', body: { username: 'alice_1', email: 'alice@example.test', password: pw } });
  assert.equal(re.status, 200);
  assert.deepEqual((await again('sets')).json.sets, []);
});
