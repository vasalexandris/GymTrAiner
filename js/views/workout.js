import { h, spinner, withLoading, toast , mount} from '../ui.js';
import { state, save, today } from '../store.js';
import { geminiJSON, textPart } from '../api.js';
import { SYSTEM, PLAN_PROMPT } from '../prompts.js';
import { videoBlock, musicBlock } from '../media.js';

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

function exerciseCard(ex, i) {
  return h('details', { class: 'ex' },
    h('summary', {}, h('span', {}, `${i + 1}. ${ex.name}`), h('span', { class: 'tag ok' }, `${ex.sets}×${ex.reps}`)),
    h('div', { class: 'meta' },
      ex.muscles && h('span', { class: 'tag' }, '💪 ' + ex.muscles),
      ex.equipment && h('span', { class: 'tag' }, '🧰 ' + ex.equipment),
      ex.rest_sec != null && h('span', { class: 'tag' }, `⏱ ανάπαυση ${ex.rest_sec}″`)),
    ex.instructions?.length && h('ol', {}, ex.instructions.map(s => h('li', {}, s))),
    ex.common_mistakes && h('p', {}, h('strong', {}, 'Συχνά λάθη: '), ex.common_mistakes),
    ex.modification && h('p', {}, h('strong', {}, 'Εναλλακτική/προσαρμογή: '), ex.modification),
    videoBlock(ex), musicBlock(ex));
}

export function workoutView(root) {
  const plan = state.plan;
  if (!plan) {
    const btn = h('button', { class: 'primary' }, '✨ Δημιούργησε πρόγραμμα');
    btn.addEventListener('click', async () => { if (await generatePlan(btn)) workoutView(root); });
    mount(root, h('h1', {}, 'Πρόγραμμα γυμναστικής'),
      h('div', { class: 'card empty' }, h('div', { class: 'ico' }, '🏋️'),
        h('p', {}, state.profile ? 'Ο coach θα φτιάξει πρόγραμμα με βάση το προφίλ και τους στόχους σου.' : 'Συμπλήρωσε πρώτα το προφίλ σου.'),
        state.profile ? btn : h('a', { class: 'btn primary', href: '#/onboarding' }, 'Προφίλ')));
    return;
  }
  const todayName = new Date().toLocaleDateString('el-GR', { weekday: 'long' }).toLowerCase();
  let idx = Math.max(0, plan.days.findIndex(d => d.day.toLowerCase().startsWith(todayName.slice(0, 4))));
  const body = h('div');
  const tabs = h('div', { class: 'day-tabs' });
  const drawDay = () => {
    mount(tabs, ...plan.days.map((d, i) => h('button', { class: i === idx ? 'on' : '', onclick: () => { idx = i; drawDay(); } }, d.day.slice(0, 3) + (d.rest ? ' 😴' : ''))));
    const d = plan.days[idx];
    mount(body, 
      h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('h2', {}, `${d.day} — ${d.focus || ''}`), d.duration_min && h('span', { class: 'tag' }, `~${d.duration_min}΄`)),
        d.rest || !d.exercises?.length
          ? h('p', { class: 'muted' }, 'Ημέρα ανάπαυσης. Η αποκατάσταση είναι μέρος της προόδου. 💤')
          : h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { sessionStorage.setItem('gt.day', idx); location.hash = '#/session'; } }, '▶ Ξεκίνα καθοδηγούμενη προπόνηση'))),
      d.warmup?.length && h('div', { class: 'card' }, h('h3', {}, '🔥 Ζέσταμα'), h('ul', {}, d.warmup.map(x => h('li', {}, x)))),
      (d.exercises || []).map(exerciseCard),
      d.cooldown?.length && h('div', { class: 'card' }, h('h3', {}, '🧘 Αποθεραπεία / διατάσεις'), h('ul', {}, d.cooldown.map(x => h('li', {}, x)))));
  };
  const regen = h('button', {}, '🔄 Νέο πρόγραμμα');
  regen.addEventListener('click', async () => { if (await generatePlan(regen)) workoutView(root); });
  mount(root, 
    h('div', { class: 'row between' }, h('div', {}, h('h1', {}, 'Πρόγραμμα γυμναστικής'), h('p', { class: 'sub' }, `Δημιουργήθηκε ${plan.created || ''}`)), regen),
    h('div', { class: 'card' }, h('p', {}, plan.summary), plan.progression && h('p', { class: 'muted' }, '📈 ' + plan.progression),
      plan.safety_notes?.length && h('ul', {}, plan.safety_notes.map(s => h('li', {}, '⚠️ ' + s)))),
    tabs, body);
  drawDay();
}

// ---- Καθοδηγούμενη προπόνηση ----
export function sessionView(root) {
  const plan = state.plan;
  const day = plan?.days?.[+sessionStorage.getItem('gt.day')];
  if (!day?.exercises?.length) { location.hash = '#/workout'; return; }
  let ei = 0, set = 1, timer = null;
  const stop = () => { clearInterval(timer); timer = null; };
  window.addEventListener('hashchange', stop, { once: true });

  const draw = () => {
    const ex = day.exercises[ei];
    const total = day.exercises.length;
    const rest = h('div');
    const doneSet = () => {
      if (set < ex.sets) { set++; startRest(ex.rest_sec || 60); }
      else if (ei < total - 1) { ei++; set = 1; startRest(Math.max(ex.rest_sec || 60, 45), true); }
      else finish();
    };
    const startRest = (sec, next) => {
      stop(); let t = sec;
      const tick = h('div', { class: 'timer' }, fmt(t));
      mount(rest, h('div', { class: 'card' }, h('p', { class: 'muted', style: 'text-align:center' }, next ? 'Ξεκούραση πριν την επόμενη άσκηση' : 'Ξεκούραση'), tick,
        h('div', { class: 'row', style: 'justify-content:center' }, h('button', { onclick: () => { stop(); draw(); } }, 'Παράλειψη'), h('button', { onclick: () => { t += 15; tick.textContent = fmt(t); } }, '+15″'))));
      timer = setInterval(() => { t--; tick.textContent = fmt(Math.max(t, 0)); if (t <= 0) { stop(); try { navigator.vibrate?.(300); } catch {} draw(); } }, 1000);
    };
    mount(root, 
      h('div', { class: 'row between' }, h('h1', {}, day.focus || 'Προπόνηση'), h('button', { class: 'danger', onclick: () => { stop(); location.hash = '#/workout'; } }, 'Έξοδος')),
      h('div', { class: 'steps' }, day.exercises.map((_, i) => h('i', { class: i <= ei ? 'on' : '' }))),
      h('div', { class: 'card' },
        h('p', { class: 'muted' }, `Άσκηση ${ei + 1}/${total}`),
        h('div', { class: 'big' }, ex.name),
        h('div', { class: 'row', style: 'margin:10px 0' }, h('span', { class: 'tag ok' }, `Σετ ${set}/${ex.sets}`), h('span', { class: 'tag ok' }, `${ex.reps} επαναλήψεις`)),
        ex.instructions?.length && h('ol', {}, ex.instructions.map(s => h('li', {}, s))),
        ex.modification && h('p', { class: 'muted small' }, '↪ ' + ex.modification),
        h('button', { class: 'primary', style: 'width:100%;padding:14px;font-size:1.1rem', onclick: doneSet }, `✔ Ολοκλήρωσα το σετ ${set}`),
        videoBlock(ex), musicBlock(ex)),
      rest);
  };
  const finish = () => {
    stop();
    let rpe = 6;
    mount(root, h('div', { class: 'card empty' }, h('div', { class: 'ico' }, '🎉'), h('h2', {}, 'Μπράβο! Τελείωσες την προπόνηση'),
      h('div', { class: 'field', style: 'max-width:320px;margin:16px auto' }, h('label', {}, 'Πόσο δύσκολη ήταν; (1-10)'), h('input', { type: 'range', min: 1, max: 10, value: 6, oninput: e => rpe = +e.target.value })),
      h('button', { class: 'primary', onclick: () => { state.logs.workouts.push({ date: today(), day: day.day, focus: day.focus, rpe }); save(); toast('Καταγράφηκε!', 'success'); location.hash = '#/'; } }, 'Αποθήκευση')));
  };
  draw();
}
const fmt = s => `${Math.floor(Math.max(s, 0) / 60)}:${String(Math.max(s, 0) % 60).padStart(2, '0')}`;
