// Les listes et la progression. Sans compte : dans ce navigateur (localStorage).
// Avec un compte : sur le serveur, enregistrées une seconde après chaque changement ;
// si un autre appareil a enregistré plus récemment, sa version remplace la nôtre.
import { api, ApiError } from './api.js';

// Clés d'origine (l'app s'appelait « Fiches ») : les garder, sinon les listes déjà enregistrées
// dans les navigateurs disparaîtraient. Idem pour les réglages des modes Cartes et Apprendre.
const LOCAL = 'fiches:sets';
let user = null;
let available = true;  // false : pas d'API (fichiers ouverts sans serveur, ou HTTPS manquant)
let sets = [];
const listeners = new Set();
const timers = new Map();

export const currentUser = () => user;
export const accountsAvailable = () => available;
export const allSets = () => sets;
export const getSet = (id) => sets.find((s) => s.id === id) || null;
export const onChange = (f) => { listeners.add(f); return () => listeners.delete(f); };
const emit = () => listeners.forEach((f) => f());

// Identifiant aléatoire (crypto.randomUUID n'existe pas en http sur un téléphone du Wi-Fi).
export function newId(len = 12) {
  const a = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

function readLocal() {
  try { const v = JSON.parse(localStorage.getItem(LOCAL) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeLocal() {
  try { localStorage.setItem(LOCAL, JSON.stringify(sets)); } catch { /* stockage plein ou bloqué */ }
}

export async function init() {
  try {
    user = (await api('me')).user;
  } catch (e) {
    user = null;
    available = !(e instanceof ApiError) || !['network', 'no_api', 'https_required'].includes(e.code);
  }
  if (user) {
    // Des listes faites ici pendant une panne du serveur attendent encore dans le navigateur.
    if (readLocal().length) { await adopt(user).catch(() => {}); return; }
    try { sets = (await api('sets')).sets; } catch { sets = []; }
  } else {
    sets = readLocal();
  }
  sort();
  emit();
}

function sort() { sets.sort((a, b) => b.updated - a.updated); }

function persist(set) {
  set.updated = Date.now();
  sort();
  emit();
  if (!user) { writeLocal(); return; }
  clearTimeout(timers.get(set.id));
  timers.set(set.id, setTimeout(() => push(set.id), 900));
}

async function push(id, { leaving = false } = {}) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const set = getSet(id);
  if (!set || !user) return;
  try {
    const body = { set };
    await api('set', { method: 'PUT', body, keepalive: leaving && JSON.stringify(body).length < 60_000 });
  } catch (e) {
    if (e.code === 'newer_on_server' && e.set) { Object.assign(set, e.set); sort(); emit(); }
    else if (e.code === 'not_logged_in') { user = null; emit(); }
    // Réseau coupé ou serveur indisponible : on réessaie un peu plus tard.
    else if (!leaving && ['network', 'no_api', 'server_error'].includes(e.code) && !timers.has(id)) timers.set(id, setTimeout(() => push(id), 5000));
  }
}

// Envoie tout de suite ce qui attend (avant de quitter la page, ou de se déconnecter).
export function flush({ leaving = false } = {}) { return Promise.all([...timers.keys()].map((id) => push(id, { leaving }))); }
addEventListener('pagehide', () => flush({ leaving: true }));

export function createSet(title, cards) {
  const now = Date.now();
  const set = { id: newId(), title: title.trim() || 'Sans titre', cards: cards.map((c) => ({ id: newId(8), t: c.t, d: c.d })), prog: {}, created: now, updated: now };
  sets.unshift(set);
  persist(set);
  return set;
}

export function updateSet(id, change) {
  const set = getSet(id);
  if (!set) return null;
  change(set);
  persist(set);
  return set;
}

export async function deleteSet(id) {
  sets = sets.filter((s) => s.id !== id);
  clearTimeout(timers.get(id));
  timers.delete(id);
  emit();
  if (user) await api('set/delete', { method: 'POST', body: { id } }).catch(() => {});
  else writeLocal();
}

// Connexion / inscription : les listes faites sans compte sur cet appareil rejoignent le compte.
async function adopt(u) {
  user = u;
  const local = readLocal();
  let moved = 0;
  for (const s of local) {
    try { await api('set', { method: 'PUT', body: { set: { ...s, updated: Date.now() } } }); moved++; } catch { /* liste invalide ou trop grande */ }
  }
  if (moved === local.length) localStorage.removeItem(LOCAL);
  sets = (await api('sets')).sets;
  sort();
  emit();
  return moved;
}

export async function register(username, email, password) {
  const r = await api('register', { method: 'POST', body: { username, email, password } });
  return adopt(r.user);
}
export async function login(loginName, password) {
  const r = await api('login', { method: 'POST', body: { login: loginName, password } });
  return adopt(r.user);
}
export async function logout() {
  await flush();
  await api('logout', { method: 'POST' }).catch(() => {});
  user = null;
  sets = readLocal();
  sort();
  emit();
}
export async function deleteAccount(password) {
  await api('account/delete', { method: 'POST', body: { password } });
  user = null;
  sets = readLocal();
  emit();
}
