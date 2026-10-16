// Lecture d'une liste collée : un terme et sa définition par carte.
// Séparateurs reconnus automatiquement : tabulation (export Quizlet, Excel, Google Sheets),
// « - », « : », « = », virgule ; cartes séparées par des retours à la ligne ou des « ; ».

export const BETWEEN = {
  auto: null,
  tab: '\t',
  dash: ' - ',
  colon: ':',
  equals: '=',
  comma: ',',
};
export const ROWS = {
  auto: null,
  newline: '\n',
  semicolon: ';',
};

const ORDER = ['tab', 'dash', 'colon', 'equals', 'comma'];

function splitRows(text, rows, customRows) {
  if (rows === 'custom' && customRows) return text.split(customRows);
  if (rows === 'semicolon') return text.split(';');
  if (rows === 'newline') return text.split(/\r?\n/);
  // Auto : une seule ligne avec des « ; » = cartes séparées par des « ; ».
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length <= 1 && text.includes(';')) return text.split(';');
  return text.split(/\r?\n/);
}

function detectBetween(rows) {
  const filled = rows.map((r) => r.trim()).filter(Boolean);
  if (!filled.length) return 'tab';
  for (const key of ORDER) {
    const sep = BETWEEN[key];
    const hits = filled.filter((r) => r.includes(sep)).length;
    if (hits / filled.length >= 0.6) return key;
  }
  return 'tab';
}

function cut(row, sep) {
  // Coupe au premier séparateur : une définition peut contenir le même caractère.
  const i = row.indexOf(sep);
  return i < 0 ? null : [row.slice(0, i), row.slice(i + sep.length)];
}

export function parseList(text, { between = 'auto', rows = 'auto', customBetween = '', customRows = '' } = {}) {
  const parts = splitRows(String(text || ''), rows, customRows);
  const betweenKey = between === 'auto' ? detectBetween(parts) : between;
  const sep = betweenKey === 'custom' ? customBetween : BETWEEN[betweenKey];
  const cards = [];
  let skipped = 0;
  for (const raw of parts) {
    const row = raw.trim();
    if (!row) continue;
    const pair = sep ? cut(row, sep) : null;
    const t = pair?.[0].trim() ?? '';
    const d = pair?.[1].trim() ?? '';
    if (!t || !d) { skipped++; continue; }
    cards.push({ t, d });
  }
  return { cards, between: betweenKey, skipped };
}
