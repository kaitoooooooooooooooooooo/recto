// Correction des réponses écrites, selon trois niveaux (réglage du mode Apprendre) :
//   souple : majuscules, accents, ponctuation, article en tête (« le », « the »…) et une petite
//            faute de frappe sont pardonnés ; un seul des synonymes à virgules suffit ;
//   normal : majuscules, accents et ponctuation ignorés, mais aucune faute ni article oublié ;
//   strict : orthographe exacte, accents, tirets et article compris, réponse complète ; seules les
//            majuscules, les espaces et la ponctuation ne comptent pas.
// Dans tous les cas, ce qui est entre parenthèses est facultatif, et « / » ou « ; » séparent
// plusieurs réponses possibles.

export const CHECK_MODES = ['souple', 'normal', 'strict'];

// Forme indulgente : sans accents, sans ponctuation, en minuscules.
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[’‘'`´]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Forme stricte : accents, apostrophes et tirets gardés ; majuscules, espaces et ponctuation ignorés.
export function strictForm(s) {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’‘'`´]/g, "'")
    .replace(/[^\p{L}\p{M}\p{N}'\- ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ARTICLES = /^(le |la |les |l'|un |une |des |du |de la |de l'|d'|the |a |an |der |die |das |el |los |las )/;
const stripArticle = (s) => s.replace(ARTICLES, '').trim();
const noParens = (x) => String(x ?? '').replace(/\([^)]*\)/g, ' ');  // « le temps (météo) » → « le temps »
const unParen = (x) => String(x ?? '').replace(/[()]/g, ' ');         // « le temps (météo) » → « le temps météo »

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Fautes de frappe admises (mode souple) : aucune sous 4 lettres, une jusqu'à 8, deux au-delà.
export const typoBudget = (len) => (len < 4 ? 0 : len <= 8 ? 1 : 2);

export function alternatives(expected) {
  const all = String(expected ?? '').split(/\s*[\/;]\s*/).map((x) => x.trim()).filter(Boolean);
  return all.length ? all : [String(expected ?? '')];
}

// Réponses acceptées, mises sous la forme `form`. `full` : la réponse entière (avec ou sans ce qui
// est entre parenthèses) ; sinon une partie d'une énumération à virgules (« seul, solitaire »).
function candidates(expected, form, withParts) {
  const out = [];
  const add = (raw, full) => { const n = form(raw); if (n) out.push({ n, full, raw }); };
  for (const alt of [String(expected ?? ''), ...alternatives(expected)]) {
    add(noParens(alt), true);
    add(unParen(alt), true);
    const parts = noParens(alt).split(',').map((x) => x.trim()).filter(Boolean);
    if (withParts && parts.length > 1) parts.forEach((x) => add(x, false));
  }
  return out;
}

// Résultat : « exact » (juste), « almost » (accepté malgré une faute, mode souple) ou « wrong ».
//   complete : faux quand un seul synonyme a été donné ;
//   spelled  : faux quand la réponse est acceptée mais écrite autrement (accents, tiret…).
export function grade(answer, expected, mode = 'souple') {
  const strict = mode === 'strict';
  const form = strict ? strictForm : normalize;
  const tries = [...new Set([form(answer), form(noParens(answer))])].filter(Boolean);
  const wrong = { result: 'wrong', expected, complete: false, spelled: false };
  if (!tries.length) return wrong;
  const cands = candidates(expected, form, !strict);

  let hit = null;
  for (const c of cands) {
    if (!tries.includes(c.n)) continue;
    if (c.full) { hit = c; break; }
    hit ||= c;
  }
  if (hit) {
    const spelled = [strictForm(answer), strictForm(noParens(answer))].includes(strictForm(hit.raw));
    return { result: 'exact', expected, complete: hit.full, spelled };
  }
  if (mode !== 'souple') return wrong;

  for (const a of tries) {
    const a2 = stripArticle(a);
    if (!a2) continue;
    for (const c of cands) {
      const e2 = stripArticle(c.n);
      if (a2 === e2 || levenshtein(a2, e2) <= typoBudget(e2.length)) return { result: 'almost', expected, complete: c.full, spelled: false };
    }
  }
  return wrong;
}
