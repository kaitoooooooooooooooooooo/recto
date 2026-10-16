// Petits outils d'interface : création d'éléments (le texte reste du texte, jamais du HTML),
// messages, dialogue.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    // Style passé par le CSSOM : la politique de sécurité interdit les attributs style="…".
    else if (k === 'style') el.style.cssText = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer = 0;
export function toast(msg, ms = 2600) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), ms);
}

export function confirmDialog(message, { ok = 'Confirmer', danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog' },
      h('p', {}, message),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', type: 'button', onclick: () => dlg.close('no') }, 'Annuler'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', onclick: () => dlg.close('yes') }, ok)));
    dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'yes'); dlg.remove(); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function plural(n, one, many) { return `${n} ${n > 1 ? many : one}`; }

export const fmtDate = (ms) => new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'short' }).format(ms);

// --- Anneau de progression ------------------------------------------------------------
// Deux arcs : `v` plein (maîtrisé), `v2` pâle (en cours). L'anneau s'anime vers sa valeur ;
// il « saute » quand il avance et lance une onde quand il se remplit.
const SVG = 'http://www.w3.org/2000/svg';
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

export function ring({ size = 56, stroke = 4, cls = '' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const circle = (k) => {
    const e = document.createElementNS(SVG, 'circle');
    // Le rail est fin : les deux arcs, plus épais, s'en détachent même en gris pâle.
    const w = k === 'rail' ? Math.max(1, stroke * 0.4) : stroke;
    for (const [a, v] of Object.entries({ class: k, cx: size / 2, cy: size / 2, r, 'stroke-width': w })) e.setAttribute(a, v);
    if (k !== 'rail') { e.style.strokeDasharray = String(c); e.style.strokeDashoffset = String(c); }
    return e;
  };
  const soft = circle('soft'), main = circle('main');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.append(circle('rail'), soft, main);
  const center = h('span', { class: 'ring-label' });
  const el = h('div', { class: `ring ${cls}`.trim(), role: 'img' }, svg, center);
  el.style.width = el.style.height = `${size}px`;
  let last = 0, gen = 0;
  const replay = (name) => { el.classList.remove(name); void el.offsetWidth; el.classList.add(name); };
  const apply = (v, v2, fx) => {
    v = clamp01(v); v2 = Math.max(v, clamp01(v2));
    main.style.strokeDashoffset = String(c * (1 - v));
    soft.style.strokeDashoffset = String(c * (1 - v2));
    if (fx && v >= 1 && last < 1) replay('pop');
    else if (fx && v > last + 1e-9) replay('bump');
    last = v;
    return el;
  };
  el.set = (v, v2 = v, fx = true) => { gen++; return apply(v, v2, fx); };
  // Part de zéro et s'anime une fois à l'écran. Si une valeur plus récente arrive entre-temps
  // (onglet en arrière-plan : les images ne s'y calculent pas), l'animation de départ s'efface.
  el.show = (v, v2 = v, fx = false) => {
    const g = ++gen;
    requestAnimationFrame(() => requestAnimationFrame(() => { if (g === gen) apply(v, v2, fx); }));
    return el;
  };
  el.label = (...kids) => { center.replaceChildren(...kids.flat().filter((k) => k != null && k !== false)); return el; };
  el.describe = (text) => { el.setAttribute('aria-label', text); return el; };
  return el;
}

export function checkIcon() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'check');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', 'M5.5 12.5l4.2 4.2 8.8-9.4');
  p.setAttribute('pathLength', '1');
  svg.append(p);
  return svg;
}

// --- Succès débloqués : une vignette à la fois, en haut de l'écran ------------------------
const shelf = [];
let busy = false;
export function celebrate(list) {
  for (const a of list) if (a) shelf.push(a);
  if (!busy) nextCelebration();
}
function nextCelebration() {
  const a = shelf.shift();
  if (!a) { busy = false; return; }
  busy = true;
  const badge = ring({ size: 46, stroke: 3, cls: 'achv-ring' }).label(checkIcon());
  const el = h('div', { class: 'achv', role: 'status' }, badge,
    h('div', { class: 'achv-text' },
      h('p', { class: 'label' }, a.kicker || 'Succès débloqué'),
      h('p', { class: 'achv-title' }, a.title),
      a.desc ? h('p', { class: 'achv-desc' }, a.desc) : null));
  document.body.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('in'); badge.set(1, 1); }));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.remove('in');
    setTimeout(() => { el.remove(); nextCelebration(); }, 280);
  };
  el.addEventListener('click', close);
  setTimeout(close, 3400);
}

export function starIcon() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'star-icon');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', 'M12 2.8l2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 16.83 6.5 19.72l1.05-6.12L3.1 9.27l6.15-.9z');
  svg.append(p);
  return svg;
}
