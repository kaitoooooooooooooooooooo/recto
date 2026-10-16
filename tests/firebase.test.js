// Recto : les comptes par Firebase, contre un faux Firebase en mémoire qui répond aux mêmes
// adresses (Authentication, renouvellement de session, Firestore) et applique les mêmes règles
// que firestore.rules (chacun ses listes, pas d'écrasement par une version plus ancienne).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFirebaseBackend } from '../site/js/backends/firebase.js';

const CONFIG = { apiKey: 'cle-de-test', projectId: 'recto-test' };

function fakeFirebase() {
  const users = new Map();      // email → { uid, email, password, displayName }
  const tokens = new Map();     // idToken → uid
  const refresh = new Map();    // refreshToken → uid
  const docs = new Map();       // chemin → { data, updated }
  const mails = [];
  let n = 0;
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fail = (status, message) => reply(status, { error: { code: status, message } });
  const issue = (u) => {
    const idToken = `id-${++n}`, refreshToken = `rt-${n}`;
    tokens.set(idToken, u.uid); refresh.set(refreshToken, u.uid);
    return { idToken, refreshToken, expiresIn: '3600', localId: u.uid, email: u.email, displayName: u.displayName || '' };
  };
  const byUid = (uid) => [...users.values()].find((u) => u.uid === uid);

  async function fetch(url, init = {}) {
    const u = new URL(url);
    if (u.host === 'identitytoolkit.googleapis.com') {
      assert.equal(u.searchParams.get('key'), CONFIG.apiKey);
      const b = JSON.parse(init.body);
      const op = u.pathname.split(':')[1];
      if (op === 'signUp') {
        if (users.has(b.email)) return fail(400, 'EMAIL_EXISTS');
        if (String(b.password).length < 6) return fail(400, 'WEAK_PASSWORD : Password should be at least 6 characters');
        const user = { uid: `uid${++n}`, email: b.email, password: b.password };
        users.set(b.email, user);
        return reply(200, issue(user));
      }
      if (op === 'signInWithPassword') {
        const user = users.get(b.email);
        return user && user.password === b.password ? reply(200, { ...issue(user), registered: true }) : fail(400, 'INVALID_LOGIN_CREDENTIALS');
      }
      const user = byUid(tokens.get(b.idToken));
      if (op === 'update') { if (!user) return fail(400, 'INVALID_ID_TOKEN'); user.displayName = b.displayName; return reply(200, { localId: user.uid }); }
      if (op === 'delete') { if (!user) return fail(400, 'INVALID_ID_TOKEN'); users.delete(user.email); return reply(200, {}); }
      if (op === 'sendOobCode') { mails.push({ ...b, locale: init.headers['X-Firebase-Locale'] }); return reply(200, { email: b.email }); }
      return fail(400, 'UNKNOWN');
    }
    if (u.host === 'securetoken.googleapis.com') {
      const b = new URLSearchParams(init.body);
      const uid = refresh.get(b.get('refresh_token'));
      if (b.get('grant_type') !== 'refresh_token' || !uid || !byUid(uid)) return fail(400, 'INVALID_REFRESH_TOKEN');
      const t = issue(byUid(uid));
      return reply(200, { id_token: t.idToken, refresh_token: t.refreshToken, expires_in: '3600', user_id: uid });
    }
    if (u.host === 'firestore.googleapis.com') {
      const prefix = `/v1/projects/${CONFIG.projectId}/databases/(default)/documents/`;
      assert.ok(u.pathname.startsWith(prefix), u.pathname);
      const auth = tokens.get(String(init.headers?.Authorization || '').replace('Bearer ', ''));
      if (!auth) return fail(401, 'UNAUTHENTICATED');
      const [, uid, , setId] = decodeURIComponent(u.pathname.slice(prefix.length)).split('/');
      if (uid !== auth) return fail(403, 'PERMISSION_DENIED');
      const key = `${uid}/${setId}`;
      const method = init.method || 'GET';
      if (method === 'GET' && !setId) {
        const documents = [...docs].filter(([k]) => k.startsWith(`${uid}/`))
          .map(([, d]) => ({ fields: { data: { stringValue: d.data }, updated: { integerValue: String(d.updated) } } }));
        return reply(200, documents.length ? { documents } : {});
      }
      if (method === 'GET') {
        const d = docs.get(key);
        return d ? reply(200, { fields: { data: { stringValue: d.data }, updated: { integerValue: String(d.updated) } } }) : fail(404, 'NOT_FOUND');
      }
      if (method === 'DELETE') { docs.delete(key); return reply(200, {}); }
      if (method === 'PATCH') {
        const f = JSON.parse(init.body).fields;
        const keys = Object.keys(f).sort().join();
        const updated = Number(f.updated?.integerValue);
        if (keys !== 'data,updated' || typeof f.data.stringValue !== 'string' || !Number.isInteger(updated) || !/^[A-Za-z0-9_-]{6,40}$/.test(setId)) return fail(403, 'PERMISSION_DENIED');
        const cur = docs.get(key);
        if (cur && updated < cur.updated) return fail(403, 'PERMISSION_DENIED');
        docs.set(key, { data: f.data.stringValue, updated });
        return reply(200, {});
      }
    }
    throw new Error(`adresse inattendue : ${url}`);
  }
  return { fetch, users, docs, mails, tokens };
}

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const sample = (updated, title = 'Vocabulaire') => ({ id: 'abcdef123456', title, cards: [{ id: 'k1', t: 'dog', d: 'chien' }], prog: {}, updated });
const pw = 'mot-de-passe-test';

test('firebase : inscription vérifiée comme avec PHP, pseudo affiché, session gardée', async () => {
  const fb = fakeFirebase(), storage = memoryStorage();
  const b = createFirebaseBackend(CONFIG, { fetch: fb.fetch, storage });
  await assert.rejects(b.register('x', 'pas-un-mail', 'court'), (e) => {
    assert.deepEqual(e.fields, { username: 'username_invalid', email: 'email_invalid', password: 'password_short' });
    return true;
  });
  assert.deepEqual(await b.register('Alice_1', 'Alice@Example.test', pw), { username: 'Alice_1', email: 'alice@example.test' });
  assert.equal(fb.users.get('alice@example.test').displayName, 'Alice_1');
  // Un nouvel onglet retrouve la session.
  const again = createFirebaseBackend(CONFIG, { fetch: fb.fetch, storage });
  assert.deepEqual(await again.me(), { username: 'Alice_1', email: 'alice@example.test' });
  await assert.rejects(b.register('autre', 'alice@example.test', pw), (e) => e.fields?.email === 'email_taken');
});

test('firebase : connexion, listes, conflit entre deux appareils', async () => {
  const fb = fakeFirebase();
  const pc = createFirebaseBackend(CONFIG, { fetch: fb.fetch, storage: memoryStorage() });
  const phone = createFirebaseBackend(CONFIG, { fetch: fb.fetch, storage: memoryStorage() });
  await pc.register('tom', 'tom@example.test', pw);
  await assert.rejects(phone.login('tom@example.test', 'faux-mot-de-passe'), (e) => e.code === 'bad_credentials');
  assert.equal((await phone.login('tom@example.test', pw)).username, 'tom');

  await pc.saveSet(sample(2000));
  assert.deepEqual(await phone.listSets(), [sample(2000)]);
  // Le téléphone a une version plus ancienne : refusée, il reçoit celle du serveur.
  await assert.rejects(phone.saveSet(sample(1000, 'Ancien')), (e) => e.code === 'newer_on_server' && e.set.title === 'Vocabulaire');
  await phone.saveSet(sample(3000, 'Depuis le téléphone'));
  assert.equal((await pc.listSets())[0].title, 'Depuis le téléphone');
  await assert.rejects(pc.saveSet({ ...sample(4000), id: 'pas bon' }), (e) => e.code === 'invalid');

  await pc.deleteSet('abcdef123456');
  assert.deepEqual(await phone.listSets(), []);
});

test('firebase : chacun ne voit que ses listes', async () => {
  const fb = fakeFirebase();
  const a = createFirebaseBackend(CONFIG, { fetch: fb.fetch, storage: memoryStorage() });
  const b = createFirebaseBackend(CONFIG, { fetch: fb.fetch, storage: memoryStorage() });
  await a.register('alice', 'a@example.test', pw);
  await b.register('bruno', 'b@example.test', pw);
  await a.saveSet(sample(10, 'À Alice'));
  assert.deepEqual(await b.listSets(), []);
  assert.equal(fb.docs.size, 1);
});

test('firebase : la session se renouvelle toute seule après une heure', async () => {
  const fb = fakeFirebase(), storage = memoryStorage();
  const b = createFirebaseBackend(CONFIG, { fetch: fb.fetch, storage });
  await b.register('tom', 'tom@example.test', pw);
  const s = JSON.parse(storage.getItem('recto:session'));
  storage.setItem('recto:session', JSON.stringify({ ...s, expiresAt: Date.now() - 1000 }));
  const later = createFirebaseBackend(CONFIG, { fetch: fb.fetch, storage });
  await later.saveSet(sample(5));
  const s2 = JSON.parse(storage.getItem('recto:session'));
  assert.notEqual(s2.idToken, s.idToken);
  assert.ok(s2.expiresAt > Date.now());
  // Session révoquée (compte supprimé ailleurs) : on est déconnecté proprement.
  fb.users.clear();
  storage.setItem('recto:session', JSON.stringify({ ...s2, expiresAt: 0 }));
  const gone = createFirebaseBackend(CONFIG, { fetch: fb.fetch, storage });
  await assert.rejects(gone.me(), (e) => e.code === 'not_logged_in');
  assert.equal(storage.getItem('recto:session'), null);
});

test('firebase : suppression du compte (mot de passe exigé, listes effacées)', async () => {
  const fb = fakeFirebase(), storage = memoryStorage();
  const b = createFirebaseBackend(CONFIG, { fetch: fb.fetch, storage });
  await b.register('tom', 'tom@example.test', pw);
  await b.saveSet(sample(7));
  await assert.rejects(b.deleteAccount('faux'), (e) => e.code === 'bad_credentials');
  assert.equal(fb.users.size, 1);
  await b.deleteAccount(pw);
  assert.equal(fb.users.size, 0);
  assert.equal(fb.docs.size, 0);
  assert.equal(await b.me(), null);
});

test('firebase : mot de passe oublié (e-mail en français), déconnexion, réseau coupé', async () => {
  const fb = fakeFirebase(), storage = memoryStorage();
  const b = createFirebaseBackend(CONFIG, { fetch: fb.fetch, storage });
  await b.resetPassword('  tom@example.test ');
  assert.deepEqual(fb.mails, [{ requestType: 'PASSWORD_RESET', email: 'tom@example.test', locale: 'fr' }]);
  await b.register('tom', 'tom@example.test', pw);
  await b.logout();
  assert.equal(await b.me(), null);
  const offline = createFirebaseBackend(CONFIG, { fetch: async () => { throw new TypeError('Failed to fetch'); }, storage });
  await assert.rejects(offline.login('tom@example.test', pw), (e) => e.code === 'network');
});
