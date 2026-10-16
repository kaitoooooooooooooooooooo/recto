// Accueil : les listes, et l'import d'une nouvelle liste.
import { h, plural, fmtDate } from '../ui.js';
import * as store from '../store.js';
import { stats } from '../learn.js';

const SAMPLE = `Suisse\tBerne
Italie\tRome
Espagne\tMadrid
Portugal\tLisbonne
Autriche\tVienne
Belgique\tBruxelles
Pays-Bas\tAmsterdam
Suède\tStockholm
Norvège\tOslo
Hongrie\tBudapest`;

export function renderHome(ctx) {
  const sets = store.allSets();
  const user = store.currentUser();
  const rows = sets.map((s, i) => {
    const st = stats(s);
    const pct = st.total ? Math.round((st.mastered / st.total) * 100) : 0;
    return h('li', {},
      h('a', { href: `#/l/${s.id}` },
        h('span', { class: 'n' }, String(i + 1).padStart(2, '0')),
        h('span', { class: 'name' }, s.title),
        h('span', { class: 'meta' }, plural(st.total, 'carte', 'cartes')),
        h('span', { class: 'meter', title: `${pct} % maîtrisé`, 'aria-label': `${pct} % maîtrisé` }, h('span', { style: `width:${pct}%` })),
        h('span', { class: 'meta date' }, fmtDate(s.updated))));
  });

  ctx.root.append(
    h('section', { class: 'page-head' },
      h('h1', {}, 'Mes listes'),
      sets.length ? h('a', { class: 'btn primary', href: '#/importer' }, 'Importer une liste') : null),
    sets.length
      ? h('ol', { class: 'index' }, rows)
      : h('section', { class: 'empty' },
        h('p', { class: 'lede' }, 'Colle une liste de mots et leurs définitions, puis révise-la en mode Cartes ou Apprendre.'),
        h('div', { class: 'row' },
          h('a', { class: 'btn primary', href: '#/importer' }, 'Importer une liste'),
          h('button', {
            class: 'btn', type: 'button',
            onclick: () => { const s = store.createSet('Capitales d’Europe (exemple)', SAMPLE.split('\n').map((l) => { const [t, d] = l.split('\t'); return { t, d }; })); ctx.go(`/l/${s.id}`); },
          }, 'Essayer avec un exemple'))),
    !user ? h('p', { class: 'note label' },
      store.accountsAvailable()
        ? ['Sans compte, tes listes restent dans ce navigateur. ', h('a', { href: '#/compte?m=inscription' }, 'Crée un compte'), ' pour les retrouver sur tous tes appareils.']
        : ['Les comptes ne sont pas encore actifs sur ce site : tes listes restent dans ce navigateur et n’apparaissent pas sur tes autres appareils. ', h('a', { href: '#/compte' }, 'Pourquoi ?')]) : null);
}
