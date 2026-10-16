// Comptes par Firebase : Authentication (e-mail + mot de passe) et Firestore, appelés par leurs API
// REST (sans bibliothèque). Chaque liste est un document `users/{uid}/sets/{id}` : la liste entière
// en JSON (`data`) et sa date (`updated`). Les règles Firestore (firestore.rules) n'autorisent
// chacun qu'à ses propres listes, et refusent d'écraser une version plus récente.
import { ApiError } from '../api.js';

const SESSION = 'recto:session';
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const MAX_SET_BYTES = 800_000;

// Erreurs de Firebase Authentication → codes de Recto (mêmes messages que l'API PHP).
// [champ du formulaire, code] ; sans champ, le message s'affiche sous le formulaire.
const AUTH_ERRORS = {
  EMAIL_EXISTS: ['email', 'email_taken'],
  INVALID_EMAIL: ['email', 'email_invalid'],
  MISSING_EMAIL: ['email', 'email_invalid'],
  WEAK_PASSWORD: ['password', 'password_short'],
  MISSING_PASSWORD: [null, 'bad_credentials'],
  INVALID_LOGIN_CREDENTIALS: [null, 'bad_credentials'],
  INVALID_PASSWORD: [null, 'bad_credentials'],
  EMAIL_NOT_FOUND: [null, 'bad_credentials'],
  USER_DISABLED: [null, 'bad_credentials'],
  TOO_MANY_ATTEMPTS_TRY_LATER: [null, 'rate_limited'],
  OPERATION_NOT_ALLOWED: [null, 'not_configured'],
  CONFIGURATION_NOT_FOUND: [null, 'not_configured'],
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: [null, 'bad_credentials'],
  TOKEN_EXPIRED: [null, 'not_logged_in'],
  INVALID_ID_TOKEN: [null, 'not_logged_in'],
  INVALID_REFRESH_TOKEN: [null, 'not_logged_in'],
  USER_NOT_FOUND: [null, 'not_logged_in'],
};

export function createFirebaseBackend({ apiKey, projectId }, { fetch: f = (...a) => fetch(...a), storage = globalThis.localStorage } = {}) {
  const AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts';
  const TOKEN = `https://securetoken.googleapis.com/v1/token?key=${apiKey}`;
  const DB = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

  let session = (() => { try { return JSON.parse(storage.getItem(SESSION) || 'null'); } catch { return null; } })();
  const save = (s) => {
    session = s;
    try { if (s) storage.setItem(SESSION, JSON.stringify(s)); else storage.removeItem(SESSION); } catch { /* stockage bloqué */ }
  };
  const fresh = (r, prev = session) => ({
    idToken: r.idToken ?? r.id_token,
    refreshToken: r.refreshToken ?? r.refresh_token,
    expiresAt: Date.now() + (Number(r.expiresIn ?? r.expires_in) - 60) * 1000, // une minute de marge
    uid: r.localId ?? r.user_id ?? prev?.uid,
    email: r.email ?? prev?.email,
    name: r.displayName || prev?.name || '',
  });
  const userOf = (s) => (s ? { username: s.name || s.email.split('@')[0], email: s.email } : null);

  async function auth(url, body, { form = false, headers = {} } = {}) {
    let res;
    try {
      res = await f(url, {
        method: 'POST',
        headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', ...headers },
        body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
      });
    } catch { throw new ApiError(0, 'network'); }
    const json = await res.json().catch(() => null);
    if (res.ok && json) return json;
    const key = String(json?.error?.message || '').split(/[\s:]/)[0];
    const [field, code] = AUTH_ERRORS[key] || [null, res.status >= 500 ? 'server_error' : 'bad_request'];
    throw new ApiError(res.status, field ? 'invalid' : code, field ? { fields: { [field]: code } } : {});
  }

  // Jeton d'accès valable une heure : on le renouvelle avant qu'il n'expire.
  async function token() {
    if (!session) throw new ApiError(401, 'not_logged_in');
    if (Date.now() < session.expiresAt) return session.idToken;
    try {
      save(fresh(await auth(TOKEN, { grant_type: 'refresh_token', refresh_token: session.refreshToken }, { form: true })));
    } catch (e) {
      if (e.code === 'network') throw e;
      save(null);
      throw new ApiError(401, 'not_logged_in');
    }
    return session.idToken;
  }

  async function db(path, { method = 'GET', body, keepalive = false } = {}) {
    const t = await token();
    let res;
    try {
      res = await f(`${DB}/${path}`, {
        method, keepalive,
        headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new ApiError(0, 'network'); }
    if (res.status === 404 && method === 'GET') return null;
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    if (res.status === 401) { save(null); throw new ApiError(401, 'not_logged_in'); }
    throw new ApiError(res.status, res.status === 403 ? 'forbidden' : res.status === 429 ? 'rate_limited' : 'server_error');
  }

  const setPath = (id) => `users/${session.uid}/sets/${id}`;
  const toDoc = (set) => ({ fields: { data: { stringValue: JSON.stringify(set) }, updated: { integerValue: String(Math.trunc(set.updated || 0)) } } });
  const fromDoc = (doc) => { try { return JSON.parse(doc.fields.data.stringValue); } catch { return null; } };

  // Mêmes vérifications que l'API PHP, pour les mêmes messages.
  function checkRegister(username, email, password) {
    const fields = {};
    const name = String(username || '').trim(), mail = String(email || '').trim().toLowerCase(), pass = String(password || '');
    if (!/^[A-Za-z0-9_.-]{3,20}$/.test(name)) fields.username = 'username_invalid';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) || mail.length > 190) fields.email = 'email_invalid';
    if (pass.length < 8) fields.password = 'password_short';
    else if (pass.length > 200) fields.password = 'password_long';
    else if ([name.toLowerCase(), mail].includes(pass.toLowerCase())) fields.password = 'password_weak';
    if (Object.keys(fields).length) throw new ApiError(422, 'invalid', { fields });
    return { name, mail, pass };
  }

  async function signIn(email, password) {
    return fresh(await auth(`${AUTH}:signInWithPassword?key=${apiKey}`, { email: String(email || '').trim(), password, returnSecureToken: true }), null);
  }

  const backend = {
    kind: 'firebase',
    loginLabel: 'Adresse e-mail',
    loginType: 'email',
    canResetPassword: true,

    async me() {
      if (!session) return null;
      await token();
      return userOf(session);
    },

    async register(username, email, password) {
      const { name, mail, pass } = checkRegister(username, email, password);
      const s = fresh(await auth(`${AUTH}:signUp?key=${apiKey}`, { email: mail, password: pass, returnSecureToken: true }), null);
      save({ ...s, name });
      await auth(`${AUTH}:update?key=${apiKey}`, { idToken: s.idToken, displayName: name, returnSecureToken: false }).catch(() => {});
      return userOf(session);
    },

    async login(email, password) {
      save(await signIn(email, password));
      return userOf(session);
    },

    async logout() { save(null); },

    // Supprimer son compte : on redemande le mot de passe (Firebase l'exige après un moment),
    // puis on efface les listes, puis le compte.
    async deleteAccount(password) {
      if (!session) throw new ApiError(401, 'not_logged_in');
      save(await signIn(session.email, password));
      for (const set of await backend.listSets()) await db(setPath(set.id), { method: 'DELETE' });
      await auth(`${AUTH}:delete?key=${apiKey}`, { idToken: session.idToken });
      save(null);
    },

    // Firebase envoie lui-même l'e-mail (lien vers une page où choisir un nouveau mot de passe).
    // Il répond pareil que l'adresse ait un compte ou non.
    async resetPassword(email) {
      await auth(`${AUTH}:sendOobCode?key=${apiKey}`, { requestType: 'PASSWORD_RESET', email: String(email || '').trim() }, { headers: { 'X-Firebase-Locale': 'fr' } });
    },

    async listSets() {
      await token();
      const base = `users/${session.uid}/sets?pageSize=300`;
      const out = [];
      let page = '';
      do {
        const r = await db(page ? `${base}&pageToken=${encodeURIComponent(page)}` : base);
        for (const doc of r?.documents || []) { const s = fromDoc(doc); if (s) out.push(s); }
        page = r?.nextPageToken || '';
      } while (page);
      return out;
    },

    async saveSet(set, { keepalive = false } = {}) {
      if (!ID_RE.test(String(set?.id || ''))) throw new ApiError(422, 'invalid');
      if (JSON.stringify(set).length > MAX_SET_BYTES) throw new ApiError(413, 'too_large');
      await token();
      try {
        await db(setPath(set.id), { method: 'PATCH', body: toDoc(set), keepalive });
      } catch (e) {
        if (e.code !== 'forbidden') throw e;
        // Refus des règles : une version plus récente est-elle déjà enregistrée ?
        const doc = await db(setPath(set.id)).catch(() => null);
        const server = doc && fromDoc(doc);
        if (server && Number(server.updated) > Number(set.updated)) throw new ApiError(409, 'newer_on_server', { set: server });
        throw e;
      }
    },

    async deleteSet(id) {
      await token();
      await db(setPath(id), { method: 'DELETE' });
    },
  };
  return backend;
}
