// Συγχρονισμένο βίντεο επίδειξης: σε κάθε επανάληψη του coach, το βίντεο γυρίζει στην αρχή
// μιας πραγματικής επανάληψης (τμήμα start→end) και την παίζει ακριβώς μία φορά.
import { state, save } from './store.js';
import { ytSearch, geminiJSON } from './api.js';
import { loadLibrary, lookup, record } from './videolib.js';

let apiP;
function loadYT() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return (apiP ||= new Promise((res, rej) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); res(window.YT); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiP = null; rej(new Error('Δεν φορτώθηκε το YouTube player')); };
    document.head.append(s);
  }));
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5]; // ασφαλείς ταχύτητες YouTube
const SPEECH_LEAD = 0.28; // δευτ.: η φωνή ξεκινά λίγο νωρίτερα ώστε να ακούγεται τη στιγμή που ολοκληρώνεται η κίνηση
const segOk = s => s && s.end > s.start && s.end - s.start >= 0.7 && s.end - s.start <= 9;

/** Ζητά από το Gemini (που «βλέπει» βίντεο YouTube) τα όρια μίας καθαρής επανάληψης. */
export async function detectRep(id, ex) {
  const prompt = `Το βίντεο δείχνει την άσκηση «${ex.name}» (${ex.youtube_query || ''}).
Βρες ΜΙΑ καθαρή, πλήρη επανάληψη με σωστή τεχνική, όπου ο ασκούμενος ξεκινά και τελειώνει στην ίδια αρχική θέση (ιδανικά από το πρώτο μισό του βίντεο, χωρίς τίτλους/κείμενα μπροστά).
Δώσε ακριβή χρόνο αρχής και τέλους σε δευτερόλεπτα με δεκαδικά. Μια επανάληψη συνήθως διαρκεί 1.5–5 δευτερόλεπτα.
Αν είναι ισομετρική άσκηση (π.χ. σανίδα), δώσε ένα τμήμα 3–6 δευτερολέπτων όπου φαίνεται καθαρά η θέση.
Αν η άσκηση δεν φαίνεται στο βίντεο, δώσε confidence 0.
Επίστρεψε ΜΟΝΟ JSON: {"start": number, "end": number, "confidence": number, "note": "σύντομη περιγραφή"}`;
  const part = fps => ({ fileData: { fileUri: `https://www.youtube.com/watch?v=${id}` }, videoMetadata: { startOffset: '0s', endOffset: '75s', ...(fps ? { fps } : {}) } });
  const ask = fps => geminiJSON({ contents: [{ role: 'user', parts: [part(fps), { text: prompt }] }], temperature: 0, maxTokens: 4096, config: { mediaResolution: 'MEDIA_RESOLUTION_LOW' } });
  let r;
  try { r = await ask(4); } catch (e) { if (/fps|video_?metadata|mediaResolution|Invalid JSON payload/i.test(e.message)) r = await ask(0); else throw e; }
  const seg = { start: +r.start, end: +r.end, conf: +r.confidence || 0, src: 'ai', note: r.note || '' };
  if (!segOk(seg) || seg.conf < 0.3) throw new Error('Δεν εντοπίστηκε καθαρή επανάληψη σε αυτό το βίντεο');
  return seg;
}

export class VideoCoach {
  constructor(box, { onStatus } = {}) {
    this.box = box; this.onStatus = onStatus || (() => {}); this.player = null; this.list = []; this.idx = 0; this.forQ = '';
    this.mode = 'idle'; this.timer = setInterval(() => this.tick(), 60); this.rate = 1;
    (state.videoSeg ||= {}); (state.videoPick ||= {});
  }

  get id() { return this.list[this.idx]?.id; }
  get seg() { const s = state.videoSeg[this.id]; return segOk(s) ? s : null; }
  get segLen() { const s = this.seg; return s ? (s.end - s.start) / this.rate : 0; }
  /** Ταίριασμα ρυθμού: ταχύτητα βίντεο ώστε 1 επανάληψη ≈ target δευτ. (ρυθμός άσκησης × επιλογή χρήστη) */
  setTempo(target) {
    this.target = target; const s = this.seg; if (!s || !target) return;
    let rates = RATES;
    try { const av = this.player?.getAvailablePlaybackRates?.(); if (av?.length) rates = av.filter(r => r >= 0.5 && r <= 1.5); } catch { /* ignore */ }
    const want = (s.end - s.start) / target;
    this.rate = rates.reduce((a, b) => Math.abs(Math.log(b / want)) < Math.abs(Math.log(a / want)) ? b : a, 1);
    try { this.player?.setPlaybackRate(this.rate); } catch { /* ignore */ }
  }
  setRate() { if (this.target) this.setTempo(this.target); }

  /** Φόρτωση βίντεο για άσκηση (next: επόμενο από τη λίστα) */
  async show(ex, { next = false } = {}) {
    this.ex = ex;
    const q = ex.youtube_query || `${ex.name} exercise`;
    await loadLibrary();
    const lib = lookup(ex);
    if (lib && !next && this.forQ !== q) { // κοινή βιβλιοθήκη: 0 κλήσεις API
      this.forQ = q; this.fromLib = true;
      this.list = [{ id: lib.id, title: lib.title, channel: lib.channel }]; this.idx = 0;
      const cur = state.videoSeg[lib.id];
      if (!(cur?.src === 'user' && segOk(cur))) state.videoSeg[lib.id] = { start: lib.start, end: lib.end, conf: 1, src: 'lib' };
      await this.mountPlayer(); return;
    }
    if (next && this.fromLib) { this.forQ = ''; this.fromLib = false; } // ο χρήστης θέλει άλλο βίντεο → αναζήτηση
    if (this.forQ !== q) {
      this.forQ = q; this.list = []; this.onStatus('⏳ Βρίσκω βίντεο επίδειξης…');
      try {
        const shorts = (await ytSearch(`${q} #shorts`, { max: 6, short: true })) || [];
        const normal = shorts.length >= 3 ? [] : ((await ytSearch(q, { max: 6, short: true })) || []);
        this.list = [...shorts, ...normal.filter(v => !shorts.some(s => s.id === v.id))];
      } catch (e) { this.onStatus('⚠️ ' + e.message); return; }
      if (this.forQ !== q) return;
      if (!this.list.length) { this.onStatus(state.settings.ytKey ? 'Δεν βρέθηκε βίντεο — δοκίμασε τον 3D coach.' : 'Χρειάζεται YouTube API key (Ρυθμίσεις) για βίντεο.'); return; }
      const saved = this.list.findIndex(v => v.id === state.videoPick[ex.name]);
      this.idx = saved >= 0 ? saved : 0;
    } else if (next && this.list.length) {
      this.idx = (this.idx + 1) % this.list.length; state.videoPick[ex.name] = this.id; save();
    }
    await this.mountPlayer();
    if (!this.seg) this.autoDetect();
  }

  async mountPlayer() {
    const id = this.id; if (!id) return;
    this.player?.destroy?.(); this.player = null;
    const el = document.createElement('div'); this.box.replaceChildren(el);
    let YT; try { YT = await loadYT(); } catch (e) { this.onStatus('⚠️ ' + e.message); return; }
    if (id !== this.id) return;
    this.player = new YT.Player(el, {
      host: 'https://www.youtube-nocookie.com', videoId: id, width: '100%', height: '100%',
      playerVars: { autoplay: 1, mute: 1, controls: 0, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, disablekb: 1, fs: 0, loop: 1, playlist: id },
      events: {
        onReady: e => { e.target.mute(); this.ready = true; this.setRate(); this.apply(); },
        onError: () => { this.onStatus('Αυτό το βίντεο δεν παίζει εδώ — περνάω στο επόμενο…'); if (this.list.length > 1) this.show(this.ex, { next: true }); },
      },
    });
    this.ready = false;
    this.onStatus(this.seg ? '' : '🤖 Εντοπίζω μία επανάληψη στο βίντεο…');
  }

  async autoDetect(force = false) {
    const id = this.id, ex = this.ex; if (!id || (!force && this.detecting === id)) return;
    this.detecting = id; this.onStatus('🤖 Εντοπίζω μία επανάληψη στο βίντεο…');
    try {
      const seg = await detectRep(id, ex);
      state.videoSeg[id] = seg; save(); record(ex, this.list.find(v => v.id === id), seg);
      if (id === this.id) { this.onStatus(''); this.setRate(); this.apply(); }
    } catch (e) {
      if (id === this.id) this.onStatus('Δεν βρέθηκε αυτόματα η επανάληψη — ορισέ τη χειροκίνητα (🎯) ή άλλαξε βίντεο. ' + (e.message || ''));
    } finally { if (this.detecting === id) this.detecting = null; }
  }

  setSeg(start, end) { if (!this.id) return; const seg = { start, end, conf: 1, src: 'user' }; state.videoSeg[this.id] = seg; save(); record(this.ex, this.list[this.idx], seg); this.setRate(); this.apply(); }
  time() { try { return this.player?.getCurrentTime?.() || 0; } catch { return 0; } }

  // ---- λειτουργίες αναπαραγωγής ----
  apply() {
    const p = this.player; if (!p || !this.ready) return;
    const s = this.seg;
    try {
      if (this.mode === 'free' || !s) { if (!this.paused) p.playVideo(); return; }
      if (this.mode === 'freeze') { p.seekTo(s.start, true); p.pauseVideo(); return; }
      if (this.mode === 'demo' || this.mode === 'hold') { p.seekTo(s.start, true); if (!this.paused) p.playVideo(); }
    } catch { /* ignore */ }
  }
  demo() { this.mode = 'demo'; this.apply(); }       // επανάληψη σε loop (εισαγωγή)
  freeze() { this.mode = 'freeze'; this.apply(); }   // στάση στην αρχική θέση (αντίστροφη μέτρηση/ξεκούραση)
  free() { this.mode = 'free'; this.apply(); }       // ελεύθερη αναπαραγωγή (χειροκίνητη σήμανση)
  hold() { this.mode = 'hold'; this.apply(); }       // ισομετρική: παίζει από την αρχή του τμήματος

  /** Μία επανάληψη: αρχή τμήματος → παίζει → περιμένει όσο διαρκεί */
  async rep(wait, onBeat) {
    const p = this.player, s = this.seg;
    this.mode = 'rep';
    try { p.seekTo(s.start, true); p.playVideo(); } catch { /* ignore */ }
    const len = this.segLen, lead = Math.min(SPEECH_LEAD, len * 0.25);
    await wait(len - lead); onBeat?.(); await wait(lead);
    try { if (this.mode === 'rep') p.pauseVideo(); } catch { /* ignore */ }
  }

  tick() {
    const p = this.player, s = this.seg; if (!p || !this.ready || !s) return;
    if (this.mode === 'demo' && this.time() >= s.end - 0.03) { try { p.seekTo(s.start, true); } catch { /* ignore */ } }
  }

  pause(on) { this.paused = on; try { if (on) this.player?.pauseVideo(); else if (this.mode !== 'freeze') this.player?.playVideo(); } catch { /* ignore */ } }
  canSync() { return !!(this.player && this.ready && this.seg); }
  destroy() { clearInterval(this.timer); try { this.player?.destroy(); } catch { /* ignore */ } this.player = null; this.box.replaceChildren(); }
}
