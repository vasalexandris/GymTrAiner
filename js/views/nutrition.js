import { h, withLoading, toast , mount} from '../ui.js';
import { state, save, today } from '../store.js';
import { geminiJSON, textPart } from '../api.js';
import { SYSTEM, MEAL_PROMPT } from '../prompts.js';

export async function generateMeal(btn, extra = '') {
  return withLoading(btn, async () => {
    const meal = await geminiJSON({ system: SYSTEM, contents: [textPart(MEAL_PROMPT(extra))], temperature: 0.7 });
    if (!Array.isArray(meal.days) || !meal.days.length) throw new Error('Μη έγκυρο πρόγραμμα διατροφής, δοκίμασε ξανά.');
    meal.created = today();
    state.meal = meal; save();
    toast('Το πρόγραμμα διατροφής είναι έτοιμο!', 'success');
    return true;
  });
}

export function nutritionView(root) {
  const m = state.meal;
  if (!m) {
    const btn = h('button', { class: 'primary' }, '✨ Δημιούργησε πρόγραμμα διατροφής');
    btn.addEventListener('click', async () => { if (await generateMeal(btn)) nutritionView(root); });
    mount(root, h('h1', {}, 'Διατροφή'), h('div', { class: 'card empty' }, h('div', { class: 'ico' }, '🥗'),
      h('p', {}, state.profile ? 'Εβδομαδιαίο πλάνο γευμάτων προσαρμοσμένο σε στόχους, αλλεργίες και προτιμήσεις.' : 'Συμπλήρωσε πρώτα το προφίλ σου.'),
      state.profile ? btn : h('a', { class: 'btn primary', href: '#/onboarding' }, 'Προφίλ')));
    return;
  }
  let idx = 0;
  const body = h('div'), tabs = h('div', { class: 'day-tabs' });
  const sum = (d, k) => Math.round((d.meals || []).reduce((a, x) => a + (+x[k] || 0), 0));
  const draw = () => {
    mount(tabs, ...m.days.map((d, i) => h('button', { class: i === idx ? 'on' : '', onclick: () => { idx = i; draw(); } }, d.day.slice(0, 3))));
    const d = m.days[idx];
    mount(body, h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('h2', {}, d.day), h('span', { class: 'tag ok' }, `${sum(d, 'kcal')} kcal · Π ${sum(d, 'protein')}g · Υ ${sum(d, 'carbs')}g · Λ ${sum(d, 'fat')}g`)),
      (d.meals || []).map(x => h('div', { class: 'meal' },
        h('div', {}, h('div', { class: 'small muted' }, x.type), h('strong', {}, x.name), h('div', { class: 'muted small' }, x.description)),
        h('span', { class: 'tag', style: 'white-space:nowrap;align-self:flex-start' }, `${x.kcal} kcal`)))));
  };
  const regen = h('button', {}, '🔄 Νέο πρόγραμμα');
  regen.addEventListener('click', async () => { if (await generateMeal(regen)) nutritionView(root); });
  mount(root, 
    h('div', { class: 'row between' }, h('div', {}, h('h1', {}, 'Διατροφή'), h('p', { class: 'sub' }, `Δημιουργήθηκε ${m.created || ''}`)), regen),
    h('div', { class: 'card' }, h('p', {}, m.summary),
      h('div', { class: 'grid c3' },
        h('div', { class: 'stat' }, h('div', { class: 'big' }, m.daily_calories), h('div', { class: 'muted' }, 'kcal/ημέρα')),
        h('div', { class: 'stat' }, h('div', { class: 'big' }, `${m.macros?.protein_g}g`), h('div', { class: 'muted' }, 'πρωτεΐνη')),
        h('div', { class: 'stat' }, h('div', { class: 'big' }, m.water_l ? `${m.water_l} lt` : '—'), h('div', { class: 'muted' }, 'νερό'))),
      h('p', { class: 'muted small' }, `Υδατάνθρακες ${m.macros?.carbs_g}g · Λιπαρά ${m.macros?.fat_g}g`)),
    tabs, body,
    h('div', { class: 'grid c2' },
      m.shopping_list?.length && h('div', { class: 'card' }, h('h3', {}, '🛒 Λίστα αγορών'), h('ul', {}, m.shopping_list.map(x => h('li', {}, x)))),
      m.tips?.length && h('div', { class: 'card' }, h('h3', {}, '💡 Συμβουλές'), h('ul', {}, m.tips.map(x => h('li', {}, x))))));
  draw();
}
