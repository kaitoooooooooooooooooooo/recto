// Une liste : les deux modes, la progression, et les cartes (modifiables sur place).
import { h, toast, confirmDialog, plural, ring } from '../ui.js';
import * as store from '../store.js';
import { stats, levelOf, paliers, currentPalier, MASTERED, LEARNING } from '../learn.js';
import { palierTrack, achievementList, starButton } from './parts.js';
import { isFav, toggleFav, favCards, difficulty, hardCards, describeDifficulty } from '../marks.js';

export function renderSet(ctx) {
  const set = store.getSet(ctx.params[0]);
  if (!set) return ctx.go('/');
  const st = stats(set);
  const ps = paliers(set), cur = currentPalier(set);
  const learnLabel = st.total < 2 ? 'Il faut au moins 2 cartes'
    : cur === -1 ? 'Liste maîtrisée · tout revoir'
      : ps.length > 1 ? `${cur > 0 || st.mastered + st.learning > 0 ? 'Reprendre au' : 'Commencer au'} palier ${cur + 1} sur ${ps.length}`
        : 'Choix multiple, puis réponse écrite';
  const overall = ring({ size: 96, stroke: 6, cls: 'set-ring' })
    .label(h('span', { class: 'ring-pct' }, `${st.total ? Math.round((st.mastered / st.total) * 100) : 0}`, h('small', {}, '%')))
    .describe(`${st.mastered} maîtrisées, ${st.learning} en cours, ${st.fresh} nouvelles`);
  if (st.total) overall.show(st.mastered / st.total, (st.mastered + st.learning) / st.total);

  const title = h('h1', { class: 'editable', contenteditable: 'true', spellcheck: 'false', 'aria-label': 'Titre (modifiable)' }, set.title);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  title.addEventListener('blur', () => {
    const v = title.textContent.trim();
    if (v && v !== set.title) store.updateSet(set.id, (s) => { s.title = v.slice(0, 120); });
    else title.textContent = set.title;
  });

  const cell = (card, key) => {
    const el = h('span', { class: `cell ${key}`, contenteditable: 'true', spellcheck: 'false', 'aria-label': key === 't' ? 'Terme' : 'Définition' }, card[key]);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); } });
    el.addEventListener('blur', () => {
      const v = el.textContent.trim();
      if (!v) { el.textContent = card[key]; return; }
      if (v !== card[key]) store.updateSet(set.id, (s) => { s.cards.find((c) => c.id === card.id)[key] = v; });
    });
    return el;
  };
  const dot = (card) => {
    const lv = levelOf(set.prog, card.id);
    return h('span', { class: 'lv lv' + lv, title: lv >= MASTERED ? 'Maîtrisée' : lv === LEARNING ? 'En cours' : 'Nouvelle' });
  };

  // Repères : étoile (favori) et couleur de difficulté (erreurs en mode Apprendre). Le numéro de
  // ligne laisse place au nombre d'erreurs (« 3× ») sur les cartes difficiles.
  let filter = ['fav', 'hard'].includes(ctx.query.get('f')) ? ctx.query.get('f') : 'all';
  const rows = set.cards.map((c, i) => {
    const hard = difficulty(set, c.id);
    const star = starButton(isFav(set, c.id), () => {
      let on = false;
      store.updateSet(set.id, (s) => { on = toggleFav(s, c.id); });
      paintTools();
      return on;
    });
    return h('li', { 'data-id': c.id, 'data-hard': hard?.level ?? null, title: hard ? describeDifficulty(hard) : null },
      h('span', { class: 'n' + (hard ? ' miss' : '') }, hard ? `${hard.ko}×` : String(i + 1)), dot(c), cell(c, 't'), cell(c, 'd'), star,
      h('button', {
        class: 'icon', type: 'button', 'aria-label': `Supprimer la carte « ${c.t} »`, title: 'Supprimer la carte',
        onclick: () => {
          store.updateSet(set.id, (s) => {
            s.cards = s.cards.filter((x) => x.id !== c.id);
            delete s.prog?.[c.id];
            if (s.fav) s.fav = s.fav.filter((x) => x !== c.id);
          });
          ctx.go(`/l/${set.id}?r=${Date.now()}${filter !== 'all' ? `&f=${filter}` : ''}`);
        },
      }, '×'));
  });
  const list = h('ol', { class: 'cards' }, rows);

  // Filtres de la liste, et raccourcis pour réviser seulement les cartes filtrées.
  const filterBtns = [['all', 'Toutes'], ['fav', 'Favoris'], ['hard', 'Difficiles']].map(([v]) => h('button', {
    type: 'button', 'data-v': v, onclick: () => { filter = v; paintTools(); },
  }));
  const studyLinks = h('span', { class: 'study-links' });
  const listEmpty = h('p', { class: 'list-empty muted' });
  const legend = h('p', { class: 'hard-legend label' },
    h('span', {}, h('i', { class: 'hard-dot orange' }), ' Ratée 2 fois ou plus'),
    h('span', {}, h('i', { class: 'hard-dot red' }), ' Ratée au moins une fois sur deux'));
  function paintTools() {
    const nf = favCards(set).length, nh = hardCards(set).length;
    const count = { all: set.cards.length, fav: nf, hard: nh };
    filterBtns.forEach((b) => {
      const v = b.dataset.v;
      b.setAttribute('aria-pressed', String(v === filter));
      b.textContent = `${{ all: 'Toutes', fav: '★ Favoris', hard: 'Difficiles' }[v]} (${count[v]})`;
    });
    rows.forEach((li) => {
      const id = li.dataset.id;
      li.hidden = filter === 'fav' ? !isFav(set, id) : filter === 'hard' ? !difficulty(set, id) : false;
    });
    const shown = count[filter];
    listEmpty.hidden = filter === 'all' || shown > 0;
    listEmpty.textContent = filter === 'fav'
      ? 'Aucune carte en favori. Clique sur l’étoile d’une carte pour l’ajouter.'
      : 'Aucune carte difficile pour l’instant : elles apparaissent ici quand tu en rates une plusieurs fois en mode Apprendre.';
    legend.hidden = nh === 0;
    studyLinks.replaceChildren(...(filter !== 'all' && shown > 0 ? [
      h('a', { class: 'btn small', href: `#/l/${set.id}/cartes?only=${filter}` }, 'Réviser en mode Cartes'),
      shown > 1 ? h('a', { class: 'btn small', href: `#/l/${set.id}/apprendre?only=${filter}` }, 'En mode Apprendre') : null,
    ].filter(Boolean) : []));
  }
  const tools = h('div', { class: 'list-tools' },
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Afficher' }, filterBtns), studyLinks, legend);
  paintTools();

  // Ajout d'une carte à la main, en bas de la liste.
  const t = h('input', { type: 'text', placeholder: 'Terme', 'aria-label': 'Nouveau terme', maxlength: 500 });
  const d = h('input', { type: 'text', placeholder: 'Définition', 'aria-label': 'Nouvelle définition', maxlength: 2000 });
  const add = h('form', {
    class: 'add-card',
    onsubmit: (e) => {
      e.preventDefault();
      if (!t.value.trim() || !d.value.trim()) { (t.value.trim() ? d : t).focus(); return; }
      store.updateSet(set.id, (s) => { s.cards.push({ id: store.newId(8), t: t.value.trim(), d: d.value.trim() }); });
      ctx.go(`/l/${set.id}?add=${Date.now()}`);
    },
  }, t, d, h('button', { class: 'btn small', type: 'submit' }, 'Ajouter'));

  const empty = !set.cards.length;
  ctx.root.append(
    h('p', { class: 'crumb label' }, h('a', { href: '#/' }, 'Mes listes')),
    h('section', { class: 'set-head' }, title,
      h('p', { class: 'label' }, plural(st.total, 'carte', 'cartes'), ' · ', `${st.mastered} maîtrisée${st.mastered > 1 ? 's' : ''}`)),
    h('div', { class: 'modes' },
      h('a', { class: 'mode' + (empty ? ' off' : ''), href: empty ? null : `#/l/${set.id}/cartes` },
        h('span', { class: 'mode-name' }, 'Cartes'), h('span', { class: 'label' }, 'Retourner, trier, revoir les cartes à revoir')),
      h('a', { class: 'mode' + (empty ? ' off' : ''), href: empty || st.total < 2 ? null : `#/l/${set.id}/apprendre` },
        h('span', { class: 'mode-name' }, 'Apprendre'), h('span', { class: 'label' }, learnLabel))),
    h('div', { class: 'progress-block set-progress' },
      overall,
      h('div', { class: 'progress-text' },
        h('p', { class: 'legend label' },
          h('span', {}, h('i', { class: 'lv lv2' }), ` ${st.mastered} maîtrisée${st.mastered > 1 ? 's' : ''}`),
          h('span', {}, h('i', { class: 'lv lv1' }), ` ${st.learning} en cours`),
          h('span', {}, h('i', { class: 'lv lv0' }), ` ${st.fresh} nouvelle${st.fresh > 1 ? 's' : ''}`)),
        ps.length > 1 ? h('p', { class: 'label muted' }, `${ps.length} paliers d’environ ${ps[0].length} cartes${set.mix ? ' · ordre mélangé' : ''}`) : null,
        st.total ? palierTrack().update(set) : null)),
    st.total ? achievementList(set) : null,
    h('section', { class: 'cards-head' },
      h('h2', { class: 'label' }, 'Cartes'),
      h('span', { class: 'label muted' }, 'Clique sur un terme ou une définition pour le corriger.'),
      h('a', { class: 'btn small', href: `#/l/${set.id}/ajouter` }, 'Coller d’autres cartes')),
    st.total ? tools : null, list, listEmpty, add,
    h('section', { class: 'danger-zone' },
      h('button', {
        class: 'linklike', type: 'button',
        onclick: async () => {
          if (!(await confirmDialog('Remettre à zéro la progression de cette liste ?', { ok: 'Remettre à zéro' }))) return;
          store.updateSet(set.id, (s) => { s.prog = {}; });
          toast('Progression remise à zéro.');
          ctx.go(`/l/${set.id}?reset=${Date.now()}`);
        },
      }, 'Remettre la progression à zéro'),
      h('button', {
        class: 'linklike danger', type: 'button',
        onclick: async () => {
          if (!(await confirmDialog(`Supprimer « ${set.title} » et ses ${plural(set.cards.length, 'carte', 'cartes')} ?`, { ok: 'Supprimer', danger: true }))) return;
          await store.deleteSet(set.id);
          toast('Liste supprimée.');
          ctx.go('/');
        },
      }, 'Supprimer la liste')));
  // Après un ajout, on reste dans le champ pour enchaîner les cartes.
  if (ctx.query.has('add')) { t.focus(); add.scrollIntoView({ block: 'center' }); }
}
