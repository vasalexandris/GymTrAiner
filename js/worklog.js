// Καταγραφή προπονήσεων ανά ημερομηνία: τι έγινε από το πρόγραμμα, τι παραλείφθηκε, τι έγινε επιπλέον.
import { state, save } from './store.js';

export const entryKey = d => d.session || 'main';

export function logFor(date) { return (state.workoutLog ||= {})[date] || { entries: {}, extra: [] }; }

function commit(date, log) {
  const empty = !Object.keys(log.entries).length && !log.extra.length;
  if (empty) delete state.workoutLog[date]; else state.workoutLog[date] = log;
  save();
}

/** Ορίζει την κατάσταση μίας άσκησης ('done' | 'skip' | null) */
export function setExercise(date, d, i, status) {
  const log = logFor(date), k = entryKey(d);
  const e = log.entries[k] ||= { ex: {} };
  if (status) e.ex[i] = status; else delete e.ex[i];
  summarize(e, d);
  if (!Object.keys(e.ex).length) delete log.entries[k];
  commit(date, log);
}

/** Όλη η προπόνηση της ημέρας: 'done' ή 'skip' (π.χ. μετά την προπόνηση με τον coach) */
export function setAll(date, d, status) {
  const log = logFor(date), k = entryKey(d);
  const e = log.entries[k] = { ex: {} };
  (d.exercises || []).forEach((_, i) => { if (status) e.ex[i] = status; });
  summarize(e, d);
  if (!status) delete log.entries[k];
  commit(date, log);
}

export function addExtra(date, item) { const log = logFor(date); log.extra.push(item); commit(date, log); }
export function removeExtra(date, i) { const log = logFor(date); log.extra.splice(i, 1); commit(date, log); }

function summarize(e, d) {
  const ex = d.exercises || [];
  e.total = ex.length;
  e.done = Object.values(e.ex).filter(v => v === 'done').length;
  e.skipped = Object.entries(e.ex).filter(([, v]) => v === 'skip').map(([i]) => ex[i]?.name).filter(Boolean);
  e.focus = d.focus; e.mod = d.mod || '';
}
