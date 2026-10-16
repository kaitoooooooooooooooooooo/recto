// Morceaux partagés entre les vues : la rangée des paliers et la liste des succès.
import { h, ring, checkIcon, starIcon } from '../ui.js';
import { paliers, currentPalier, palierStats } from '../learn.js';
import { ACHIEVEMENTS } from '../achievements.js';

// Un petit anneau par palier, reliés par un trait : plein = franchi, souligné = en cours.
export function palierTrack() {
  const el = h('ol', { class: 'track', 'aria-label': 'Paliers' });
  let nodes = [];
  el.update = (set) => {
    const ps = paliers(set), cur = currentPalier(set);
    const fresh = nodes.length !== ps.length;
    if (fresh) {
      nodes = ps.map(() => ring({ size: 22, stroke: 3, cls: 'node' }));
      el.replaceChildren(...nodes.map((r) => h('li', {}, r)));
    }
    ps.forEach((ids, i) => {
      const st = palierStats(set, ids);
      const done = st.mastered === st.total;
      const li = el.children[i];
      li.className = done ? 'is-done' : i === cur ? 'is-current' : '';
      li.title = `Palier ${i + 1} : ${st.mastered} / ${st.total} maîtrisées`;
      if (li.dataset.done !== String(done)) nodes[i].label(done ? checkIcon() : null); // la coche ne se redessine qu'une fois
      li.dataset.done = String(done);
      nodes[i][fresh ? 'show' : 'set'](st.mastered / st.total, (st.mastered + st.learning) / st.total, false);
    });
    el.hidden = ps.length < 2;
    return el;
  };
  return el;
}

// Tous les succès d'une liste : ceux obtenus en plein, les autres en pointillé (avec le but à atteindre).
export function achievementList(set) {
  const got = ACHIEVEMENTS.filter((a) => set.ach?.[a.id]).length;
  return h('section', { class: 'achievements' },
    h('div', { class: 'cards-head' },
      h('h2', { class: 'label' }, 'Succès'),
      h('span', { class: 'label muted' }, `${got} / ${ACHIEVEMENTS.length}`)),
    h('ul', { class: 'badges' }, ACHIEVEMENTS.map((a) => {
      const on = !!set.ach?.[a.id];
      return h('li', { class: 'badge' + (on ? ' on' : '') },
        h('span', { class: 'badge-icon', 'aria-hidden': 'true' }, on ? checkIcon() : null),
        h('span', { class: 'badge-text' },
          h('span', { class: 'badge-title' }, a.title, h('span', { class: 'sr-only' }, on ? ' (obtenu)' : ' (à obtenir)')),
          h('span', { class: 'badge-desc' }, a.desc)));
    })));
}

// Étoile « favori » : pleine quand la carte est en favori ; `toggle()` renvoie le nouvel état.
export function starButton(on, toggle, { cls = '' } = {}) {
  const btn = h('button', { class: `star ${cls}`.trim(), type: 'button' }, starIcon());
  const paint = (v) => {
    btn.setAttribute('aria-pressed', String(v));
    btn.setAttribute('aria-label', v ? 'Retirer des favoris' : 'Ajouter aux favoris');
    btn.title = v ? 'Retirer des favoris' : 'Ajouter aux favoris';
  };
  paint(on);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const v = toggle();
    paint(v);
    btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump');
  });
  btn.paint = paint;
  return btn;
}
