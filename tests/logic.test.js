// Recto : lecture des listes collées, correction des réponses écrites, niveaux du mode Apprendre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseList } from '../site/js/parse.js';
import { grade, normalize } from '../site/js/check.js';
import { makeRound, applyAnswer, choicesFor, stats, questionType, NEW, LEARNING, MASTERED } from '../site/js/learn.js';

test('import : tabulation (export Quizlet, Excel)', () => {
  const r = parseList('dog\tchien\ncat\tchat\n\nbird\toiseau');
  assert.equal(r.between, 'tab');
  assert.deepEqual(r.cards, [{ t: 'dog', d: 'chien' }, { t: 'cat', d: 'chat' }, { t: 'bird', d: 'oiseau' }]);
});

test('import : « - », « : », « = » et virgule sont devinés', () => {
  assert.equal(parseList('a - b\nc - d').between, 'dash');
  assert.equal(parseList('a : b\nc : d').between, 'colon');
  assert.equal(parseList('a = b\nc = d').between, 'equals');
  assert.equal(parseList('a, b\nc, d').between, 'comma');
});

test('import : coupe au premier séparateur, la définition garde les suivants', () => {
  const r = parseList('throughout\tà travers, tout au long de\nheure : 12:30', { between: 'tab' });
  assert.deepEqual(r.cards[0], { t: 'throughout', d: 'à travers, tout au long de' });
  assert.equal(r.skipped, 1);
  assert.deepEqual(parseList('heure : 12:30').cards[0], { t: 'heure', d: '12:30' });
});

test('import : cartes séparées par « ; » sur une seule ligne', () => {
  const r = parseList('un - one; deux - two; trois - three');
  assert.equal(r.cards.length, 3);
  assert.deepEqual(r.cards[2], { t: 'trois', d: 'three' });
});

test('import : séparateurs personnalisés et lignes sans séparateur', () => {
  const r = parseList('a|b#c|d#e', { between: 'custom', customBetween: '|', rows: 'custom', customRows: '#' });
  assert.deepEqual(r.cards, [{ t: 'a', d: 'b' }, { t: 'c', d: 'd' }]);
  assert.equal(r.skipped, 1);
  assert.equal(parseList('\r\n  \n').cards.length, 0);
});

test('correction : majuscules, accents, ponctuation', () => {
  assert.equal(normalize('  Élève, ÇA va ?! '), 'eleve ca va');
  assert.equal(grade('eleve', 'Élève').result, 'exact');
  assert.equal(grade("l'ecole", 'L’école').result, 'exact');
});

test('correction : petites fautes acceptées, pas sur les mots courts', () => {
  assert.equal(grade('abandoner', 'abandonner').result, 'almost');
  assert.equal(grade('atendre avec impatiance', 'attendre avec impatience').result, 'almost');
  assert.equal(grade('bern', 'Berne').result, 'almost');
  assert.equal(grade('ber', 'Berne').result, 'wrong');
  assert.equal(grade('cat', 'car').result, 'wrong');
  assert.equal(grade('', 'x').result, 'wrong');
});

test('correction : article, parenthèses, « / » et synonymes à virgules', () => {
  assert.equal(grade('chien', 'le chien').result, 'almost');
  assert.deepEqual([grade('le temps', 'le temps (météo)').result, grade('le temps', 'le temps (météo)').complete], ['exact', true]);
  assert.equal(grade('belle', 'beau / belle').result, 'exact');
  const g = grade('solitaire', 'seul, solitaire');
  assert.deepEqual([g.result, g.complete], ['exact', false]);
  assert.equal(grade('seul, solitaire', 'seul, solitaire').complete, true);
});

const deck = (n) => ({ cards: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, t: `t${i}`, d: `d${i}` })), prog: {} });

test('apprendre : nouvelle → choix juste → en cours → écrit juste → maîtrisée', () => {
  let prog = {};
  prog = applyAnswer(prog, 'c0', { correct: true, type: 'choice', now: 1 });
  assert.equal(prog.c0.lv, LEARNING);
  prog = applyAnswer(prog, 'c0', { correct: false, type: 'written', now: 2 });
  assert.equal(prog.c0.lv, NEW);
  prog = applyAnswer(prog, 'c0', { correct: true, type: 'choice', now: 3 });
  prog = applyAnswer(prog, 'c0', { correct: true, type: 'written', now: 4 });
  assert.deepEqual({ ...prog.c0 }, { lv: MASTERED, ok: 3, ko: 1, at: 4 });
});

test('apprendre : sans écrit, deux bons choix ; sans choix, écrit dès le début', () => {
  let prog = applyAnswer({}, 'c0', { correct: true, type: 'choice', types: 'choice' });
  assert.equal(prog.c0.lv, LEARNING);
  prog = applyAnswer(prog, 'c0', { correct: true, type: 'choice', types: 'choice' });
  assert.equal(prog.c0.lv, MASTERED);
  assert.equal(questionType(NEW, 'written'), 'written');
  assert.equal(questionType(NEW, 'both'), 'choice');
  assert.equal(questionType(LEARNING, 'both'), 'written');
});

test('apprendre : manche de 7, cartes en cours d’abord, maîtrisées exclues', () => {
  const set = deck(12);
  set.prog = { c3: { lv: LEARNING, at: 5 }, c7: { lv: LEARNING, at: 1 }, c0: { lv: MASTERED, at: 1 } };
  const round = makeRound(set, { rng: () => 0.5 });
  assert.equal(round.length, 7);
  assert.deepEqual(round.slice(0, 2), [{ id: 'c7', type: 'written' }, { id: 'c3', type: 'written' }]);
  assert.ok(round.every((q) => q.id !== 'c0'));
  assert.ok(round.slice(2).every((q) => q.type === 'choice'));
  assert.deepEqual(stats(set), { total: 12, fresh: 9, learning: 2, mastered: 1 });
});

test('apprendre : quatre propositions distinctes dont la bonne', () => {
  const set = deck(6);
  set.cards.push({ id: 'dup', t: 'x', d: 'D1' }); // même réponse que c1, à la casse près
  for (let k = 0; k < 20; k++) {
    const opts = choicesFor(set, set.cards[1], 'term');
    assert.equal(opts.length, 4);
    assert.ok(opts.includes('d1'));
    assert.equal(new Set(opts.map(normalize)).size, 4);
  }
  assert.equal(choicesFor(deck(2), deck(2).cards[0], 'def').length, 2);
});

import { paliers, currentPalier, palierStats } from '../site/js/learn.js';
import { award, noteDay, dayAwards, streakAwards, masteryAwards, palierAwards, today, ACHIEVEMENTS } from '../site/js/achievements.js';

test('paliers : groupes égaux d’environ 7 cartes, dans l’ordre de la liste', () => {
  const sizes = (n) => paliers(deck(n)).map((p) => p.length);
  assert.deepEqual(sizes(18), [6, 6, 6]);
  assert.deepEqual(sizes(10), [5, 5]);
  assert.deepEqual(sizes(7), [7]);
  assert.deepEqual(sizes(15), [5, 5, 5]);
  assert.deepEqual(sizes(2), [2]);
  assert.deepEqual(paliers(deck(10))[1], ['c5', 'c6', 'c7', 'c8', 'c9']);
});

test('paliers : on travaille le premier palier pas encore maîtrisé', () => {
  const set = deck(10);
  assert.equal(currentPalier(set), 0);
  for (let i = 0; i < 5; i++) set.prog[`c${i}`] = { lv: MASTERED };
  assert.equal(currentPalier(set), 1);
  assert.deepEqual(palierStats(set, paliers(set)[0]), { total: 5, fresh: 0, learning: 0, mastered: 5 });
  const round = makeRound(set, { ids: paliers(set)[1] });
  assert.equal(round.length, 5);
  assert.ok(round.every((q) => ['c5', 'c6', 'c7', 'c8', 'c9'].includes(q.id)));
  for (let i = 5; i < 10; i++) set.prog[`c${i}`] = { lv: MASTERED };
  assert.equal(currentPalier(set), -1);
});

test('succès : débloqués une seule fois, rangés dans la liste', () => {
  const set = deck(8);
  assert.deepEqual(award(set, ['serie-5', false, 'inconnu'], 42), ['serie-5']);
  assert.deepEqual(award(set, ['serie-5', 'serie-10'], 43), ['serie-10']);
  assert.deepEqual(set.ach, { 'serie-5': 42, 'serie-10': 43 });
  assert.deepEqual(streakAwards(12).filter(Boolean), ['serie-5', 'serie-10']);
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
});

test('succès : moitié, liste maîtrisée, palier sans faute', () => {
  const set = deck(8);
  for (let i = 0; i < 4; i++) set.prog[`c${i}`] = { lv: MASTERED, ko: 0 };
  assert.deepEqual(masteryAwards(set).filter(Boolean), ['mi-chemin']);
  const [p1] = paliers(set);
  assert.deepEqual(palierAwards(set, p1).filter(Boolean), ['palier', 'sans-faute']);
  set.prog.c1.ko = 1;
  assert.deepEqual(palierAwards(set, p1).filter(Boolean), ['palier']);
  assert.deepEqual(palierAwards(set, paliers(set)[1]), []);
  for (let i = 4; i < 8; i++) set.prog[`c${i}`] = { lv: MASTERED };
  assert.ok(masteryAwards(set).includes('maitrise'));
});

test('succès : jours de révision distincts', () => {
  const set = deck(3);
  noteDay(set, '2026-10-14');
  noteDay(set, '2026-10-14');
  assert.deepEqual(dayAwards(set).filter(Boolean), []);
  noteDay(set, '2026-10-16');
  assert.deepEqual(dayAwards(set).filter(Boolean), ['retour']);
  ['2026-10-17', '2026-10-18', '2026-10-20'].forEach((d) => noteDay(set, d));
  assert.deepEqual(dayAwards(set).filter(Boolean), ['retour', 'regularite']);
  assert.equal(today(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
});

test('correction stricte : orthographe exacte, parenthèses facultatives', () => {
  const S = (a, e) => grade(a, e, 'strict').result;
  assert.equal(S('give a board smile', 'give a broad smile'), 'wrong');
  assert.equal(S('Give a broad smile!', 'give a broad smile'), 'exact');
  assert.equal(S('eleve', 'élève'), 'wrong');
  assert.equal(S('chien', 'le chien'), 'wrong');
  assert.equal(S('seul', 'seul, solitaire'), 'wrong');
  assert.equal(S('seul solitaire', 'seul, solitaire'), 'exact');
  assert.equal(S('pays bas', 'Pays-Bas'), 'wrong');
  assert.equal(S("s'occuper de", 's’occuper de'), 'exact');
  assert.equal(S('belle', 'beau / belle'), 'exact');
  for (const a of ['le temps', 'le temps météo', 'le temps (météo)']) assert.equal(S(a, 'le temps (météo)'), 'exact', a);
});

test('correction normale : ni faute de frappe ni article oublié, accents ignorés', () => {
  const N = (a, e) => grade(a, e, 'normal');
  assert.equal(N('give a board smile', 'give a broad smile').result, 'wrong');
  assert.equal(N('chien', 'le chien').result, 'wrong');
  assert.deepEqual([N('eleve', 'élève').result, N('eleve', 'élève').spelled], ['exact', false]);
  assert.deepEqual([N('seul', 'seul, solitaire').result, N('seul', 'seul, solitaire').complete], ['exact', false]);
  assert.equal(N('le temps', 'le temps (météo)').result, 'exact');
});

test('correction souple : la faute de frappe est acceptée avec remarque', () => {
  const g = grade('give a board smile', 'give a broad smile', 'souple');
  assert.equal(g.result, 'almost');
  assert.equal(grade('give a broad smile', 'give a broad smile').spelled, true);
});

import { learnOrder } from '../site/js/learn.js';

test('mélange : ordre stable, propre à la liste, paliers recomposés', () => {
  const set = deck(18);
  assert.deepEqual(learnOrder(set), set.cards.map((c) => c.id));
  set.mix = 12345;
  const a = learnOrder(set);
  assert.deepEqual(learnOrder(set), a, 'même graine, même ordre');
  assert.notDeepEqual(a, set.cards.map((c) => c.id));
  assert.deepEqual([...a].sort(), set.cards.map((c) => c.id).sort());
  assert.deepEqual(paliers(set).flat(), a);
  assert.notDeepEqual(learnOrder({ ...set, mix: 999 }), a, 'autre graine, autre ordre');
  // Une carte ajoutée prend sa place sans déranger les autres.
  set.cards.push({ id: 'nouvelle', t: 'x', d: 'y' });
  assert.deepEqual(learnOrder(set).filter((id) => id !== 'nouvelle'), a);
});

test('mélange : les questions d’une manche arrivent dans le désordre', () => {
  const set = deck(7);
  const plain = makeRound(set, { rng: () => 0.5 }).map((q) => q.id);
  set.mix = 7;
  const orders = new Set();
  for (let k = 0; k < 30; k++) {
    const r = makeRound(set).map((q) => q.id);
    assert.deepEqual([...r].sort(), [...plain].sort());
    orders.add(r.join());
  }
  assert.ok(orders.size > 5);
});

import { isFav, toggleFav, favCards, difficulty, hardCards } from '../site/js/marks.js';

test('favoris : on ajoute, on retire, rangés dans la liste', () => {
  const set = deck(4);
  assert.equal(toggleFav(set, 'c2'), true);
  assert.equal(toggleFav(set, 'c0'), true);
  assert.ok(isFav(set, 'c2'));
  assert.deepEqual(favCards(set).map((c) => c.id), ['c0', 'c2']);
  assert.equal(toggleFav(set, 'c2'), false);
  assert.deepEqual(set.fav, ['c0']);
  toggleFav(set, 'c0');
  assert.equal(set.fav, undefined);
});

test('difficulté : orange dès 2 erreurs, rouge à 50 % d’erreurs ou plus', () => {
  const set = deck(5);
  set.prog = { c0: { ok: 5, ko: 1 }, c1: { ok: 4, ko: 2 }, c2: { ok: 2, ko: 2 }, c3: { ok: 1, ko: 3 }, c4: { ok: 0, ko: 0 } };
  assert.equal(difficulty(set, 'c0'), null);
  assert.equal(difficulty(set, 'c1').level, 'orange');
  assert.equal(difficulty(set, 'c2').level, 'red');
  assert.equal(difficulty(set, 'c3').level, 'red');
  assert.equal(difficulty(set, 'c4'), null);
  assert.deepEqual(hardCards(set).map((c) => c.id), ['c1', 'c2', 'c3']);
  // En réussissant la carte, on fait baisser le taux : rouge → orange.
  set.prog.c2.ok = 3;
  assert.equal(difficulty(set, 'c2').level, 'orange');
});
