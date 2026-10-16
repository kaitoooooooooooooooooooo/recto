// Mode « Apprendre » : chaque carte passe par trois niveaux.
//   0 nouvelle → une bonne réponse en choix multiple → 1 en cours → une bonne réponse écrite → 2 maîtrisée.
// Une erreur fait redescendre d'un niveau et la carte revient plus loin dans la même manche.
// Sans questions écrites, il faut deux bons choix ; sans choix multiple, on écrit dès le début.
// La liste est découpée en paliers d'environ 7 cartes, travaillés l'un après l'autre.
import { normalize } from './check.js';

export const ROUND_SIZE = 7;
export const PALIER_SIZE = 7;
export const NEW = 0, LEARNING = 1, MASTERED = 2;

export const levelOf = (prog, id) => prog?.[id]?.lv ?? NEW;

export function stats(set) {
  const out = { total: set.cards.length, fresh: 0, learning: 0, mastered: 0 };
  for (const c of set.cards) {
    const lv = levelOf(set.prog, c.id);
    if (lv >= MASTERED) out.mastered++;
    else if (lv === LEARNING) out.learning++;
    else out.fresh++;
  }
  return out;
}

export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Paliers : les cartes dans l'ordre d'Apprendre (liste ou mélange), en groupes égaux d'environ PALIER_SIZE
// (18 cartes → 6 + 6 + 6, plutôt que 7 + 7 + 4).
// Ordre des cartes dans Apprendre : celui de la liste, ou un mélange propre à la liste
// (`set.mix`, une graine enregistrée avec elle). Chaque carte reçoit une place tirée de la graine
// et de son identifiant : le mélange reste le même d'une séance à l'autre, et ajouter une carte
// ne bouleverse pas l'ordre des autres.
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export const newMix = () => 1 + Math.floor(Math.random() * 2 ** 31);
export function learnOrder(set) {
  const ids = set.cards.map((c) => c.id);
  if (!set.mix) return ids;
  return ids.map((id) => [hash32(`${set.mix}:${id}`), id])
    .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1))
    .map(([, id]) => id);
}

export function paliers(set, size = PALIER_SIZE) {
  const ids = learnOrder(set);
  const n = Math.max(1, Math.ceil(ids.length / size));
  const base = Math.floor(ids.length / n), extra = ids.length % n;
  const out = [];
  for (let i = 0, k = 0; i < n; i++) {
    const len = base + (i < extra ? 1 : 0);
    out.push(ids.slice(k, k + len));
    k += len;
  }
  return out;
}

// Le palier à travailler : le premier qui a encore une carte non maîtrisée (-1 : tout est maîtrisé).
export function currentPalier(set) {
  return paliers(set).findIndex((ids) => ids.some((id) => levelOf(set.prog, id) < MASTERED));
}

export function palierStats(set, ids) {
  const out = { total: ids.length, fresh: 0, learning: 0, mastered: 0 };
  for (const id of ids) {
    const lv = levelOf(set.prog, id);
    if (lv >= MASTERED) out.mastered++;
    else if (lv === LEARNING) out.learning++;
    else out.fresh++;
  }
  return out;
}

// Quel type de question pour une carte, selon son niveau et les réglages.
export function questionType(lv, types) {
  if (types === 'choice') return 'choice';
  if (types === 'written') return 'written';
  return lv === NEW ? 'choice' : 'written';
}

// Manche : d'abord les cartes en cours (pour les terminer), puis les nouvelles ; à niveau égal,
// celles vues il y a le plus longtemps. `ids` limite la manche à un palier. Liste mélangée :
// les questions de la manche arrivent dans le désordre (sinon on retiendrait l'ordre).
export function makeRound(set, { types = 'both', size = ROUND_SIZE, rng = Math.random, ids = null } = {}) {
  const only = ids ? new Set(ids) : null;
  const todo = set.cards.filter((c) => (!only || only.has(c.id)) && levelOf(set.prog, c.id) < MASTERED);
  const ranked = shuffle(todo, rng).sort((a, b) =>
    levelOf(set.prog, b.id) - levelOf(set.prog, a.id) || (set.prog?.[a.id]?.at ?? 0) - (set.prog?.[b.id]?.at ?? 0));
  const picked = ranked.slice(0, size);
  return (set.mix ? shuffle(picked, rng) : picked).map((c) => ({ id: c.id, type: questionType(levelOf(set.prog, c.id), types) }));
}

export const promptOf = (card, dir) => (dir === 'def' ? card.d : card.t);
export const answerOf = (card, dir) => (dir === 'def' ? card.t : card.d);

// Quatre propositions : la bonne et trois autres réponses de la liste (sans doublons).
export function choicesFor(set, card, dir, rng = Math.random) {
  const right = answerOf(card, dir);
  const seen = new Set([normalize(right)]);
  const others = [];
  for (const c of shuffle(set.cards, rng)) {
    const a = answerOf(c, dir);
    const k = normalize(a);
    if (c.id === card.id || seen.has(k)) continue;
    seen.add(k);
    others.push(a);
    if (others.length === 3) break;
  }
  return shuffle([right, ...others], rng);
}

// Nouvelle progression d'une carte après une réponse.
export function applyAnswer(prog, id, { correct, type, types = 'both', now = Date.now() }) {
  const p = { lv: NEW, ok: 0, ko: 0, at: 0, ...(prog?.[id] || {}) };
  if (correct) {
    p.ok++;
    if (types === 'choice') p.lv = Math.min(MASTERED, p.lv + 1);       // deux bons choix
    else if (type === 'written') p.lv = MASTERED;                        // écrire juste = maîtrisée
    else p.lv = Math.max(p.lv, LEARNING);                                // bon choix = en cours
  } else {
    p.ko++;
    p.lv = Math.max(NEW, p.lv - 1);
  }
  p.at = now;
  return { ...(prog || {}), [id]: p };
}
