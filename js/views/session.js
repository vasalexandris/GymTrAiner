import { h, mount, toast } from '../ui.js';
import { state, save, today } from '../store.js';
import { Avatar, webglAvailable, LOOKS } from '../avatar.js';
import { MOTIONS, inferMotion, parseReps } from '../motions.js';
import { speak, cancelSpeech, setVoiceEnabled, setVoiceRate, countWord, hasGreekVoice, voiceSupported } from '../voice.js';
import { videoBlock, musicBlock } from '../media.js';
import { altPanel } from '../alternative.js';

const JUMP = Symbol('jump'), STOP = Symbol('stop');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function sessionView(root) {
  const dayIdx = +sessionStorage.getItem('gt.day');
  const day = state.plan?.days?.[dayIdx];
  if (!day?.exercises?.length) { location.hash = '#/workout'; return; }
  const C = (state.settings.coach ||= { voice: true, speed: 1 });
  C.look ||= 'male';
  setVoiceEnabled(C.voice); setVoiceRate(1);

  const ctl = { stop: false, jump: null, skip: false, skipIntro: false };
  let ei = 0, set = 1, rep = 0, phase = 'ready', paused = false, started = false, avatar = null, wake = null, altOpen = false;
  const N = () => day.exercises.length;

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

  try {
    if (webglAvailable()) { avatar = new Avatar(canvasBox, C.look); }
    else throw new Error('no webgl');
  } catch (e) {
    console.warn('3D μη διαθέσιμο', e);
    canvasBox.append(h('div', { class: 'empty' }, h('div', { class: 'ico' }, '🏋️'), h('p', { class: 'muted' }, 'Το 3D animation δεν υποστηρίζεται σε αυτή τη συσκευή· ο coach θα συνεχίσει με φωνή και οδηγίες.')));
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
      h('div', { style: 'margin-top:10px' }, toggle), altBox));
  }

  function prepare() {
    const ex = day.exercises[ei], mk = inferMotion(ex);
    avatar?.setMotion(mk); avatar?.ready(); hud(''); drawInfo();
  }

  function drawControls() {
    const btn = (label, fn, cls = '') => h('button', { class: cls, onclick: fn }, label);
    mount(controls,
      !started ? btn('▶ Έναρξη προπόνησης', start, 'primary') : [
        btn(paused ? '▶ Συνέχεια' : '⏸ Παύση', () => setPaused(!paused), 'primary'),
        phase === 'intro' || phase === 'rest' || phase === 'count' ? btn('⏩ Παράλειψη', skip) : null,
        btn('⏮', () => jump(ei - 1)), btn('⏭ Επόμενη άσκηση', () => jump(ei + 1)),
      ],
      h('select', { style: 'width:auto', title: 'Εμφάνιση coach', onchange: e => {
        C.look = e.target.value; save();
        if (avatar) { avatar.dispose(); avatar = new Avatar(canvasBox, C.look); avatar.pause(paused); const mk = inferMotion(day.exercises[ei]); avatar.setMotion(mk); avatar.ready(); }
      } }, Object.entries(LOOKS).map(([k, l]) => h('option', { value: k, selected: k === C.look }, k === 'male' ? '🧔 Coach: Άντρας' : '👩 Coach: Γυναίκα'))),
      btn(C.voice ? '🔊 Φωνή' : '🔇 Φωνή', e => { C.voice = !C.voice; setVoiceEnabled(C.voice); save(); drawControls(); }),
      h('select', { style: 'width:auto', title: 'Ρυθμός', onchange: e => { C.speed = +e.target.value; save(); } },
        [[1.35, '🐢 Αργός ρυθμός'], [1, '⏱ Κανονικός'], [0.8, '🐇 Γρήγορος']].map(([v, l]) => h('option', { value: v, selected: v === C.speed }, l))),
      btn('Έξοδος', () => { cleanup(); location.hash = '#/workout'; }, 'danger'));
  }

  function setPaused(on) {
    paused = on; avatar?.pause(on);
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
  async function wait(sec, onTick) {
    let left = sec; onTick?.(Math.ceil(left));
    while (left > 0) {
      await gate();
      if (ctl.skip) { ctl.skip = false; return; }
      await sleep(100); if (!paused) left -= 0.1;
      onTick?.(Math.ceil(left));
    }
  }

  async function exerciseFlow(first) {
    const ex = day.exercises[ei], mk = inferMotion(ex);
    const { timed, n, perSide } = parseReps(ex.reps, mk);
    ctl.skipIntro = false; phase = 'intro'; set = 1; rep = 0;
    drawInfo(); prepare(); drawControls();
    await say(`${first ? 'Ξεκινάμε! Πρώτη άσκηση' : 'Επόμενη άσκηση'}: ${ex.name}. ${ex.sets} σετ, ${timed ? n + ' δευτερόλεπτα' : n + ' επαναλήψεις'}${perSide ? ' ανά πλευρά' : ''}.`);
    for (const step of (ex.instructions || []).slice(0, 3)) { if (ctl.skipIntro) break; await say(step); }
    for (set = 1; set <= ex.sets; set++) {
      hud(''); phase = 'count'; drawControls();
      avatar?.ready();
      await say(`Σετ ${set}. Ετοιμάσου!`);
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
        if (avatar) await avatar.cycle(dur, alt); else await wait(dur);
        chk(); await gate();
        let words = countWord(r);
        if (n >= 6 && r === Math.ceil(n / 2) && r !== n) words += ', μισά!';
        else if (n >= 6 && r === n - 2) words += ', ακόμα δύο!';
        else if (r === n) words += ', τέλεια!';
        setCaption(words); sp(words, { interrupt: true });
      }
    }
    await wait(1.2);
  }

  async function holdFlow(secs, mk) {
    avatar?.hold(secs);
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
    phase = 'rest'; drawControls(); avatar?.idle();
    say(toNext ? `Μπράβο! Τελειώσαμε την άσκηση. Ξεκούραση ${sec} δευτερόλεπτα.` : `Ωραία! Ξεκούραση ${sec} δευτερόλεπτα.`, false);
    let last = -1;
    await wait(sec, left => {
      if (left === last) return; last = left; counter.textContent = `😮‍💨 ${left}″`;
      if (left === 10 && sec > 15) { setCaption('Δέκα δευτερόλεπτα!'); sp('Δέκα δευτερόλεπτα', { interrupt: true }); }
      if (left <= 3 && left > 0) { sp(countWord(left), { interrupt: true }); if (left === 3) avatar?.ready(); }
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
    avatar?.idle(); phase = 'done'; counter.textContent = '🎉';
    sp('Μπράβο! Τελείωσες την προπόνηση. Εξαιρετική δουλειά!', { interrupt: true });
    let rpe = 6;
    mount(root,
      h('div', { class: 'card empty' }, h('div', { class: 'ico' }, '🎉'), h('h2', {}, 'Μπράβο! Τελείωσες την προπόνηση'),
        h('div', { class: 'field', style: 'max-width:320px;margin:16px auto' }, h('label', {}, 'Πόσο δύσκολη ήταν; (1-10)'), h('input', { type: 'range', min: 1, max: 10, value: 6, oninput: e => rpe = +e.target.value })),
        h('button', { class: 'primary', onclick: () => { state.logs.workouts.push({ date: today(), day: day.day, focus: day.focus, rpe }); save(); cleanup(); toast('Καταγράφηκε!', 'success'); location.hash = '#/'; } }, 'Αποθήκευση')));
  }

  async function start() {
    started = true; drawControls();
    try { wake = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
    main();
  }

  function cleanup() {
    ctl.stop = true; cancelSpeech(); avatar?.dispose(); avatar = null;
    try { wake?.release(); } catch { /* ignore */ }
    document.removeEventListener('visibilitychange', onVis);
  }
  const onVis = () => { if (document.hidden && started && !paused) setPaused(true); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('hashchange', cleanup, { once: true });

  // ---------- Αρχική εμφάνιση ----------
  if (voiceSupported() === false) mount(warn, h('div', { class: 'banner small' }, 'Η συσκευή/ο browser δεν υποστηρίζει φωνή· ο coach θα εμφανίζει υπότιτλους.'));
  setTimeout(() => { if (voiceSupported() && !hasGreekVoice() && !ctl.stop) mount(warn, h('div', { class: 'banner small' }, '🔈 Δεν βρέθηκε ελληνική φωνή στη συσκευή — η ομιλία μπορεί να ακούγεται ξενόγλωσσα. Στο κινητό: Ρυθμίσεις → Γλώσσα → Text-to-speech → Ελληνικά.')); }, 800);
  mount(root,
    h('div', { class: 'row between' }, h('h1', {}, day.focus || 'Προπόνηση'), h('span', { class: 'tag' }, '🎙 Coach mode')),
    warn,
    h('div', { class: 'session-grid' }, h('div', {}, stage, controls), info));
  prepare(); drawControls();
}
