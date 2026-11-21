// Κατάσταση εφαρμογής — αποθηκεύεται μόνο στο localStorage του browser.
const KEY = 'gymtrainer.v1';

const defaults = () => ({
  settings: { geminiKey: '', ytKey: '', model: 'gemini-2.5-flash' },
  profile: null,
  assessment: null,   // {summary, strengths[], risks[], bmi}
  goals: [],          // προτάσεις AI
  selectedGoals: [],  // ids που διάλεξε ο χρήστης
  plan: null,
  meal: null,
  logs: { weights: [], workouts: [], checkins: [] },
  medical: [],
  chat: [],
  ytCache: {},
});

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') {
      const d = defaults();
      return { ...d, ...raw, settings: { ...d.settings, ...raw.settings }, logs: { ...d.logs, ...raw.logs } };
    }
  } catch (e) { /* ignore */ }
  return defaults();
}

export const state = load();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { console.warn('Αδυναμία αποθήκευσης', e); }
}

export function exportData() {
  const { settings, ytCache, ...rest } = state; // τα keys ΔΕΝ εξάγονται
  return JSON.stringify({ app: 'GymTrAIner', version: 1, ...rest }, null, 2);
}

export function importData(text) {
  const obj = JSON.parse(text);
  if (obj.app !== 'GymTrAIner') throw new Error('Μη έγκυρο αρχείο GymTrAIner');
  const { app, version, ...rest } = obj;
  Object.assign(state, defaults(), { settings: state.settings }, rest);
  save();
}

export function resetAll() {
  const keys = state.settings;
  Object.assign(state, defaults(), { settings: keys });
  save();
}

export const today = () => new Date().toISOString().slice(0, 10);
export const uid = () => Math.random().toString(36).slice(2, 10);
