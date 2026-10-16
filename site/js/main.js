// Recto — point d'entrée : routeur par adresse (#/…), en-tête, curseur.
import { h } from './ui.js';
import * as store from './store.js';
import { renderHome } from './views/home.js';
import { renderImport } from './views/import.js';
import { renderSet } from './views/set.js';
import { renderCards } from './views/cards.js';
import { renderLearn } from './views/learn.js';
import { renderAccount } from './views/account.js';

const main = document.getElementById('main');
const header = document.getElementById('top');
let controller = null;

const ROUTES = [
  [/^\/?$/, renderHome],
  [/^\/importer$/, renderImport],
  [/^\/compte$/, renderAccount],
  [/^\/l\/([a-z0-9]+)$/, renderSet],
  [/^\/l\/([a-z0-9]+)\/ajouter$/, renderImport],
  [/^\/l\/([a-z0-9]+)\/cartes$/, renderCards],
  [/^\/l\/([a-z0-9]+)\/apprendre$/, renderLearn],
];

export const go = (path) => { location.hash = '#' + path; };

function paintHeader() {
  const u = store.currentUser();
  header.replaceChildren(
    h('a', { class: 'back-home', href: '../', title: 'Retour au portfolio' }, 'Tom Mehl'),
    h('a', { class: 'mark', href: '#/' }, 'Recto'),
    h('nav', { class: 'account', 'aria-label': 'Compte' },
      u ? h('a', { href: '#/compte', class: 'chip' }, u.username)
        : h('a', { href: '#/compte', class: 'chip' + (store.accountsAvailable() ? '' : ' off') }, store.accountsAvailable() ? 'Se connecter' : 'Compte')));
}

function route() {
  controller?.abort();
  controller = new AbortController();
  const path = location.hash.slice(1) || '/';
  const [clean, query = ''] = path.split('?');
  for (const [re, view] of ROUTES) {
    const m = clean.match(re);
    if (!m) continue;
    main.replaceChildren();
    // Les vues passent parfois `null` pour « rien ici » : on l'écarte (append l'écrirait en toutes lettres).
    const root = { append: (...kids) => main.append(...kids.flat(Infinity).filter((k) => k != null && k !== false)) };
    const ctx = { root, params: m.slice(1), query: new URLSearchParams(query), signal: controller.signal, go, path: clean };
    view(ctx);
    main.focus({ preventScroll: true });
    scrollTo(0, 0);
    return;
  }
  go('/');
}

store.onChange(paintHeader);
addEventListener('hashchange', route);

// Curseur du portfolio : un disque qui inverse ce qu'il survole ; le curseur normal revient
// dans les champs de texte (on doit voir où l'on écrit). Souris uniquement.
function cursor() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const c = h('div', { class: 'cursor', 'aria-hidden': 'true' });
  document.body.append(c);
  document.documentElement.classList.add('custom-cursor');
  let x = 0, y = 0, frame = 0;
  addEventListener('mousemove', (e) => {
    x = e.clientX; y = e.clientY;
    if (!frame) frame = requestAnimationFrame(() => { c.style.transform = `translate(${x}px, ${y}px)`; frame = 0; });
    const typing = e.target.closest('input, textarea, select, [contenteditable="true"]');
    c.classList.toggle('on', !typing);
    c.classList.toggle('big', !!e.target.closest('a, button, summary, label, .flashcard'));
  }, { passive: true });
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) c.classList.remove('on'); });
  addEventListener('mousedown', () => c.classList.add('down'));
  addEventListener('mouseup', () => c.classList.remove('down'));
}

(async () => {
  paintHeader();
  main.replaceChildren(h('p', { class: 'loading label' }, 'Chargement…'));
  await store.init();
  paintHeader();
  cursor();
  route();
})();
