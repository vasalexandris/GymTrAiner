// Κοινή βιβλιοθήκη βίντεο (data/video-library.json, μέσα στην εφαρμογή):
// ό,τι έχει βρεθεί/ελεγχθεί μία φορά, το παίρνουν όλοι οι χρήστες χωρίς κλήσεις YouTube/Gemini.
import { state, save } from './store.js';

let shipped = {}, loaded = null;
export function loadLibrary() {
  return (loaded ||= fetch('data/video-library.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : { items: {} })).then(j => { shipped = j.items || {}; return shipped; })
    .catch(() => (shipped = {})));
}

const STOP = /\b(proper|correct|perfect|form|how to|tutorial|exercise|exercises|technique|guide|demo|demonstration|beginners?|for|the|a|an|#?shorts?)\b/g;
export function keyOf(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, ' ').replace(STOP, ' ').replace(/[^a-z0-9α-ω]+/g, ' ').trim().replace(/\s+/g, ' ');
}
const keysFor = ex => [keyOf(ex.youtube_query), keyOf(ex.name)].filter(Boolean);

/** Εγγραφή βιβλιοθήκης για άσκηση: πρώτα η κοινή (shipped), μετά η τοπική του χρήστη */
export function lookup(ex) {
  const local = state.videoLib || {};
  for (const k of keysFor(ex)) { if (shipped[k]) return { ...shipped[k], key: k, from: 'shared' }; }
  for (const k of keysFor(ex)) { if (local[k]) return { ...local[k], key: k, from: 'local' }; }
  return null;
}

/** Καταγραφή (τοπικά) βίντεο + επανάληψης που βρέθηκε/ορίστηκε, για εξαγωγή στην κοινή βιβλιοθήκη */
export function record(ex, video, seg) {
  if (!video?.id || !seg) return;
  const entry = { id: video.id, title: video.title || '', channel: video.channel || '', start: +seg.start.toFixed(2), end: +seg.end.toFixed(2), src: seg.src, name: ex.name, query: ex.youtube_query || '', verified: seg.src === 'user' };
  state.videoLib ||= {};
  for (const k of keysFor(ex)) state.videoLib[k] = entry;
  save();
}

export const libraryStats = () => ({ shared: Object.keys(shipped).length, local: Object.keys(state.videoLib || {}).length });

/** Ενωμένη βιβλιοθήκη (κοινή + τοπική) για commit στο repo */
export function exportLibrary() {
  return JSON.stringify({ version: 1, note: 'Κοινή βιβλιοθήκη βίντεο επίδειξης GymTrAIner', updated: new Date().toISOString().slice(0, 10), items: { ...shipped, ...(state.videoLib || {}) } }, null, 2);
}

/** Λίστα γνωστών ασκήσεων για να προτιμά το AI ασκήσεις που υπάρχουν ήδη στη βιβλιοθήκη */
export function knownQueries(max = 60) {
  const seen = new Set(), out = [];
  for (const e of Object.values(shipped)) { const q = e.query || e.name; if (q && !seen.has(q)) { seen.add(q); out.push(`${e.name} → youtube_query: "${e.query}"`); } if (out.length >= max) break; }
  return out;
}
