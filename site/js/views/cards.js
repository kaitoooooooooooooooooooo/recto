// Mode « Cartes » : retourner (clic, Espace), avancer (← →). Avec « Trier », on range chaque
// carte en « Je sais » ou « À revoir », puis on recommence avec les seules cartes à revoir.
// Sur téléphone : glisser à droite = je sais / suivante, à gauche = à revoir / précédente.
import { h, plural, ring, celebrate, toast } from '../ui.js';
import * as store from '../store.js';
import { shuffle } from '../learn.js';
import { award, describe, noteDay, dayAwards } from '../achievements.js';
import { starButton } from './parts.js';
import { isFav, toggleFav, favCards, difficulty, hardCards, describeDifficulty } from '../marks.js';

const PREFS = 'fiches:cards';
// Mélanger est activé par défaut (depuis la version 2 des réglages, y compris pour qui avait déjà
// enregistré « non mélangé ») ; on peut toujours le couper, et ce choix-là est gardé.
const DEFAULTS = { shuffle: true, defFirst: false, sort: true, v: 2 };
const readPrefs = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS) || '{}');
    if (saved.v !== 2) { saved.shuffle = true; saved.v = 2; }
    return { ...DEFAULTS, ...saved };
  } catch { return { ...DEFAULTS }; }
};
const savePrefs = (p) => { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* sans stockage */ } };
const sizeClass = (s) => (s.length > 220 ? 'xs' : s.length > 110 ? 's' : s.length > 40 ? 'm' : 'l');

export function renderCards(ctx) {
  const set = store.getSet(ctx.params[0]);
  if (!set || !set.cards.length) return ctx.go('/');
  const prefs = readPrefs();
  const byId = new Map(set.cards.map((c) => [c.id, c]));
  // Paquet : toutes les cartes, ou seulement les favoris / les difficiles (?only=fav|hard).
  const asked = ctx.query.get('only');
  const pick = { fav: () => favCards(set), hard: () => hardCards(set) }[asked];
  const only = pick && pick().length ? asked : null;
  const poolIds = () => (only ? pick() : set.cards).map((c) => c.id);
  let deck = [], i = 0, flipped = false, known = new Set(), review = new Set(), round = 1;
  let dayNoted = false, ringShown = false;

  // Anneau : plein = cartes sues, pâle = cartes passées (sans le tri : position dans le paquet).
  const progress = ring({ size: 58, stroke: 4, cls: 'head-ring' });
  const paintRing = () => {
    const n = deck.length || 1;
    const v = prefs.sort ? known.size / n : i / n;
    const v2 = prefs.sort ? (known.size + review.size) / n : i / n;
    const shown = Math.min(i + 1, deck.length);
    progress.label(h('span', { class: deck.length > 99 ? 'tiny' : null }, `${shown}/${deck.length}`))
      .describe(prefs.sort ? `${known.size} sues, ${review.size} à revoir, sur ${deck.length}` : `Carte ${shown} sur ${deck.length}`);
    ringShown ? progress.set(v, v2) : progress.show(v, v2);
    ringShown = true;
  };
  // Premier geste de la séance : on note le jour (succès « De retour », « Régularité »).
  const touch = () => {
    if (dayNoted) return;
    dayNoted = true;
    const got = [];
    store.updateSet(set.id, (s) => { noteDay(s); got.push(...award(s, dayAwards(s))); });
    celebrate(got.map(describe));
  };
  const front = h('div', { class: 'face front' });
  const back = h('div', { class: 'face back' });
  const card = h('button', { class: 'flashcard', type: 'button', 'aria-live': 'polite' }, h('span', { class: 'inner' }, front, back));
  // Par-dessus la carte (pas dedans : un bouton ne se met pas dans un bouton) : l'étoile et,
  // sur une carte souvent ratée en mode Apprendre, un repère orange ou rouge.
  const star = starButton(false, () => {
    let on = false;
    store.updateSet(set.id, (s) => { on = toggleFav(s, deck[i]); });
    paintScope();
    return on;
  }, { cls: 'card-star' });
  const flag = h('span', { class: 'hard-flag label', hidden: true }, h('i', { class: 'hard-dot' }), h('span', {}));
  const cardWrap = h('div', { class: 'card-wrap' }, card, flag, star);
  const controls = h('div', { class: 'controls' });
  const stage = h('div', { class: 'stage' });
  const tally = h('p', { class: 'tally label' });
  const hint = h('p', { class: 'hint label' });

  const toggle = (key, label) => h('button', {
    class: 'toggle', type: 'button', 'aria-pressed': String(prefs[key]),
    onclick: (e) => { prefs[key] = !prefs[key]; savePrefs(prefs); e.currentTarget.setAttribute('aria-pressed', String(prefs[key])); start(poolIds()); },
  }, label);
  // Choix du paquet, seulement s'il y a des favoris ou des cartes difficiles ; les nombres suivent
  // les étoiles ajoutées pendant la révision.
  const scope = h('div', { class: 'seg scope', role: 'group', 'aria-label': 'Cartes à réviser' });
  const paintScope = () => {
    const nFav = favCards(set).length, nHard = hardCards(set).length;
    scope.hidden = !nFav && !nHard;
    scope.replaceChildren(...[['', `Toutes (${set.cards.length})`], ['fav', `★ Favoris (${nFav})`, nFav], ['hard', `Difficiles (${nHard})`, nHard]]
      .filter(([v, , n]) => !v || n || v === only)
      .map(([v, text]) => h('a', { href: `#/l/${set.id}/cartes${v ? `?only=${v}` : ''}`, 'aria-pressed': String((only || '') === v), role: 'button' }, text)));
  };
  paintScope();

  function start(ids) {
    deck = prefs.shuffle ? shuffle(ids) : [...ids];
    i = 0; flipped = false; known = new Set(); review = new Set();
    paint();
  }

  function face(el, side, c) {
    const showDef = (side === 'front') === prefs.defFirst;
    const text = showDef ? c.d : c.t;
    el.className = `face ${side} ${sizeClass(text)}`;
    el.replaceChildren(h('span', { class: 'face-label label' }, showDef ? 'Définition' : 'Terme'), h('span', { class: 'face-text' }, text));
  }

  function paintMarks(id) {
    star.paint(isFav(set, id));
    const d = difficulty(set, id);
    flag.hidden = !d;
    if (d) {
      flag.dataset.level = d.level;
      flag.lastChild.textContent = `Ratée ${d.ko}×`;
      flag.title = describeDifficulty(d);
    }
    cardWrap.classList.toggle('is-flipped', flipped);
  }

  function paint() {
    if (i >= deck.length) return finish();
    const c = byId.get(deck[i]);
    face(front, 'front', c);
    face(back, 'back', c);
    card.classList.toggle('flipped', flipped);
    card.setAttribute('aria-label', flipped ? 'Carte retournée. Espace pour la retourner encore.' : 'Carte. Espace ou clic pour la retourner.');
    paintMarks(c.id);
    paintRing();
    hint.textContent = `Espace : retourner · ← → : ${prefs.sort ? 'à revoir / je sais' : 'précédente / suivante'} · E : favori`;
    tally.textContent = prefs.sort ? `Je sais ${known.size} · À revoir ${review.size}${round > 1 ? ` · tour ${round}` : ''}` : '';
    controls.replaceChildren(...(prefs.sort
      ? [h('button', { class: 'btn big', type: 'button', onclick: () => mark(false) }, h('span', { class: 'key' }, '←'), 'À revoir'),
        h('button', { class: 'btn big primary', type: 'button', onclick: () => mark(true) }, 'Je sais', h('span', { class: 'key' }, '→'))]
      : [h('button', { class: 'btn big', type: 'button', disabled: i === 0, onclick: () => move(-1) }, h('span', { class: 'key' }, '←'), 'Précédente'),
        h('button', { class: 'btn big', type: 'button', onclick: () => move(1) }, 'Suivante', h('span', { class: 'key' }, '→'))]));
    if (!stage.contains(card)) stage.replaceChildren(cardWrap, controls, tally);
  }

  function flip() { flipped = !flipped; card.classList.toggle('flipped', flipped); cardWrap.classList.toggle('is-flipped', flipped); card.setAttribute('aria-label', flipped ? 'Carte retournée.' : 'Carte.'); }
  function move(step) { if (step > 0) touch(); i = Math.max(0, i + step); flipped = false; paint(); }
  function mark(knows) {
    const id = deck[i];
    (knows ? known : review).add(id);
    (knows ? review : known).delete(id);
    move(1);
  }

  function finish() {
    paintRing();
    hint.textContent = '';
    const left = [...review];
    // Succès : un passage sur toute la liste ; tout su du premier coup (avec le tri).
    const whole = deck.length === set.cards.length;
    const got = [];
    store.updateSet(set.id, (s) => { got.push(...award(s, [whole && 'tour', whole && prefs.sort && round === 1 && !left.length && 'tout-su'])); });
    celebrate(got.map(describe));
    const big = ring({ size: 184, stroke: 9, cls: 'big-ring' });
    if (prefs.sort) big.label(h('span', { class: 'ring-big-label' }, `${known.size}/${deck.length}`)).show(known.size / deck.length, 1, true);
    else big.label(h('span', { class: 'ring-big-label' }, `${deck.length}/${deck.length}`)).show(1, 1, true);
    stage.replaceChildren(h('section', { class: 'done' },
      h('p', { class: 'label' }, round > 1 ? `Tour ${round} terminé` : 'Fin du paquet'),
      big,
      prefs.sort
        ? h('p', { class: 'lede' }, left.length ? `Tu connais ${plural(known.size, 'carte', 'cartes')}. Il en reste ${left.length} à revoir.` : round > 1 ? 'Tu connais maintenant toutes les cartes.' : 'Tu les connais toutes, du premier coup.')
        : h('p', { class: 'lede' }, `Les ${plural(deck.length, 'carte est passée', 'cartes sont passées')}.`),
      h('div', { class: 'row' },
        prefs.sort && left.length ? h('button', { class: 'btn primary', type: 'button', onclick: () => { round++; start(left); } }, left.length > 1 ? `Revoir les ${left.length} à revoir` : 'Revoir la carte à revoir') : null,
        h('button', { class: 'btn', type: 'button', onclick: () => { round = 1; start(poolIds()); } }, 'Tout recommencer'),
        set.cards.length > 1 ? h('a', { class: 'btn', href: `#/l/${set.id}/apprendre` }, 'Passer à Apprendre') : null)));
  }

  card.addEventListener('click', flip);
  addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, [contenteditable="true"]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (i >= deck.length) return;
    // Espace retourne toujours la carte (sans réactiver le dernier bouton cliqué) ; Entrée garde son rôle.
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); flip(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); prefs.sort ? mark(true) : move(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prefs.sort ? mark(false) : (i > 0 && move(-1)); }
    else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); star.click(); }
  }, { signal: ctx.signal });

  // Glisser sur écran tactile.
  let x0 = null, y0 = null;
  card.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  card.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    e.preventDefault(); // pas de retournement après un glissement
    if (dx > 0) prefs.sort ? mark(true) : move(1);
    else prefs.sort ? mark(false) : (i > 0 && move(-1));
  });

  ctx.root.append(
    h('p', { class: 'crumb label' }, h('a', { href: `#/l/${set.id}` }, set.title)),
    h('div', { class: 'study-head' },
      progress, h('h1', { class: 'mode-title' }, 'Cartes'),
      h('div', { class: 'toggles' }, toggle('sort', 'Trier'), toggle('shuffle', 'Mélanger'), toggle('defFirst', 'Définition d’abord'))),
    scope, stage, hint);
  if (asked && !only) toast(asked === 'fav' ? 'Aucune carte en favori : voici toute la liste.' : 'Aucune carte difficile : voici toute la liste.');
  start(poolIds());
}
