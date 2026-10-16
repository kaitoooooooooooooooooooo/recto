// Repères sur les cartes d'une liste : favoris (étoile) et difficulté tirée du mode Apprendre.
// Les favoris sont rangés dans la liste (`set.fav`, des identifiants de cartes), comme la
// progression : ils suivent le compte d'un appareil à l'autre.

export const isFav = (set, id) => !!set.fav?.includes(id);

export function toggleFav(set, id) {
  const fav = new Set(set.fav || []);
  if (fav.has(id)) fav.delete(id); else fav.add(id);
  const alive = new Set(set.cards.map((c) => c.id));
  set.fav = [...fav].filter((x) => alive.has(x));
  if (!set.fav.length) delete set.fav;
  return fav.has(id);
}

export const favCards = (set) => set.cards.filter((c) => isFav(set, c.id));

// Difficulté : orange dès 2 erreurs en mode Apprendre ; rouge si, en plus, la carte est ratée
// au moins une fois sur deux (taux d'erreur ≥ 50 %). Une carte qu'on finit par bien réussir
// redescend d'elle-même, puisque ses bonnes réponses font baisser le taux.
export const HARD_MIN_MISSES = 2;
export const HARD_RED_RATE = 0.5;

export function difficulty(set, id) {
  const p = set.prog?.[id];
  const ko = p?.ko || 0, ok = p?.ok || 0;
  if (ko < HARD_MIN_MISSES) return null;
  const rate = ko / (ok + ko);
  return { level: rate >= HARD_RED_RATE ? 'red' : 'orange', ko, total: ok + ko, rate };
}

export const hardCards = (set) => set.cards.filter((c) => difficulty(set, c.id));

export const describeDifficulty = (d) =>
  `Ratée ${d.ko} fois sur ${d.total} en mode Apprendre (${Math.round(d.rate * 100)} %)`;
