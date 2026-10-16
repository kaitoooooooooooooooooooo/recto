// Mini-succès d'une liste. Ils sont rangés dans la liste elle-même (`set.ach` : id → date),
// donc suivent le compte d'un appareil à l'autre ; `set.days` garde les jours de révision.
import { stats, palierStats, levelOf, MASTERED } from './learn.js';

export const ACHIEVEMENTS = [
  { id: 'palier', title: 'Premier palier', desc: 'Franchir un palier en mode Apprendre.' },
  { id: 'sans-faute', title: 'Sans faute', desc: 'Franchir un palier sans une seule erreur.' },
  { id: 'mi-chemin', title: 'À mi-chemin', desc: 'Maîtriser la moitié des cartes.' },
  { id: 'maitrise', title: 'Liste maîtrisée', desc: 'Maîtriser toutes les cartes.' },
  { id: 'serie-5', title: 'Série de 5', desc: '5 bonnes réponses d’affilée.' },
  { id: 'serie-10', title: 'Série de 10', desc: '10 bonnes réponses d’affilée.' },
  { id: 'serie-25', title: 'Série de 25', desc: '25 bonnes réponses d’affilée.' },
  { id: 'tour', title: 'Tour complet', desc: 'Passer toutes les cartes en mode Cartes.' },
  { id: 'tout-su', title: 'Tout su', desc: 'Savoir toutes les cartes du premier coup (mode Cartes, avec le tri).' },
  { id: 'retour', title: 'De retour', desc: 'Réviser cette liste deux jours différents.' },
  { id: 'regularite', title: 'Régularité', desc: 'Réviser cette liste cinq jours différents.' },
];
const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
export const describe = (id) => BY_ID.get(id);

export const unlocked = (set) => ACHIEVEMENTS.filter((a) => set.ach?.[a.id]);

// Débloque ceux de la liste `ids` qui ne l'étaient pas encore ; renvoie les nouveaux.
export function award(set, ids, now = Date.now()) {
  set.ach ||= {};
  const fresh = [];
  for (const id of ids) {
    if (!id || set.ach[id] || !BY_ID.has(id)) continue;
    set.ach[id] = now;
    fresh.push(id);
  }
  return fresh;
}

// Jour local (AAAA-MM-JJ) : une révision à 23 h et une autre à 1 h comptent pour deux jours.
export function today(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function noteDay(set, day = today()) {
  set.days ||= [];
  if (!set.days.includes(day)) set.days = [...set.days, day].slice(-60);
  return set.days.length;
}

export const dayAwards = (set) => {
  const n = new Set(set.days || []).size;
  return [n >= 2 && 'retour', n >= 5 && 'regularite'];
};

export const streakAwards = (streak) => [streak >= 5 && 'serie-5', streak >= 10 && 'serie-10', streak >= 25 && 'serie-25'];

export const masteryAwards = (set) => {
  const st = stats(set);
  return [st.total >= 4 && st.mastered * 2 >= st.total && 'mi-chemin', st.total > 0 && st.mastered === st.total && 'maitrise'];
};

// Palier franchi : le premier palier, et « sans faute » si aucune de ses cartes n'a jamais été ratée.
export const palierAwards = (set, ids) => {
  if (palierStats(set, ids).mastered < ids.length) return [];
  const clean = ids.every((id) => !(set.prog?.[id]?.ko > 0) && levelOf(set.prog, id) >= MASTERED);
  return ['palier', clean && 'sans-faute'];
};
