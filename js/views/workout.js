import { h, spinner, withLoading, toast , mount} from '../ui.js';
import { state, save, today } from '../store.js';
import { geminiJSON, textPart } from '../api.js';
import { SYSTEM, PLAN_PROMPT } from '../prompts.js';
import { generateBoth } from '../generate.js';
import { videoBlock, musicBlock } from '../media.js';
import { altPanel } from '../alternative.js';
import { musicPrefsCard } from '../music.js';

export async function generatePlan(btn, extra = '') {
  return withLoading(btn, async () => {
    const plan = await geminiJSON({ system: SYSTEM, contents: [textPart(PLAN_PROMPT(extra))], temperature: 0.6 });
    if (!Array.isArray(plan.days) || !plan.days.length) throw new Error('Μη έγκυρο πρόγραμμα, δοκίμασε ξανά.');
    plan.created = today();
    state.plan = plan; save();
    toast('Το πρόγραμμα γυμναστικής είναι έτοιμο!', 'success');
    return true;
  });
}

function exerciseCard(ex, i, dayIdx, redraw, open) {
  const altBox = h('div');
  return h('details', { class: 'ex', open },
    h('summary', {}, h('span', {}, `${i + 1}. ${ex.name}`), h('span', { class: 'tag ok' }, `${ex.sets}×${ex.reps}`)),
    h('div', { class: 'meta' },
      ex.muscles && h('span', { class: 'tag' }, '💪 ' + ex.muscles),
      ex.equipment && h('span', { class: 'tag' }, '🧰 ' + ex.equipment),
      ex.rest_sec != null && h('span', { class: 'tag' }, `⏱ ανάπαυση ${ex.rest_sec}″`)),
    ex.instructions?.length && h('ol', {}, ex.instructions.map(s => h('li', {}, s))),
    ex.common_mistakes && h('p', {}, h('strong', {}, 'Συχνά λάθη: '), ex.common_mistakes),
    ex.modification && h('p', {}, h('strong', {}, 'Εναλλακτική/προσαρμογή: '), ex.modification),
    ex.original && h('p', { class: 'tag warn' }, `↪ εναλλακτική της «${ex.original.name}»`),
    videoBlock(ex), musicBlock(ex, i),
    h('div', { style: 'margin-top:10px' }, h('button', { class: 'ghost', onclick: () => altBox.children.length ? altBox.replaceChildren() : altBox.replaceChildren(altPanel(dayIdx, i, () => redraw(i))) }, '🔄 Δεν μπορώ να την κάνω — δείξε μου εναλλακτική')), altBox);
}

export function workoutView(root) {
  const plan = state.plan;
  if (!plan) {
    const btn = h('button', { class: 'primary' }, '✨ Δημιούργησε πρόγραμμα γυμναστικής & διατροφής');
    btn.addEventListener('click', async () => { if (await (state.meal ? generatePlan(btn) : generateBoth(btn))) workoutView(root); });
    mount(root, h('h1', {}, 'Πρόγραμμα γυμναστικής'),
      h('div', { class: 'card empty' }, h('div', { class: 'ico' }, '🏋️'),
        h('p', {}, state.profile ? 'Ο coach θα φτιάξει πρόγραμμα με βάση το προφίλ και τους στόχους σου.' : 'Συμπλήρωσε πρώτα το προφίλ σου.'),
        state.profile ? btn : h('a', { class: 'btn primary', href: '#/onboarding' }, 'Προφίλ')));
    return;
  }
  const todayName = new Date().toLocaleDateString('el-GR', { weekday: 'long' }).toLowerCase();
  let idx = Math.max(0, plan.days.findIndex(d => d.day.toLowerCase().startsWith(todayName.slice(0, 4))));
  let openEx = null;
  const body = h('div');
  const tabs = h('div', { class: 'day-tabs' });
  const drawDay = () => {
    mount(tabs, ...plan.days.map((d, i) => h('button', { class: i === idx ? 'on' : '', onclick: () => { idx = i; openEx = null; drawDay(); } }, d.day.slice(0, 3) + (d.rest ? ' 😴' : ''))));
    const d = plan.days[idx];
    mount(body, 
      h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('h2', {}, `${d.day} — ${d.focus || ''}`), d.duration_min && h('span', { class: 'tag' }, `~${d.duration_min}΄`)),
        d.rest || !d.exercises?.length
          ? h('p', { class: 'muted' }, 'Ημέρα ανάπαυσης. Η αποκατάσταση είναι μέρος της προόδου. 💤')
          : h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { sessionStorage.setItem('gt.day', idx); location.hash = '#/session'; } }, '▶ Ξεκίνα προπόνηση με τον coach'))),
      d.warmup?.length && h('div', { class: 'card' }, h('h3', {}, '🔥 Ζέσταμα'), h('ul', {}, d.warmup.map(x => h('li', {}, x)))),
      (d.exercises || []).map((ex, i) => exerciseCard(ex, i, idx, j => { openEx = j; drawDay(); }, i === openEx)),
      d.cooldown?.length && h('div', { class: 'card' }, h('h3', {}, '🧘 Αποθεραπεία / διατάσεις'), h('ul', {}, d.cooldown.map(x => h('li', {}, x)))));
  };
  const regen = h('button', {}, '🔄 Νέο πρόγραμμα');
  regen.addEventListener('click', async () => { if (await generatePlan(regen)) workoutView(root); });
  mount(root, 
    h('div', { class: 'row between' }, h('div', {}, h('h1', {}, 'Πρόγραμμα γυμναστικής'), h('p', { class: 'sub' }, `Δημιουργήθηκε ${plan.created || ''}`)), regen),
    h('div', { class: 'card' }, h('p', {}, plan.summary), plan.progression && h('p', { class: 'muted' }, '📈 ' + plan.progression),
      plan.safety_notes?.length && h('ul', {}, plan.safety_notes.map(s => h('li', {}, '⚠️ ' + s)))),
    musicPrefsCard(() => drawDay()),
    tabs, body);
  drawDay();
}
