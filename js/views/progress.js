import { h, md, spinner, withLoading, toast, fmtDate , mount} from '../ui.js';
import { state, save, today } from '../store.js';
import { gemini, textPart } from '../api.js';
import { SYSTEM, REVIEW_PROMPT } from '../prompts.js';
import { generateBoth } from '../generate.js';

export function weightChart(points) {
  if (points.length < 2) return h('p', { class: 'muted' }, 'Χρειάζονται τουλάχιστον 2 μετρήσεις για γράφημα.');
  const W = 600, H = 200, P = 28;
  const ys = points.map(p => p.kg), min = Math.min(...ys) - 1, max = Math.max(...ys) + 1;
  const x = i => P + (i * (W - 2 * P)) / (points.length - 1);
  const y = v => H - P - ((v - min) / (max - min)) * (H - 2 * P);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'chart'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Γράφημα βάρους');
  const add = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text) e.textContent = text; svg.append(e); };
  add('polyline', { points: points.map((p, i) => `${x(i)},${y(p.kg)}`).join(' '), fill: 'none', stroke: '#16a34a', 'stroke-width': 3, 'stroke-linejoin': 'round' });
  points.forEach((p, i) => {
    add('circle', { cx: x(i), cy: y(p.kg), r: 4, fill: '#16a34a' });
    if (i === 0 || i === points.length - 1 || points.length < 8) add('text', { x: x(i), y: y(p.kg) - 9, 'text-anchor': 'middle', 'font-size': 12, fill: 'currentColor' }, p.kg);
  });
  add('text', { x: P, y: H - 6, 'font-size': 11, fill: '#64748b' }, fmtDate(points[0].date));
  add('text', { x: W - P, y: H - 6, 'font-size': 11, fill: '#64748b', 'text-anchor': 'end' }, fmtDate(points.at(-1).date));
  return svg;
}

export function progressView(root) {
  const L = state.logs;
  const ci = { weight: '', mood: 3, energy: 3, sleep: 3, pain: '', adherence: 3, notes: '' };
  const slider = (k, label) => { const o = h('strong', {}, '3'); return h('div', { class: 'field' }, h('label', {}, label), h('div', { class: 'row' }, h('input', { type: 'range', min: 1, max: 5, value: 3, oninput: e => { ci[k] = +e.target.value; o.textContent = e.target.value; } }), o)); };
  const out = h('div');
  const first = L.weights[0], last = L.weights.at(-1);
  const review = h('button', { class: 'primary' }, '🧠 Αξιολόγηση προόδου από τον coach');
  review.addEventListener('click', () => withLoading(review, async () => {
    mount(out, spinner());
    try {
      const txt = await gemini({ system: SYSTEM, contents: [textPart(REVIEW_PROMPT())], temperature: 0.6 });
      state.lastReview = { date: today(), text: txt }; save();
      draw();
    } catch (e) { mount(out, ); throw e; }
  }));
  const adapt = h('button', {}, '🔁 Προσάρμοσε προγράμματα στα νέα δεδομένα');
  adapt.addEventListener('click', async () => {
    const extra = 'Ενημέρωση προόδου: ' + JSON.stringify(L.checkins.at(-1) || {}) + (state.lastReview ? '\nΠρόσφατη αξιολόγηση coach: ' + state.lastReview.text : '');
    await generateBoth(adapt, extra);
  });
  function draw() {
    mount(out, state.lastReview && h('div', { class: 'card' }, h('h2', {}, `Αξιολόγηση ${state.lastReview.date}`), md(state.lastReview.text), h('div', { class: 'row' }, adapt)));
  }
  mount(root, 
    h('h1', {}, 'Πρόοδος'), h('p', { class: 'sub' }, 'Κάνε ένα σύντομο check-in κάθε εβδομάδα — ο coach προσαρμόζει το πλάνο.'),
    h('div', { class: 'grid c3' },
      h('div', { class: 'card stat' }, h('div', { class: 'big' }, last ? last.kg : '—'), h('div', { class: 'muted' }, 'τρέχον βάρος (kg)')),
      h('div', { class: 'card stat' }, h('div', { class: 'big' }, first && last ? (last.kg - first.kg > 0 ? '+' : '') + (last.kg - first.kg).toFixed(1) : '—'), h('div', { class: 'muted' }, 'αλλαγή από την αρχή')),
      h('div', { class: 'card stat' }, h('div', { class: 'big' }, L.workouts.length), h('div', { class: 'muted' }, 'προπονήσεις'))),
    h('div', { class: 'card' }, h('h2', {}, 'Βάρος'), weightChart(L.weights)),
    h('div', { class: 'card' }, h('h2', {}, 'Εβδομαδιαίο check-in'),
      h('div', { class: 'grid c2' },
        h('div', { class: 'field' }, h('label', {}, 'Βάρος σήμερα (kg)'), h('input', { type: 'number', step: 0.1, oninput: e => ci.weight = e.target.value })),
        h('div', { class: 'field' }, h('label', {}, 'Πόνοι / ενοχλήσεις'), h('input', { type: 'text', placeholder: 'π.χ. γόνατο, μέση — ή τίποτα', oninput: e => ci.pain = e.target.value }))),
      h('div', { class: 'grid c3' }, slider('mood', 'Διάθεση'), slider('energy', 'Ενέργεια'), slider('sleep', 'Ποιότητα ύπνου'), slider('adherence', 'Τήρηση προγράμματος')),
      h('div', { class: 'field' }, h('label', {}, 'Σχόλια'), h('textarea', { placeholder: 'Τι πήγε καλά; Τι δυσκόλεψε;', oninput: e => ci.notes = e.target.value })),
      h('button', { class: 'primary', onclick: () => {
        const entry = { date: today(), ...ci, weight: ci.weight ? +ci.weight : undefined };
        if (entry.weight) L.weights.push({ date: entry.date, kg: entry.weight });
        L.checkins.push(entry); save(); toast('Το check-in αποθηκεύτηκε', 'success'); progressView(root);
      } }, 'Αποθήκευση check-in')),
    h('div', { class: 'row' }, review), out,
    L.checkins.length > 0 && h('div', { class: 'card' }, h('h3', {}, 'Ιστορικό check-in'),
      h('div', { style: 'overflow-x:auto' }, h('table', {}, h('tr', {}, ['Ημ/νία', 'Βάρος', 'Διάθ.', 'Ενέρ.', 'Ύπνος', 'Τήρηση', 'Πόνοι'].map(t => h('th', {}, t))),
        L.checkins.slice(-8).reverse().map(c => h('tr', {}, [fmtDate(c.date), c.weight ?? '–', c.mood, c.energy, c.sleep, c.adherence, c.pain || '–'].map(v => h('td', {}, String(v)))))))));
  draw();
}
