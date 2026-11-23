import { h, mount, toast } from '../ui.js';
import { state, save, today } from '../store.js';
import { Avatar, webglAvailable, LOOKS } from '../avatar.js';
import { MOTIONS, inferMotion, parseReps } from '../motions.js';
import { speak, cancelSpeech, setVoiceEnabled, setVoiceRate, countWord, hasGreekVoice, voiceSupported } from '../voice.js';
import { videoBlock, musicBlock } from '../media.js';
import { altPanel } from '../alternative.js';
import { equipmentFor } from '../equipment.js';
import { getCustomModel } from '../modelstore.js';
import { setAll } from '../worklog.js';
import { VideoCoach } from '../videocoach.js';

const JUMP = Symbol('jump'), STOP = Symbol('stop');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function sessionView(root) {
  const dayIdx = +sessionStorage.getItem('gt.day');
  const day = state.plan?.days?.[dayIdx];
  if (!day?.exercises?.length) { location.hash = '#/workout'; return; }
  const C = (state.settings.coach ||= { voice: true, speed: 1 });
  if (!C.lookV2) { C.look = 'real'; C.lookV2 = true; save(); } // νέα προεπιλογή: ρεαλιστικός coach
  let customModel = null;
  C.view ||= state.settings.ytKey ? 'video' : '3d'; // 'video': πραγματικός άνθρωπος σε loop · '3d': avatar
  state.videoPick ||= {};
  setVoiceEnabled(C.voice); setVoiceRate(1);

  const ctl = { stop: false, jump: null, skip: false, skipIntro: false };
  let ei = 0, set = 1, rep = 0, phase = 'ready', paused = false, started = false, avatar = null, wake = null, altOpen = false;
  const N = () => day.exercises.length;
  const LOOK_LABEL = k => k === 'custom' ? '⭐ Coach: Δικό μου μοντέλο' : k === 'male' ? '🧔 Coach: Απλός (γεωμετρικός)' : k === 'female' ? '👩 Coach: Απλή (γεωμετρική)' : `${LOOKS[k].gender === 'm' ? '🧔' : '👩'} Coach: ${LOOKS[k].name}`;

  // ---------- UI ----------
  const stage = h('div', { class: 'stage' });
  const badge = h('div', { class: 'badge' });
  const counter = h('div', { class: 'counter' });
  const caption = h('div', { class: 'caption' }, 'Πάτα «Έναρξη» όταν είσαι έτοιμος/η. Ο coach θα σου δείχνει και θα σου λέει τι να κάνεις.');
  const canvasBox = h('div', { class: 'canvas-box' });
  stage.append(canvasBox, badge, counter, caption);
  const info = h('div');
  const controls = h('div', { class: 'row', style: 'margin:12px 0' });
  const warn = h('div');

  const onModelError = e => toast('Δεν φορτώθηκε το 3D μοντέλο — χρησιμοποιώ τον απλό coach. ' + (e?.message || ''), 'error');
  const videoBox = h('div', { class: 'video-box' });
  const vStatus = h('div', { class: 'video-status' });
  let vc = null; // VideoCoach
  let markStart = null;
  const segLabel = h('div', { class: 'small' });
  const updSeg = () => {
    const sg = vc?.seg;
    segLabel.textContent = sg ? `🎯 Επανάληψη στο βίντεο: ${sg.start.toFixed(1)}″ → ${sg.end.toFixed(1)}″ (${sg.src === 'ai' ? 'εντοπίστηκε αυτόματα' : sg.src === 'lib' ? '✓ από τη βιβλιοθήκη της εφαρμογής' : 'ορίστηκε από σένα'})${vc.rate !== 1 ? ` · ταχύτητα ${vc.rate}×` : ''}${markStart != null ? ` · αρχή σήμανσης ${markStart.toFixed(1)}″` : ''}`
      : `🎯 Δεν έχει οριστεί ακόμα επανάληψη — το βίντεο παίζει ελεύθερα.${markStart != null ? ` Αρχή σήμανσης: ${markStart.toFixed(1)}″` : ''}`;
  };
  const setVStatus = t => { vStatus.textContent = t; vStatus.style.display = t ? '' : 'none'; updSeg(); };
  function makeAvatar() {
    avatar?.dispose(); avatar = null; vc?.destroy(); vc = null; setVStatus('');
    stage.classList.toggle('video', C.view === 'video');
    if (C.view === 'video') {
      canvasBox.replaceChildren(videoBox, vStatus);
      vc = new VideoCoach(videoBox, { onStatus: setVStatus }); vc.pause(paused);
      prepare(); return;
    }
    canvasBox.replaceChildren();
    try {
      if (!webglAvailable()) throw new Error('no webgl');
      const look = C.look === 'custom' && !customModel ? 'real' : C.look;
      avatar = new Avatar(canvasBox, look, { customModel: customModel?.buf, onError: onModelError, quality: C.quality, env: C.env || 'studio', hair: C.hair || undefined });
      avatar.pause(paused); prepare();
    } catch (e) {
      console.warn('3D μη διαθέσιμο', e);
      mount(canvasBox, h('div', { class: 'empty' }, h('div', { class: 'ico' }, '🏋️'), h('p', { class: 'muted' }, 'Το 3D animation δεν υποστηρίζεται σε αυτή τη συσκευή· ο coach θα συνεχίσει με φωνή και οδηγίες.')));
    }
  }

  // φωνή + κίνηση στόματος του avatar
  const sp = (text, opts) => { avatar?.talkFor(Math.min(300 + text.length * 70, 6000)); return speak(text, opts); };
  const setCaption = t => { caption.textContent = t; };
  const hud = (big) => {
    const ex = day.exercises[ei];
    badge.textContent = `Άσκηση ${ei + 1}/${N()} · Σετ ${Math.min(set, ex.sets)}/${ex.sets}`;
    if (big !== undefined) counter.textContent = big;
  };

  function drawInfo() {
    const ex = day.exercises[ei];
    const altBox = h('div');
    const toggle = h('button', { class: 'ghost', onclick: () => {
      altOpen = !altOpen;
      if (altOpen) { setPaused(true); altBox.replaceChildren(altPanel(dayIdx, ei, () => { altOpen = false; setPaused(false); drawInfo(); if (started) ctl.jump = ei; else prepare(); })); }
      else { altBox.replaceChildren(); setPaused(false); }
    } }, '🔄 Δεν μπορώ να την κάνω');
    mount(info, h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('h2', {}, ex.name), h('span', { class: 'tag ok' }, `${ex.sets}×${ex.reps}`)),
      ex.original && h('p', { class: 'tag warn' }, `↪ εναλλακτική της «${ex.original.name}»`),
      h('p', { class: 'muted small' }, `Κίνηση coach: ${MOTIONS[inferMotion(ex)].label}${inferMotion(ex) === 'generic' ? ' (γενική — δες το βίντεο για την ακριβή εκτέλεση)' : ''}`),
      ex.instructions?.length && h('ol', {}, ex.instructions.map(s => h('li', {}, s))),
      ex.common_mistakes && h('p', {}, h('strong', {}, 'Συχνά λάθη: '), ex.common_mistakes),
      ex.modification && h('p', { class: 'muted small' }, '↪ ' + ex.modification),
      videoBlock(ex), musicBlock(ex, ei),
      vc && h('div', { class: 'seg-box' }, segLabel,
        h('div', { class: 'small muted', style: 'margin:4px 0 6px' }, 'Σε κάθε μέτρημα το βίντεο γυρίζει στην αρχή αυτού του τμήματος, ώστε να βλέπεις μία επανάληψη κάθε φορά. Αν δεν είναι σωστό: «Δες ολόκληρο», πάτα «Αρχή» όταν ξεκινά μια επανάληψη και «Τέλος» όταν τελειώνει.'),
        h('div', { class: 'row' },
          h('button', { onclick: () => { markStart = null; vc.free(); updSeg(); } }, '▶ Δες ολόκληρο'),
          h('button', { onclick: () => { markStart = vc.time(); updSeg(); } }, '⏺ Αρχή'),
          h('button', { onclick: () => { const t = vc.time(); if (markStart == null || t <= markStart + 0.5) return toast('Πάτα πρώτα «Αρχή» και μετά «Τέλος» στο τέλος της επανάληψης', 'error'); vc.setSeg(markStart, t); markStart = null; vc.demo(); updSeg(); toast('Αποθηκεύτηκε η επανάληψη', 'success'); } }, '⏹ Τέλος'),
          h('button', { onclick: () => vc.demo() }, '🔁 Δοκιμή'),
          h('button', { onclick: () => vc.autoDetect(true) }, '🤖 Αυτόματα')),
        h('div', { class: 'row', style: 'margin-top:8px;flex-wrap:nowrap' },
          h('input', { type: 'url', id: 'yt-link', placeholder: '📎 Δικό σου link YouTube για αυτή την άσκηση' }),
          h('button', { class: 'primary', onclick: async () => { try { await vc.useLink(root.querySelector('#yt-link').value); vc.demo(); toast('Το βίντεο ορίστηκε για την άσκηση', 'success'); } catch (e) { toast(e.message, 'error'); } } }, 'Χρήση'))),
      h('div', { style: 'margin-top:10px' }, toggle), altBox));
    updSeg();
  }

  function prepare() {
    const ex = day.exercises[ei], mk = inferMotion(ex);
    avatar?.setMotion(mk); avatar?.setEquipment(equipmentFor(ex, mk)); if (!started) avatar?.ready(); hud(''); drawInfo();
    if (vc) { const target = clamp(ex.tempo_sec || MOTIONS[mk].tempo, 1, 6) * C.speed; vc.show(ex).then(() => { vc?.setTempo(target); if (phase === 'ready' || phase === 'intro') vc?.demo(); else vc?.freeze(); drawInfo(); }); }
  }

  function drawControls() {
    const btn = (label, fn, cls = '') => h('button', { class: cls, onclick: fn }, label);
    mount(controls,
      !started ? btn('▶ Έναρξη προπόνησης', start, 'primary') : [
        btn(paused ? '▶ Συνέχεια' : '⏸ Παύση', () => setPaused(!paused), 'primary'),
        phase === 'intro' || phase === 'rest' || phase === 'count' ? btn('⏩ Παράλειψη', skip) : null,
        btn('⏮', () => jump(ei - 1)), btn('⏭ Επόμενη άσκηση', () => jump(ei + 1)),
      ],
      C.view === '3d' && h('select', { style: 'width:auto', title: 'Εμφάνιση coach', onchange: e => {
        C.look = e.target.value; C.view = '3d'; save(); makeAvatar(); drawControls();
      } }, Object.keys(LOOKS).filter(k => k !== 'custom' || customModel).map(k => h('option', { value: k, selected: k === C.look }, LOOK_LABEL(k)))),
      C.view === '3d' && (C.look === 'real' || !C.look) && h('select', { style: 'width:auto', title: 'Κόμμωση', onchange: e => { C.hair = e.target.value; save(); avatar?.setHair(C.hair); } },
        [['original', '💇 Κόμμωση: αρχική'], ['ponytail', '💇 Αλογοουρά'], ['bun', '💇 Κότσος'], ['braid', '💇 Πλεξούδα'], ['short', '💇 Κοντά']].map(([v, l]) => h('option', { value: v, selected: (C.hair || 'original') === v }, l))),
      btn('⛶', toggleFull),
      h('select', { style: 'width:auto', title: 'Προβολή', onchange: e => { C.view = e.target.value; save(); makeAvatar(); drawControls(); } },
        [['video', '🎬 Βίντεο (πραγματικός άνθρωπος)'], ['3d', '🧍 3D coach']].map(([v, l]) => h('option', { value: v, selected: v === C.view }, l))),
      C.view === 'video' ? btn('↻ Άλλο βίντεο', () => vc?.show(day.exercises[ei], { next: true }).then(() => { vc.demo(); drawInfo(); })) : null,
      btn(C.voice ? '🔊 Φωνή' : '🔇 Φωνή', e => { C.voice = !C.voice; setVoiceEnabled(C.voice); save(); drawControls(); }),
      h('select', { style: 'width:auto', title: 'Ρυθμός', onchange: e => { C.speed = +e.target.value; save(); } },
        [[1.35, '🐢 Αργός ρυθμός'], [1, '⏱ Κανονικός'], [0.8, '🐇 Γρήγορος']].map(([v, l]) => h('option', { value: v, selected: v === C.speed }, l))),
      btn('Έξοδος', () => { cleanup(); location.hash = '#/workout'; }, 'danger'));
  }

  function setPaused(on) {
    paused = on; avatar?.pause(on); vc?.pause(on);
    if (on) cancelSpeech(); 
    if (started) setCaption(on ? '⏸ Παύση' : '▶ Συνεχίζουμε!');
    drawControls();
  }
  function skip() { if (phase === 'intro') ctl.skipIntro = true; else ctl.skip = true; cancelSpeech(); }
  function jump(to) { if (!started) return; ctl.jump = clamp(to, 0, N()); avatar?.cancelPending(); cancelSpeech(); if (paused) setPaused(false); }

  // ---------- Ροή προπόνησης ----------
  const chk = () => { if (ctl.stop) throw STOP; if (ctl.jump != null) throw JUMP; };
  async function gate() { while (paused && !ctl.stop && ctl.jump == null) await sleep(150); chk(); }
  async function say(text, wait = true) {
    chk(); await gate(); setCaption(text);
    if (!wait) { sp(text, { interrupt: true }); return; }
    await sp(text); ctl.skip = false; await gate();
  }
  // Αναμονή σε ΠΡΑΓΜΑΤΙΚΟ χρόνο (performance.now), ώστε φωνή/βίντεο/κίνηση να μένουν συγχρονισμένα και σε αργές συσκευές
  async function wait(sec, onTick) {
    let left = sec, last = performance.now(); onTick?.(Math.ceil(left));
    while (left > 0) {
      await gate();
      if (ctl.skip) { ctl.skip = false; return; }
      await sleep(Math.min(100, Math.max(10, left * 1000)));
      const now = performance.now(); if (!paused) left -= (now - last) / 1000; last = now;
      onTick?.(Math.max(0, Math.ceil(left)));
    }
  }

  async function exerciseFlow(first) {
    const ex = day.exercises[ei], mk = inferMotion(ex);
    const { timed, n, perSide } = parseReps(ex.reps, mk);
    ctl.skipIntro = false; phase = 'intro'; set = 1; rep = 0;
    drawInfo(); prepare(); drawControls();
    await say(`${first ? 'Ξεκινάμε! Πρώτη άσκηση' : 'Επόμενη άσκηση'}: ${ex.name}. ${ex.sets} σετ, ${timed ? n + ' δευτερόλεπτα' : n + ' επαναλήψεις'}${perSide ? ' ανά πλευρά' : ''}.`);
    vc?.demo();
    for (const step of (ex.instructions || []).slice(0, 3)) { if (ctl.skipIntro) break; await say(step); }
    for (set = 1; set <= ex.sets; set++) {
      hud(''); phase = 'count'; drawControls();
      // Ο coach παίρνει θέση: αν είναι όρθιος και η άσκηση έχει μετάβαση (π.χ. όρθια → σανίδα), την παίζει όσο μιλάει
      const enterP = avatar ? avatar.enterExercise() : null; vc?.freeze();
      await say(`Σετ ${set}. Ετοιμάσου!`);
      if (enterP) { await enterP; chk(); await gate(); }
      for (const c of [3, 2, 1]) { hud(c); sp(countWord(c), { interrupt: true }); await wait(0.9); chk(); }
      phase = 'work'; drawControls(); say('Πάμε!', false);
      if (timed) await holdFlow(n, mk); else await repsFlow(ex, n, perSide, mk);
      const lastSet = set === ex.sets, lastEx = ei === N() - 1;
      if (lastSet && lastEx) break;
      await restFlow(lastSet ? Math.max(ex.rest_sec || 60, 45) : (ex.rest_sec || 60), lastSet);
    }
  }

  async function repsFlow(ex, n, perSide, mk) {
    const m = MOTIONS[mk];
    const dur = clamp((ex.tempo_sec || m.tempo), 1, 6) * C.speed;
    for (const side of perSide ? [false, true] : [false]) {
      if (perSide && side) await say('Άλλαξε πλευρά!');
      for (let r = 1; r <= n; r++) {
        rep = r; hud(`${r}/${n}`);
        const alt = perSide ? side : (m.alt && r % 2 === 0);
        let words = countWord(r);
        if (n >= 6 && r === Math.ceil(n / 2) && r !== n) words += ', μισά!';
        else if (n >= 6 && r === n - 2) words += ', ακόμα δύο!';
        else if (r === n) words += ', τέλεια!';
        const beat = () => { setCaption(words); sp(words, { interrupt: true }); };
        if (vc?.canSync()) { vc.setTempo(dur); await vc.rep(wait, beat); chk(); }  // φωνή ακριβώς στο τέλος της κίνησης του βίντεο
        else { if (avatar) await avatar.cycle(dur, alt); else await wait(dur); chk(); await gate(); beat(); }
      }
    }
    vc?.freeze();
    await wait(1.2);
  }

  async function holdFlow(secs, mk) {
    avatar?.hold(secs); vc?.hold();
    say(`Κράτα! ${secs} δευτερόλεπτα.`, false);
    for (let s = secs; s > 0; s--) {
      hud(s + '″');
      if (secs >= 20 && s === Math.floor(secs / 2)) { setCaption('Στη μέση! Αναπνέεις;'); sp('Στη μέση! Αναπνέεις;', { interrupt: true }); }
      else if (s <= 5) { setCaption(countWord(s)); sp(countWord(s), { interrupt: true }); }
      await wait(1); chk();
    }
    await say('Τέλεια! Ελευθέρωσε.', false);
  }

  async function restFlow(sec, toNext) {
    phase = 'rest'; drawControls(); avatar?.exitToRest(sec); vc?.freeze(); // σηκώνεται (μετάβαση) και ανασαίνει όρθιος
    say(toNext ? `Μπράβο! Τελειώσαμε την άσκηση. Ξεκούραση ${sec} δευτερόλεπτα.` : `Ωραία! Ξεκούραση ${sec} δευτερόλεπτα.`, false);
    let last = -1;
    await wait(sec, left => {
      if (left === last) return; last = left; counter.textContent = `😮‍💨 ${left}″`;
      if (left === 10 && sec > 15) { setCaption('Δέκα δευτερόλεπτα!'); sp('Δέκα δευτερόλεπτα', { interrupt: true }); }
      if (left <= 3 && left > 0) { sp(countWord(left), { interrupt: true }); }
    });
    chk();
  }

  async function main() {
    let first = true;
    while (ei < N()) {
      try { await exerciseFlow(first); first = false; ei++; }
      catch (e) {
        if (e === JUMP) { ei = ctl.jump; ctl.jump = null; ctl.skip = false; first = ei === 0; if (ei >= N() || ei < 0) { ei = clamp(ei, 0, N()); } continue; }
        if (e === STOP) return;
        console.error(e); toast(e.message, 'error'); return;
      }
    }
    finish();
  }

  function finish() {
    phase = 'done'; counter.textContent = '🎉'; badge.textContent = 'Τέλος προπόνησης';
    // Ο coach χειροκροτεί (motion capture) — η σκηνή μένει πάνω από την κάρτα ολοκλήρωσης
    if (avatar) { avatar.setMotion('generic'); avatar.setEquipment({}); avatar.celebrate(true); }
    setCaption('👏 Μπράβο! Εξαιρετική δουλειά!');
    sp('Μπράβο! Τελείωσες την προπόνηση. Εξαιρετική δουλειά!', { interrupt: true });
    let rpe = 6;
    mount(root,
      avatar && h('div', { class: 'stage-wrap' }, stage),
      h('div', { class: 'card empty' }, h('div', { class: 'ico' }, '🎉'), h('h2', {}, 'Μπράβο! Τελείωσες την προπόνηση'),
        h('div', { class: 'field', style: 'max-width:320px;margin:16px auto' }, h('label', {}, 'Πόσο δύσκολη ήταν; (1-10)'), h('input', { type: 'range', min: 1, max: 10, value: 6, oninput: e => rpe = +e.target.value })),
        h('button', { class: 'primary', onclick: () => { state.logs.workouts.push({ date: today(), day: day.day, focus: day.focus, rpe }); setAll(today(), day, 'done'); save(); cleanup(); toast('Καταγράφηκε!', 'success'); location.hash = '#/'; } }, 'Αποθήκευση')));
  }

  async function start() {
    started = true; drawControls(); avatar?.idle(); // όρθιος στις οδηγίες — παίρνει θέση στο «Ετοιμάσου»
    try { wake = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
    main();
  }

  function cleanup() {
    ctl.stop = true; cancelSpeech(); avatar?.dispose(); avatar = null; vc?.destroy(); vc = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    try { wake?.release(); } catch { /* ignore */ }
    document.removeEventListener('visibilitychange', onVis);
  }
  const onVis = () => { if (document.hidden && started && !paused) setPaused(true); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('hashchange', cleanup, { once: true });

  // ---------- Αρχική εμφάνιση ----------
  if (voiceSupported() === false) mount(warn, h('div', { class: 'banner small' }, 'Η συσκευή/ο browser δεν υποστηρίζει φωνή· ο coach θα εμφανίζει υπότιτλους.'));
  setTimeout(() => { if (voiceSupported() && !hasGreekVoice() && !ctl.stop) mount(warn, h('div', { class: 'banner small' }, '🔈 Δεν βρέθηκε ελληνική φωνή στη συσκευή — η ομιλία μπορεί να ακούγεται ξενόγλωσσα. Στο κινητό: Ρυθμίσεις → Γλώσσα → Text-to-speech → Ελληνικά.')); }, 800);
  const wrap = h('div', { class: 'stage-wrap' }, stage, controls);
  function toggleFull() {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (wrap.requestFullscreen) wrap.requestFullscreen().catch(() => wrap.classList.toggle('pseudo-fs'));
    else wrap.classList.toggle('pseudo-fs'); // iPhone: «ψεύτικη» πλήρης οθόνη
  }
  mount(root,
    h('div', { class: 'row between' }, h('h1', {}, day.focus || 'Προπόνηση'), h('span', { class: 'tag' }, '🎙 Coach mode')),
    warn, wrap, info);
  prepare(); drawControls();
  getCustomModel().then(m => { customModel = m || null; if (!ctl.stop) { makeAvatar(); drawControls(); } });
}
