// Mode « Apprendre » : la liste est découpée en paliers d'environ 7 cartes, travaillés l'un
// après l'autre, par manches. Une carte nouvelle se présente en choix multiple ; une carte en
// cours demande la réponse écrite. Une erreur fait revenir la carte en fin de manche. Quand
// toutes les cartes d'un palier sont maîtrisées : écran d'étape, puis palier suivant ou pause.
// La progression est enregistrée après chaque réponse ; les succès s'affichent au fil de l'eau.
import { h, plural, ring, checkIcon, celebrate, toast } from '../ui.js';
import * as store from '../store.js';
import { grade, CHECK_MODES } from '../check.js';
import { stats, makeRound, choicesFor, promptOf, answerOf, applyAnswer, levelOf, questionType, paliers, currentPalier, palierStats, newMix } from '../learn.js';
import { award, describe, noteDay, dayAwards, streakAwards, masteryAwards, palierAwards } from '../achievements.js';
import { palierTrack, starButton } from './parts.js';
import { isFav, toggleFav, favCards, hardCards } from '../marks.js';

const PREFS = 'fiches:learn';
const DEFAULTS = { dir: 'term', types: 'both', check: 'souple', scope: 'all' };
const SCOPE_NAME = { fav: 'favorites', hard: 'difficiles' };
const readPrefs = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS) || '{}') }; } catch { return { ...DEFAULTS }; } };
const savePrefs = (p) => { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* sans stockage */ } };
const s_ = (n) => (n > 1 ? 's' : '');
const AUTO = 1500;   // ms avant la question suivante après une réponse juste sans remarque

const OPTIONS = {
  dir: [['term', 'Terme → définition'], ['def', 'Définition → terme']],
  types: [['both', 'Choix + écrit'], ['choice', 'Choix'], ['written', 'Écrit']],
  check: [['souple', 'Souple'], ['normal', 'Normale'], ['strict', 'Stricte']],
};
const CHECK_HELP = {
  souple: 'Majuscules, accents, ponctuation, article oublié et petite faute de frappe pardonnés ; un seul synonyme suffit.',
  normal: 'Majuscules, accents et ponctuation ignorés, mais aucune faute de frappe ni article oublié.',
  strict: 'Orthographe exacte, accents, tirets et article compris, réponse complète. Seules les majuscules et la ponctuation ne comptent pas.',
};

export function renderLearn(ctx) {
  const id = ctx.params[0];
  const set0 = store.getSet(id);
  if (!set0 || set0.cards.length < 2) return ctx.go(set0 ? `/l/${id}` : '/');
  const prefs = readPrefs();
  const set = () => store.getSet(id);
  const card = (cid) => set().cards.find((c) => c.id === cid);
  // Cartes travaillées : toute la liste, ou seulement les favoris / les difficiles (réglage
  // « Cartes », ou ?only=… depuis la page de la liste, sans changer le réglage enregistré).
  // Les paliers se font sur ces cartes-là ; s'il n'y en a aucune, on prend toute la liste.
  const askedOnly = ctx.query.get('only');
  if (askedOnly === 'fav' || askedOnly === 'hard') prefs.scope = askedOnly;
  const scopeOf = (s = set()) => (prefs.scope === 'fav' && favCards(s).length ? 'fav' : prefs.scope === 'hard' && hardCards(s).length ? 'hard' : 'all');
  const poolOf = (s) => { const sc = scopeOf(s); return sc === 'all' ? s : { ...s, cards: sc === 'fav' ? favCards(s) : hardCards(s) }; };
  const pool = () => poolOf(set());

  let queue = [], pos = 0, retried = new Set(), roundDone = { ok: 0, ko: 0 };
  let answered = false, onContinue = null, keyHandler = null, onCountWrong = null;
  let autoTimer = 0;                 // passage automatique à la question suivante après une bonne réponse
  ctx.signal.addEventListener('abort', () => clearTimeout(autoTimer));
  let roundPalier = -1;              // palier travaillé par la manche en cours
  let streak = 0, dayNoted = false;  // bonnes réponses d'affilée (cette séance)
  const sessionGot = new Set();      // succès débloqués pendant cette séance

  const stage = h('div', { class: 'learn-stage' });
  const hint = h('p', { class: 'hint label' });

  // En-tête : l'anneau du palier en cours, son nom, la rangée des paliers, la série.
  const headRing = ring({ size: 68, stroke: 5, cls: 'head-ring' });
  const headTitle = h('p', { class: 'palier-name' });
  const headSub = h('p', { class: 'label muted' });
  const streakChip = h('span', { class: 'streak label', hidden: true });
  const track = palierTrack();
  const head = h('div', { class: 'palier-head' }, headRing,
    h('div', { class: 'palier-text' }, headTitle, headSub, track), streakChip);
  let headShown = false;

  function paintHead() {
    const s = pool();
    const ps = paliers(s);
    const cur = currentPalier(s);
    // Pendant une manche (et sur l'écran d'étape), on montre le palier de la manche : il se remplit.
    const k = roundPalier !== -1 && roundPalier < ps.length ? roundPalier : cur === -1 ? ps.length - 1 : cur;
    const st = palierStats(s, ps[k]);
    const v = st.mastered / st.total, v2 = (st.mastered + st.learning) / st.total;
    headRing.label(`${st.mastered}/${st.total}`).describe(`${st.mastered} cartes maîtrisées sur ${st.total} dans ce palier`);
    headShown ? headRing.set(v, v2) : headRing.show(v, v2);
    headShown = true;
    const sc = scopeOf();
    headTitle.textContent = ps.length > 1 ? `Palier ${k + 1} sur ${ps.length}` : sc === 'all' ? 'Toute la liste' : `Cartes ${SCOPE_NAME[sc]}`;
    headSub.textContent = `${st.mastered} maîtrisée${s_(st.mastered)} · ${st.learning} en cours · ${st.fresh} nouvelle${s_(st.fresh)}`;
    track.update(s);
  }

  function paintStreak() {
    streakChip.hidden = streak < 2;
    streakChip.textContent = `Série ${streak}`;
    if (streak >= 2) { streakChip.classList.remove('bump'); void streakChip.offsetWidth; streakChip.classList.add('bump'); }
  }

  // Réglages repliés sous un bouton qui résume les choix. Le sens et le type de questions relancent
  // la manche ; la correction s'applique dès la réponse suivante.
  if (!CHECK_MODES.includes(prefs.check)) prefs.check = 'souple';
  const label = (key) => OPTIONS[key].find(([v]) => v === prefs[key])?.[1] ?? '';
  const summary = h('summary', { class: 'toggle settings-summary' });
  const help = h('p', { class: 'settings-help' });
  const paintSettings = () => {
    const sc = scopeOf();
    summary.textContent = `Réglages · ${label('dir')} · ${label('types')} · correction ${label('check').toLowerCase()}${set().mix ? ' · mélangé' : ''}${sc !== 'all' ? ` · ${sc === 'fav' ? 'favoris' : 'difficiles'} seulement` : ''}`;
    const count = { all: set().cards.length, fav: favCards(set()).length, hard: hardCards(set()).length };
    scopeBtns.forEach((b) => {
      const v = b.dataset.v;
      b.textContent = `${{ all: 'Toutes', fav: '★ Favoris', hard: 'Difficiles' }[v]} (${count[v]})`;
      b.disabled = v !== 'all' && !count[v];
      b.setAttribute('aria-pressed', String(v === sc));
    });
    orderBtns.forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.v === 'mix') === !!set().mix)));
    remix.hidden = !set().mix;
    help.textContent = `${CHECK_HELP[prefs.check]} Partout, ce qui est entre parenthèses est facultatif.`;
  };
  const seg = (key, name) => h('div', { class: 'opt' }, h('span', { class: 'label' }, name),
    h('div', { class: 'seg', role: 'group', 'aria-label': name }, OPTIONS[key].map(([v, text]) => h('button', {
      type: 'button', 'aria-pressed': String(prefs[key] === v),
      onclick: (e) => {
        if (prefs[key] === v) return;
        prefs[key] = v; savePrefs(prefs);
        e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        paintSettings();
        if (key !== 'check') newRound();
        else stage.querySelector('.answer:not([disabled])')?.focus({ preventScroll: true }); // on reprend la saisie
      },
    }, text))));
  // L'ordre est rangé dans la liste (comme la progression) : il la suit sur tous les appareils.
  const setOrder = (mix) => {
    store.updateSet(id, (s) => { if (mix) s.mix = mix; else delete s.mix; });
    paintSettings();
    newRound();
  };
  const orderBtns = [['list', 'Ordre de la liste'], ['mix', 'Mélangé']].map(([v, text]) => h('button', {
    type: 'button', 'data-v': v,
    onclick: () => { if ((v === 'mix') !== !!set().mix) setOrder(v === 'mix' ? newMix() : null); },
  }, text));
  const scopeBtns = ['all', 'fav', 'hard'].map((v) => h('button', {
    type: 'button', 'data-v': v,
    onclick: () => { if (scopeOf() === v) return; prefs.scope = v; savePrefs(prefs); paintSettings(); newRound(); },
  }));
  const scopeRow = h('div', { class: 'opt' }, h('span', { class: 'label' }, 'Cartes'),
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Cartes' }, scopeBtns));
  const remix = h('button', { class: 'linklike', type: 'button', onclick: () => { setOrder(newMix()); toast('Nouveau mélange : les paliers sont recomposés.'); } }, 'Remélanger');
  const order = h('div', { class: 'opt' }, h('span', { class: 'label' }, 'Ordre'),
    h('div', { class: 'order-row' }, h('div', { class: 'seg', role: 'group', 'aria-label': 'Ordre' }, orderBtns), remix));
  const settings = h('details', { class: 'settings' }, summary,
    h('div', { class: 'settings-body' }, seg('dir', 'Sens'), seg('types', 'Questions'), seg('check', 'Correction'), scopeRow, order, help));
  paintSettings();

  function newRound() {
    // Entrée ne doit plus relancer la manche une fois qu'on y est (sinon elle efface la réponse en cours).
    onContinue = null;
    clearTimeout(autoTimer);
    const s = pool();
    roundPalier = currentPalier(s);
    paintHead();
    if (roundPalier === -1) return allDone();
    queue = makeRound(s, { types: prefs.types, ids: paliers(s)[roundPalier] });
    pos = 0; retried = new Set(); roundDone = { ok: 0, ko: 0 };
    ask();
  }

  // Enregistre la réponse, puis les succès qu'elle débloque.
  function record(cid, type, correct, { prog = null, streakTo = null } = {}) {
    const got = [];
    store.updateSet(id, (s) => {
      s.prog = applyAnswer(prog ?? s.prog, cid, { correct, type, types: prefs.types });
      if (!dayNoted) { dayNoted = true; noteDay(s); got.push(...award(s, dayAwards(s))); }
      streak = streakTo ?? (correct ? streak + 1 : 0);
      got.push(...award(s, [...streakAwards(streak), ...masteryAwards(s)]));
    });
    got.forEach((a) => sessionGot.add(a));
    celebrate(got.map(describe));
    paintHead();
    paintStreak();
    return got;
  }

  function ask() {
    onContinue = null;
    onCountWrong = null;
    clearTimeout(autoTimer);
    if (pos >= queue.length) return roundEnd();
    answered = false;
    const item = queue[pos];
    const c = card(item.id);
    if (!c) { pos++; return ask(); }
    const prompt = promptOf(c, prefs.dir);
    const expected = answerOf(c, prefs.dir);
    const feedback = h('div', { class: 'feedback', 'aria-live': 'polite' });
    const qhead = h('div', { class: 'q-head' },
      h('span', { class: 'label' }, prefs.dir === 'def' ? 'Définition' : 'Terme'),
      h('span', { class: 'label muted' }, item.type === 'choice' ? 'Choisis la bonne réponse' : 'Écris la réponse'),
      h('span', { class: 'label counter' }, `${pos + 1} / ${queue.length}`),
      starButton(isFav(set(), c.id), () => {
        let on = false;
        store.updateSet(id, (x) => { on = toggleFav(x, c.id); });
        paintSettings();
        return on;
      }, { cls: 'q-star' }));
    const q = h('p', { class: 'q-prompt' + (prompt.length > 120 ? ' long' : '') }, prompt);
    let answerBox;
    const snapshot = structuredClone(set().prog || {});
    const streakBefore = streak;

    // Bonne réponse : on passe tout seul à la suite après `auto` ms (la barre du bouton montre l'attente) ;
    // Entrée ou un clic passent tout de suite. Mauvaise réponse : on attend, le temps de lire la correction.
    const showContinue = (extra = [], auto = 0) => {
      const btn = h('button', { class: 'btn primary' + (auto ? ' auto' : ''), type: 'button', onclick: () => next() }, 'Continuer', h('span', { class: 'key' }, 'Entrée'));
      if (auto) { btn.style.setProperty('--auto', `${auto}ms`); autoTimer = setTimeout(next, auto); }
      feedback.append(h('div', { class: 'row end' }, ...extra, btn));
      onContinue = next;
      btn.focus({ preventScroll: true });
    };
    const next = () => { clearTimeout(autoTimer); onContinue = null; onCountWrong = null; pos++; ask(); };
    const retry = (cid) => {
      if (retried.has(cid)) return;
      retried.add(cid);
      queue.push({ id: cid, type: questionType(levelOf(set().prog, cid), prefs.types) });
    };

    if (item.type === 'choice') {
      const options = choicesFor(set(), c, prefs.dir);
      const buttons = options.map((opt, k) => h('button', {
        class: 'choice', type: 'button', onclick: () => pick(k),
      }, h('span', { class: 'key' }, String(k + 1)), h('span', { class: 'choice-text' }, opt)));
      answerBox = h('div', { class: 'choices' }, buttons);
      const pick = (k) => {
        if (answered) return;
        answered = true;
        const ok = options[k] === expected;
        buttons.forEach((b, j) => {
          b.disabled = true;
          if (options[j] === expected) b.classList.add('right');
          else if (j === k) b.classList.add('wrong');
          else b.classList.add('dim');
        });
        record(c.id, 'choice', ok);
        ok ? roundDone.ok++ : (roundDone.ko++, retry(c.id));
        feedback.replaceChildren(h('p', { class: 'verdict ' + (ok ? 'ok' : 'ko') }, ok ? 'Juste.' : ['Pas cette fois. Réponse : ', h('strong', {}, expected)]));
        showContinue([], ok ? AUTO : 0);
      };
      keyHandler = (e) => { const n = Number(e.key); if (!answered && n >= 1 && n <= options.length) { e.preventDefault(); pick(n - 1); } };
    } else {
      const input = h('input', { class: 'answer', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Ta réponse', placeholder: 'Ta réponse' });
      const submit = (giveUp = false) => {
        if (answered) return;
        if (!giveUp && !input.value.trim()) { input.focus(); return; }
        answered = true;
        input.disabled = true;
        actions.hidden = true;
        const g = giveUp ? { result: 'wrong' } : grade(input.value, expected, prefs.check);
        const ok = g.result !== 'wrong';
        const perfect = g.result === 'exact' && g.complete && g.spelled;
        const got = record(c.id, 'written', ok);
        ok ? roundDone.ok++ : (roundDone.ko++, retry(c.id));
        input.classList.add(ok ? 'right' : 'wrong');
        const verdict = (cls, ...text) => feedback.replaceChildren(h('p', { class: 'verdict ' + cls }, ...text));
        if (perfect) verdict('ok', 'Juste.');
        else if (g.result === 'exact' && !g.complete) verdict('ok', 'Juste, mais incomplet. Réponse complète : ', h('strong', {}, expected));
        else if (g.result === 'exact') verdict('ok', 'Juste, à l’orthographe près. Orthographe exacte : ', h('strong', {}, expected));
        else if (g.result === 'almost') verdict('ok', 'Juste, à un détail près. Réponse attendue : ', h('strong', {}, expected));
        else verdict('ko', giveUp ? 'Réponse : ' : 'Pas tout à fait. Réponse : ', h('strong', {}, expected));
        // Acceptée avec une remarque : on peut la compter fausse (bouton ou touche F). On n'avance pas
        // tout seul, le temps de décider.
        const countWrong = () => {
          if (!onCountWrong) return;
          onCountWrong = null;
          record(c.id, 'written', false, { prog: snapshot, streakTo: 0 });
          // Les succès que cette réponse avait débloqués (série, mi-chemin, liste maîtrisée) sont repris.
          const undo = got.filter((a) => a.startsWith('serie-') || a === 'mi-chemin' || a === 'maitrise');
          if (undo.length) store.updateSet(id, (s) => { undo.forEach((a) => { if (s.ach) delete s.ach[a]; sessionGot.delete(a); }); });
          roundDone.ok--; roundDone.ko++;
          retry(c.id);
          input.classList.replace('right', 'wrong');
          verdict('ko', 'Compté faux. Réponse : ', h('strong', {}, expected));
          showContinue();
        };
        if (ok && !perfect) onCountWrong = countWrong;
        const strictBtn = ok && !perfect
          ? h('button', { class: 'btn', type: 'button', onclick: countWrong }, 'Compter faux', h('span', { class: 'key' }, 'F'))
          : null;
        const override = !ok && !giveUp ? h('button', {
          class: 'btn', type: 'button',
          onclick: () => {
            // « J'avais juste » : on annule l'erreur (progression et série) et on compte la réponse comme bonne.
            record(c.id, 'written', true, { prog: snapshot, streakTo: streakBefore + 1 });
            roundDone.ko--; roundDone.ok++;
            queue = queue.filter((it, j) => j <= pos || it.id !== c.id);
            next();
          },
        }, 'J’avais juste') : null;
        showContinue([override, strictBtn].filter(Boolean), perfect ? AUTO : 0);
      };
      const actions = h('div', { class: 'row end' },
        h('button', { class: 'linklike', type: 'button', onclick: () => submit(true) }, 'Je ne sais pas'),
        h('button', { class: 'btn primary', type: 'submit' }, 'Valider', h('span', { class: 'key' }, 'Entrée')));
      answerBox = h('form', { class: 'written', onsubmit: (e) => { e.preventDefault(); submit(); } }, input, actions);
      keyHandler = null;
      setTimeout(() => input.focus({ preventScroll: true }), 0);
    }

    stage.replaceChildren(h('section', { class: 'question' }, qhead, q, answerBox, feedback));
    hint.textContent = item.type === 'choice' ? '1 – 4 : choisir · Entrée : continuer' : 'Entrée : valider, puis continuer';
  }

  // Grand anneau des écrans de fin (manche, palier, liste).
  const bigRing = (v, v2, text, fx) => ring({ size: 184, stroke: 9, cls: 'big-ring' })
    .label(h('span', { class: 'ring-big-label' }, text)).show(v, v2, fx);

  function roundEnd() {
    hint.textContent = '';
    const s = pool();
    // Le palier de cette manche est franchi : écran d'étape.
    if (roundPalier !== -1 && currentPalier(s) !== roundPalier) return checkpoint(roundPalier);
    const ids = paliers(s)[roundPalier];
    const st = palierStats(s, ids);
    const many = paliers(s).length > 1;
    stage.replaceChildren(h('section', { class: 'done' },
      h('p', { class: 'label' }, 'Manche terminée'),
      bigRing(st.mastered / st.total, (st.mastered + st.learning) / st.total, `${st.mastered}/${st.total}`),
      h('p', { class: 'lede' },
        `${many ? `Palier ${roundPalier + 1} : ` : ''}${plural(st.mastered, 'carte maîtrisée', 'cartes maîtrisées')} sur ${st.total}. `,
        `Cette manche : ${roundDone.ok} juste${s_(roundDone.ok)}, ${roundDone.ko} à reprendre.`),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: newRound }, 'Manche suivante', h('span', { class: 'key' }, 'Entrée')))));
    onContinue = newRound;
  }

  function checkpoint(k) {
    const got = [];
    store.updateSet(id, (s) => { got.push(...award(s, palierAwards(s, paliers(poolOf(s))[k] || []))); });
    const s = pool();
    const sc = scopeOf();
    const ps = paliers(s);
    const st = stats(s);
    const last = currentPalier(s) === -1;
    const n = ps[k]?.length ?? 0;
    paintHead();
    // Le succès « Liste maîtrisée » vient de s'afficher à la dernière réponse : pas de doublon.
    const step = last && sc !== 'all'
      ? { kicker: `Cartes ${SCOPE_NAME[sc]}`, title: 'Toutes maîtrisées', desc: plural(st.total, 'carte maîtrisée', 'cartes maîtrisées') }
      : last
      ? (sessionGot.has('maitrise') ? null : { kicker: 'Liste maîtrisée', title: 'Toutes les cartes sont maîtrisées', desc: plural(n, 'carte maîtrisée', 'cartes maîtrisées') + ' dans ce dernier palier' })
      : { kicker: `Palier ${k + 1} sur ${ps.length}`, title: 'Palier franchi', desc: plural(n, 'carte maîtrisée', 'cartes maîtrisées') };
    celebrate([step, ...got.map(describe)]);
    const nextIds = last ? [] : ps[currentPalier(s)];
    stage.replaceChildren(h('section', { class: 'done checkpoint' },
      h('p', { class: 'label' }, last ? (sc === 'all' ? 'Liste maîtrisée' : `Cartes ${SCOPE_NAME[sc]}`) : `Palier ${k + 1} sur ${ps.length}`),
      bigRing(1, 1, checkIcon(), true),
      h('h2', { class: 'mode-title' }, last ? 'Tout est maîtrisé.' : 'Palier franchi.'),
      h('p', { class: 'lede' }, last
        ? (sc === 'all' ? `Les ${st.total} cartes de la liste sont maîtrisées.` : `Les ${plural(st.total, `carte ${SCOPE_NAME[sc].replace(/s$/, '')} est maîtrisée`, `cartes ${SCOPE_NAME[sc]} sont maîtrisées`)}.`)
        : `Tu maîtrises ${st.mastered} cartes sur ${st.total}. Prochain palier : ${plural(nextIds.length, 'carte', 'cartes')}. C’est un bon moment pour une pause.`),
      ps.length > 1 ? palierTrack().update(s) : null,
      last
        ? h('div', { class: 'row' },
          h('a', { class: 'btn primary', href: `#/l/${id}` }, 'Voir mes succès'),
          h('a', { class: 'btn', href: `#/l/${id}/cartes` }, 'Revoir en mode Cartes'))
        : h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', onclick: newRound }, 'Palier suivant', h('span', { class: 'key' }, 'Entrée')),
          h('a', { class: 'btn', href: `#/l/${id}` }, 'Faire une pause'))));
    onContinue = last ? null : newRound;
  }

  function allDone() {
    hint.textContent = '';
    const sc = scopeOf();
    const ids = pool().cards.map((c) => c.id);
    const total = ids.length;
    // « Les retravailler » : ces cartes repartent du début, sans effacer le compte de leurs erreurs.
    const rework = () => {
      store.updateSet(id, (s) => { for (const cid of ids) if (s.prog?.[cid]) s.prog[cid] = { ...s.prog[cid], lv: 0 }; });
      newRound();
    };
    stage.replaceChildren(h('section', { class: 'done' },
      h('p', { class: 'label' }, sc === 'all' ? 'Liste maîtrisée' : `Cartes ${SCOPE_NAME[sc]}`),
      bigRing(1, 1, `${total}/${total}`),
      h('p', { class: 'lede' }, sc === 'all' ? 'Toute la liste est maîtrisée.'
        : `Tes ${plural(total, `carte ${SCOPE_NAME[sc].replace(/s$/, '')}`, `cartes ${SCOPE_NAME[sc]}`)} ${total > 1 ? 'sont toutes maîtrisées' : 'est maîtrisée'}. Tu peux les retravailler pour t’en assurer.`),
      h('div', { class: 'row' },
        sc === 'all'
          ? h('button', {
            class: 'btn primary', type: 'button',
            onclick: () => { store.updateSet(id, (s) => { s.prog = {}; }); headShown = false; newRound(); },
          }, 'Recommencer à zéro')
          : h('button', { class: 'btn primary', type: 'button', onclick: rework }, total > 1 ? 'Les retravailler' : 'La retravailler'),
        h('a', { class: 'btn', href: `#/l/${id}/cartes${sc !== 'all' ? `?only=${sc}` : ''}` }, 'Revoir en mode Cartes'))));
    onContinue = null;
  }

  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (keyHandler && !e.target.closest('input, textarea')) keyHandler(e);
    if (onCountWrong && (e.key === 'f' || e.key === 'F') && !e.target.closest('input, textarea')) { e.preventDefault(); onCountWrong(); return; }
    if ((e.key === 'e' || e.key === 'E') && !e.target.closest('input, textarea')) { const b = stage.querySelector('.q-star'); if (b) { e.preventDefault(); b.click(); return; } }
    if (onContinue && e.key === 'Enter' && !e.target.closest('button, a')) { e.preventDefault(); onContinue(); }
  }, { signal: ctx.signal });

  ctx.root.append(
    h('p', { class: 'crumb label' }, h('a', { href: `#/l/${id}` }, set0.title)),
    h('div', { class: 'study-head' },
      h('h1', { class: 'mode-title' }, 'Apprendre')),
    settings, head, stage, hint);
  newRound();
}
