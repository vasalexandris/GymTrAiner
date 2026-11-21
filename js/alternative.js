import { h, withLoading, toast } from './ui.js';
import { state, save } from './store.js';
import { geminiJSON, textPart } from './api.js';
import { SYSTEM, ALT_PROMPT } from './prompts.js';

const QUICK = ['Δεν έχω τον εξοπλισμό', 'Πονάει / τραυματισμός', 'Πολύ δύσκολη για μένα', 'Δεν μου αρέσει', 'Δεν έχω χώρο'];

/** Ζητά από τον AI εναλλακτική άσκηση και την αντικαθιστά στο πρόγραμμα. Επιστρέφει τη νέα άσκηση. */
export async function swapExercise(dayIdx, exIdx, reason) {
  const day = state.plan.days[dayIdx], ex = day.exercises[exIdx];
  const alt = await geminiJSON({ system: SYSTEM, contents: [textPart(ALT_PROMPT(ex, day, reason))], temperature: 0.7, maxTokens: 4096 });
  if (!alt?.name) throw new Error('Δεν βρέθηκε εναλλακτική, δοκίμασε ξανά.');
  alt.tried = [...(ex.tried || []), ex.name];
  alt.original = ex.original || { ...ex, tried: undefined, original: undefined };
  alt.swapReason = reason || '';
  day.exercises[exIdx] = alt;
  (state.avoid ||= []).push({ name: ex.name, reason: reason || '', date: new Date().toISOString().slice(0, 10) });
  save();
  return alt;
}

export function restoreExercise(dayIdx, exIdx) {
  const ex = state.plan.days[dayIdx].exercises[exIdx];
  if (!ex.original) return;
  state.plan.days[dayIdx].exercises[exIdx] = ex.original;
  state.avoid = (state.avoid || []).filter(a => a.name !== ex.original.name);
  save();
}

/** Μικρό panel: λόγος (προαιρετικός) + κουμπί εναλλακτικής. onDone(newEx) καλείται μετά την αλλαγή. */
export function altPanel(dayIdx, exIdx, onDone) {
  const ex = state.plan.days[dayIdx].exercises[exIdx];
  const input = h('input', { type: 'text', placeholder: 'Γιατί; (προαιρετικό) π.χ. δεν έχω ιμάντες' });
  const go = h('button', { class: 'primary' }, '🔄 Βρες εναλλακτική');
  go.addEventListener('click', () => withLoading(go, async () => {
    const n = await swapExercise(dayIdx, exIdx, input.value.trim());
    toast(`Νέα άσκηση: ${n.name}`, 'success');
    onDone?.(n);
  }));
  return h('div', { class: 'alt-panel' },
    h('div', { class: 'small muted' }, ex.original ? `Αυτή είναι ήδη εναλλακτική της «${ex.original.name}». Δεν σου κάνει ούτε αυτή;` : 'Δεν μπορείς ή δεν θέλεις αυτή την άσκηση;'),
    h('div', { class: 'chips', style: 'margin:6px 0' }, QUICK.map(q => h('button', { type: 'button', class: 'chip', onclick: () => { input.value = q; } }, q))),
    h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('div', { style: 'flex:1' }, input), go),
    ex.original && h('button', { class: 'ghost small', style: 'margin-top:6px', onclick: () => { restoreExercise(dayIdx, exIdx); onDone?.(null); } }, `↩ Επαναφορά «${ex.original.name}»`));
}
