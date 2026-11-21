// Φωνή του coach μέσω Web Speech API (δωρεάν, τοπικά στον browser).
const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
let voice = null, enabled = true, rate = 1.0;
const pending = new Set();

function pickVoice() {
  if (!synth) return;
  const vs = synth.getVoices();
  voice = vs.find(v => /^el[-_]/i.test(v.lang) && /google|natural|premium/i.test(v.name)) || vs.find(v => /^el/i.test(v.lang)) || null;
}
if (synth) { pickVoice(); synth.addEventListener?.('voiceschanged', pickVoice); }

export const voiceSupported = () => !!synth;
export const hasGreekVoice = () => { pickVoice(); return !!voice; };
export const setVoiceEnabled = on => { enabled = on; if (!on) cancelSpeech(); };
export const setVoiceRate = r => { rate = r; };

/** Μιλάει και επιστρέφει Promise όταν τελειώσει (ή αν ακυρωθεί). Χωρίς φωνή: προσομοιώνει τον χρόνο ανάγνωσης. */
export function speak(text, { interrupt = false } = {}) {
  return new Promise(resolve => {
    let done = false, timer;
    const fin = () => { if (!done) { done = true; clearTimeout(timer); pending.delete(fin); resolve(); } };
    pending.add(fin);
    if (!enabled || !synth) { timer = setTimeout(fin, Math.min(300 + text.length * 55, 5000)); return; }
    if (interrupt) cancelSpeech(true);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'el-GR'; if (voice) u.voice = voice; u.rate = rate; u.pitch = 1;
    u.onend = fin; u.onerror = fin;
    timer = setTimeout(fin, 2500 + text.length * 120); // ασφάλεια αν δεν έρθει onend (συμβαίνει σε κινητά)
    pending.add(fin);
    synth.speak(u);
  });
}

/** Διακόπτει την ομιλία. keep=true: δεν αγγίζει τα υπόλοιπα pending promises. */
export function cancelSpeech(keep = false) {
  try { synth?.cancel(); } catch { /* ignore */ }
  if (!keep) [...pending].forEach(f => f());
}

const WORDS = ['', 'ένα', 'δύο', 'τρία', 'τέσσερα', 'πέντε', 'έξι', 'επτά', 'οκτώ', 'εννιά', 'δέκα', 'έντεκα', 'δώδεκα', 'δεκατρία', 'δεκατέσσερα', 'δεκαπέντε', 'δεκαέξι', 'δεκαεπτά', 'δεκαοκτώ', 'δεκαεννιά', 'είκοσι'];
export const countWord = n => WORDS[n] || String(n);

export const repsSpoken = (n, timed) => timed ? `${n} δευτερόλεπτα` : `${n} επαναλήψεις`;
