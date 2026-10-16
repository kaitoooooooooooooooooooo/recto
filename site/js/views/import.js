// Importer une liste collée (nouvelle liste, ou cartes ajoutées à une liste existante).
// Les séparateurs sont devinés ; on peut les forcer. L'aperçu se met à jour en tapant.
import { h, toast, plural } from '../ui.js';
import * as store from '../store.js';
import { parseList } from '../parse.js';

const BETWEEN = [['auto', 'Auto'], ['tab', 'Tabulation'], ['dash', '« - »'], ['colon', '« : »'], ['equals', '« = »'], ['comma', 'Virgule'], ['custom', 'Autre']];
const ROWS = [['auto', 'Auto'], ['newline', 'Retour à la ligne'], ['semicolon', '« ; »'], ['custom', 'Autre']];
const LABEL = Object.fromEntries(BETWEEN);

export function renderImport(ctx) {
  const target = ctx.params[0] ? store.getSet(ctx.params[0]) : null;
  if (ctx.params[0] && !target) return ctx.go('/');
  const opts = { between: 'auto', rows: 'auto', customBetween: '', customRows: '' };
  let swapped = false;

  const title = h('input', { class: 'title-input', type: 'text', maxlength: 120, placeholder: 'Titre de la liste', 'aria-label': 'Titre de la liste', required: true });
  const text = h('textarea', {
    class: 'paste', rows: 12, spellcheck: 'false', 'aria-label': 'Liste à importer',
    placeholder: 'Colle ta liste ici, une carte par ligne :\n\nmitochondrie\tcentrale énergétique de la cellule\nribosome - fabrique les protéines\nnoyau : contient l’ADN\n\nUn export Quizlet, Excel ou Google Sheets se colle tel quel.',
  });
  const preview = h('div', { class: 'preview-list' });
  const summary = h('p', { class: 'label' });
  const submit = h('button', { class: 'btn primary', type: 'submit' });
  const swap = h('button', { class: 'toggle', type: 'button', onclick: () => { swapped = !swapped; update(); } }, 'Inverser terme et définition');

  const seg = (name, options, key) => {
    const custom = h('input', { class: 'custom-sep', type: 'text', maxlength: 5, placeholder: 'sép.', 'aria-label': `Séparateur personnalisé (${name})`, hidden: true,
      oninput: (e) => { opts[key === 'between' ? 'customBetween' : 'customRows'] = e.target.value; update(); } });
    const group = h('div', { class: 'seg', role: 'group', 'aria-label': name },
      options.map(([v, label]) => h('button', {
        type: 'button', 'aria-pressed': String(opts[key] === v),
        onclick: (e) => {
          opts[key] = v;
          group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
          custom.hidden = v !== 'custom';
          if (v === 'custom') custom.focus();
          update();
        },
      }, label)), custom);
    return h('div', { class: 'opt' }, h('span', { class: 'label' }, name), group);
  };

  let parsed = { cards: [] };
  function update() {
    parsed = parseList(text.value, opts);
    const cards = swapped ? parsed.cards.map((c) => ({ t: c.d, d: c.t })) : parsed.cards;
    parsed.cards = cards;
    const n = cards.length;
    summary.replaceChildren(
      n ? plural(n, 'carte', 'cartes') : 'Aucune carte',
      opts.between === 'auto' && n ? ` · séparateur détecté : ${LABEL[parsed.between]}` : '',
      parsed.skipped ? ` · ${plural(parsed.skipped, 'ligne ignorée', 'lignes ignorées')} (sans séparateur)` : '');
    const rows = cards.slice(0, 60).map((c, i) => h('div', { class: 'pv-row' },
      h('span', { class: 'n' }, String(i + 1)), h('span', { class: 'pv-t' }, c.t), h('span', { class: 'pv-d' }, c.d)));
    if (n > 60) rows.push(h('p', { class: 'label more' }, `… et ${n - 60} de plus`));
    preview.replaceChildren(...rows);
    swap.setAttribute('aria-pressed', String(swapped));
    if (target) submit.textContent = n ? `Ajouter ${plural(n, 'carte', 'cartes')}` : 'Ajouter';
    else submit.textContent = n ? `Créer la liste (${plural(n, 'carte', 'cartes')})` : 'Créer la liste';
    submit.disabled = !n;
  }
  text.addEventListener('input', update);
  // Tab écrit une tabulation (pour taper « terme ⇥ définition ») ; Échap puis Tab pour quitter le champ.
  let escaped = false;
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { escaped = true; return; }
    if (e.key === 'Tab' && !e.shiftKey && !escaped) {
      e.preventDefault();
      text.setRangeText('\t', text.selectionStart, text.selectionEnd, 'end');
      update();
    }
    if (e.key !== 'Tab') escaped = false;
  });

  const form = h('form', {
    class: 'import',
    onsubmit: (e) => {
      e.preventDefault();
      if (!parsed.cards.length) return;
      if (target) {
        store.updateSet(target.id, (s) => { s.cards.push(...parsed.cards.map((c) => ({ id: store.newId(8), ...c }))); });
        toast(`${plural(parsed.cards.length, 'carte ajoutée', 'cartes ajoutées')}`);
        ctx.go(`/l/${target.id}`);
      } else {
        if (!title.value.trim()) { title.focus(); toast('Donne un titre à ta liste.'); return; }
        const s = store.createSet(title.value, parsed.cards);
        ctx.go(`/l/${s.id}`);
      }
    },
  },
  h('section', { class: 'page-head' },
    h('h1', {}, target ? 'Ajouter des cartes' : 'Importer une liste'),
    h('a', { class: 'btn ghost', href: target ? `#/l/${target.id}` : '#/' }, 'Annuler')),
  target ? h('p', { class: 'label' }, `Dans « ${target.title} »`) : title,
  text,
  h('div', { class: 'opts' },
    seg('Entre le terme et la définition', BETWEEN, 'between'),
    seg('Entre les cartes', ROWS, 'rows'),
    swap),
  h('div', { class: 'preview-head' }, summary, submit),
  preview);

  ctx.root.append(form);
  update();
  (target ? text : title).focus();
}
