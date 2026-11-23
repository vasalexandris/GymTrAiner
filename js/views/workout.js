import { h, spinner, withLoading, toast , mount} from '../ui.js';
import { state, save, today } from '../store.js';
import { geminiJSON, textPart } from '../api.js';
import { SYSTEM, PLAN_PROMPT, ACTIVITY_ESTIMATE_PROMPT, EXTRA_SESSION_PROMPT, REPLAN_WEEK_PROMPT } from '../prompts.js';
import { weekdayIndex, todayWeekday, dateOf, shortDate } from '../week.js';
import { logFor, entryKey, setExercise, setAll, addExtra, removeExtra } from '../worklog.js';
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

function exerciseCard(ex, i, dayIdx, redraw, open, st) {
  const altBox = h('div');
  return h('details', { class: 'ex', open },
    h('summary', {}, h('span', { class: st?.status ? 'ex-' + st.status : '' }, `${st?.status === 'done' ? '✓ ' : st?.status === 'skip' ? '✗ ' : ''}${i + 1}. ${ex.name}`), h('span', { class: 'tag ok' }, `${ex.sets}×${ex.reps}`)),
    st && h('div', { class: 'row meal-actions' },
      h('button', { class: 'chip' + (st.status === 'done' ? ' on' : ''), onclick: () => st.set(st.status === 'done' ? null : 'done') }, '✓ Την έκανα'),
      h('button', { class: 'chip' + (st.status === 'skip' ? ' on' : ''), onclick: () => st.set(st.status === 'skip' ? null : 'skip') }, '✗ Δεν την έκανα')),
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
  const tw = todayWeekday();
  let idx = Math.max(0, plan.days.findIndex(d => weekdayIndex(d.day) === tw));
  let openEx = null, panel = null;
  const body = h('div');
  const tabs = h('div', { class: 'day-tabs' });
  const da = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const sessAbbr = d => d.session ? ' ' + (/πρω/.test(da(d.session)) ? 'πρ.' : /απογ|βραδ/.test(da(d.session)) ? 'απ.' : '+') : '';

  const drawDay = () => {
    mount(tabs, ...plan.days.map((d, i) => h('button', { class: i === idx ? 'on' : '', onclick: () => { idx = i; openEx = null; panel = null; drawDay(); } },
      d.day.slice(0, 3) + sessAbbr(d) + (d.rest ? ' 😴' : '') + (weekdayIndex(d.day) === tw && !d.session ? ' •' : ''))));
    const d = plan.days[idx];
    const date = dateOf(d.day), isFuture = date && date > today(), isToday = date === today();
    const log = date ? logFor(date) : { entries: {}, extra: [] };
    const e = log.entries[entryKey(d)];
    const n = d.exercises?.length || 0;
    const stOf = i => (!date || isFuture) ? null : { status: e?.ex?.[i] || null, set: v => { setExercise(date, d, i, v); drawDay(); } };

    mount(body,
      h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('h2', {}, `${d.day}${d.session ? ' · ' + d.session : ''} — ${d.focus || ''}`), d.duration_min && h('span', { class: 'tag' }, `~${d.duration_min}΄`)),
        date && h('p', { class: 'small muted' }, shortDate(date) + (isToday ? ' · σήμερα' : '')),
        d.rest || !n
          ? h('p', { class: 'muted' }, 'Ημέρα ανάπαυσης. Η αποκατάσταση είναι μέρος της προόδου. 💤')
          : h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { sessionStorage.setItem('gt.day', idx); location.hash = '#/session'; } }, '▶ Ξεκίνα προπόνηση με τον coach')),
        // καταγραφή ημέρας
        !isFuture && date && n > 0 && h('div', { class: 'food-progress' },
          h('div', { class: 'row between small' }, h('span', {}, e ? `Έκανες ${e.done}/${n} ασκήσεις${e.skipped?.length ? ` · παρέλειψες ${e.skipped.length}` : ''}` : 'Δεν έχει καταγραφεί ακόμα'),
            h('span', { class: 'row', style: 'gap:6px' },
              h('button', { class: 'chip', onclick: () => { setAll(date, d, 'done'); drawDay(); } }, '✓ Την έκανα όλη'),
              h('button', { class: 'chip', onclick: () => { setAll(date, d, 'skip'); drawDay(); } }, '✗ Δεν έγινε'),
              e && h('button', { class: 'chip', onclick: () => { setAll(date, d, null); drawDay(); } }, '↺'))),
          h('div', { class: 'bar' }, h('i', { style: `width:${e ? Math.round(e.done / n * 100) : 0}%;background:var(--brand)` }))),
        // ένταση: άμεσα, χωρίς AI
        n > 0 && h('div', { class: 'row', style: 'margin-top:10px' },
          h('span', { class: 'small muted' }, 'Ένταση:'),
          h('button', { class: 'chip', onclick: () => { scaleDay(d, -1); drawDay(); } }, '➖ Πιο εύκολη'),
          h('button', { class: 'chip', onclick: () => { scaleDay(d, +1); drawDay(); } }, '➕ Πιο απαιτητική'),
          d.original && h('button', { class: 'ghost small', onclick: () => { Object.assign(d, d.original); delete d.original; delete d.mod; save(); drawDay(); } }, '↩ Επαναφορά'),
          d.mod && h('span', { class: 'tag warn' }, d.mod)),
        // επιπλέον / άλλη δραστηριότητα
        !isFuture && date && h('div', { class: 'row', style: 'margin-top:10px' },
          isToday && h('button', { class: 'ghost', onclick: () => { panel = panel === 'extra' ? null : 'extra'; drawDay(); } }, '➕ Έχω χρόνο για επιπλέον προπόνηση'),
          h('button', { class: 'ghost', onclick: () => { panel = panel === 'other' ? null : 'other'; drawDay(); } }, '📝 Έκανα κάτι άλλο / επιπλέον')),
        panel === 'extra' && extraForm(d),
        panel === 'other' && otherForm(date),
        log.extra?.length > 0 && h('ul', { class: 'small' }, log.extra.map((x, i) => h('li', {}, `📝 ${x.text}`, x.est ? ` — ~${x.est.minutes}΄ · ${x.est.intensity} · ~${x.est.kcal} kcal${x.est.note ? ' · ' + x.est.note : ''}` : '',
          ' ', h('button', { class: 'ghost small', onclick: () => { removeExtra(date, i); drawDay(); } }, '✕')))),
        d.session === 'Επιπλέον' && h('button', { class: 'ghost small danger', onclick: () => { plan.days.splice(idx, 1); idx = Math.max(0, idx - 1); save(); drawDay(); } }, '🗑 Αφαίρεση επιπλέον προπόνησης')),
      d.warmup?.length && h('div', { class: 'card' }, h('h3', {}, '🔥 Ζέσταμα'), h('ul', {}, d.warmup.map(x => h('li', {}, x)))),
      (d.exercises || []).map((ex, i) => exerciseCard(ex, i, idx, j => { openEx = j; drawDay(); }, i === openEx, stOf(i))),
      d.cooldown?.length && h('div', { class: 'card' }, h('h3', {}, '🧘 Αποθεραπεία / διατάσεις'), h('ul', {}, d.cooldown.map(x => h('li', {}, x)))),
      replanCard());
  };

  /** Πιο εύκολη/απαιτητική μέρα: σετ ±1, επαναλήψεις ±2 (ή ±10″), ανάπαυση ∓15″ — με δυνατότητα επαναφοράς */
  function scaleDay(d, dir) {
    if (!d.original) d.original = JSON.parse(JSON.stringify({ exercises: d.exercises, duration_min: d.duration_min }));
    const lvl = (d.level || 0) + dir; d.level = lvl;
    d.exercises = d.exercises.map(ex => {
      const timed = /δευτ|sec|″|\d\s*s\b|λεπτ/i.test(String(ex.reps));
      return { ...ex, sets: Math.max(1, Math.min(6, (+ex.sets || 3) + dir)),
        reps: String(ex.reps).replace(/\d+/g, v => String(Math.max(timed ? 10 : 3, +v + dir * (timed ? 10 : 2)))),
        rest_sec: Math.max(20, Math.min(150, (+ex.rest_sec || 60) - dir * 15)) };
    });
    if (d.duration_min) d.duration_min = Math.max(10, d.duration_min + dir * 8);
    d.mod = lvl === 0 ? '' : lvl > 0 ? `πιο απαιτητική (+${lvl})` : `πιο εύκολη (${lvl})`;
    if (!d.mod) { delete d.original; delete d.level; }
    save();
  }

  function extraForm(d) {
    const mins = h('select', { style: 'width:auto' }, [10, 15, 20, 30, 45, 60].map(v => h('option', { value: v, selected: v === 20 }, `${v} λεπτά`)));
    const wish = h('input', { type: 'text', placeholder: 'Τι θέλεις; (προαιρετικό) π.χ. κοιλιακούς, χαλαρό cardio, διατάσεις, χωρίς άλματα' });
    const go = h('button', { class: 'primary' }, '✨ Φτιάξε επιπλέον προπόνηση');
    go.addEventListener('click', () => withLoading(go, async () => {
      const lg = logFor(today()), doneToday = Object.values(lg.entries).map(x => `${x.focus || ''} (${x.done}/${x.total})`).concat(lg.extra.map(x => x.text)).join(', ');
      const day = await geminiJSON({ system: SYSTEM, contents: [textPart(EXTRA_SESSION_PROMPT(d.day, +mins.value, wish.value.trim(), doneToday))], temperature: 0.6, maxTokens: 8192 });
      if (!Array.isArray(day.exercises) || !day.exercises.length) throw new Error('Δεν ήρθε προπόνηση, δοκίμασε ξανά.');
      day.day = d.day; day.session = 'Επιπλέον'; day.rest = false;
      let at = idx; while (at + 1 < plan.days.length && plan.days[at + 1].day === d.day) at++;
      plan.days.splice(at + 1, 0, day); idx = at + 1; panel = null; save();
      toast('Προστέθηκε επιπλέον προπόνηση για σήμερα', 'success'); drawDay();
    }));
    return h('div', { class: 'other-form' }, h('div', { class: 'row' }, h('label', { style: 'margin:0' }, 'Διαθέσιμος χρόνος:'), mins), h('div', { style: 'margin:8px 0' }, wish), go);
  }

  function otherForm(date) {
    const ta = h('textarea', { rows: 2, placeholder: 'π.χ. περπάτημα 40΄ γρήγορο · ποδόσφαιρο 1 ώρα · κολύμπι 30΄ · μετακόμιση όλη μέρα' });
    const go = h('button', { class: 'primary' }, 'Αποθήκευση');
    go.addEventListener('click', () => withLoading(go, async () => {
      const text = ta.value.trim(); if (!text) return toast('Γράψε τι έκανες', 'error');
      let est = null;
      try { est = await geminiJSON({ system: SYSTEM, contents: [textPart(ACTIVITY_ESTIMATE_PROMPT(text))], temperature: 0.2, maxTokens: 1024 }); }
      catch (err) { toast('Δεν έγινε εκτίμηση (' + err.message + ') — αποθηκεύτηκε η περιγραφή.', 'error'); }
      addExtra(date, { text, est }); panel = null; drawDay();
    }));
    return h('div', { class: 'other-form' }, h('label', {}, 'Τι έκανες; (όπως θες — και στο περίπου)'), ta, h('div', { class: 'row', style: 'margin-top:6px' }, go));
  }

  function replanCard() {
    const wish = h('input', { type: 'text', placeholder: 'Τι θέλεις να αλλάξει; π.χ. θέλω περισσότερο · λιγότερο · πρωί και απόγευμα · μόνο 20΄ τη μέρα' });
    const QUICK = ['Θέλω περισσότερη προπόνηση', 'Θέλω λιγότερη / πιο ελαφριά', 'Πρωί και απόγευμα όποτε μπορώ', 'Έχω λιγότερο χρόνο αυτή την εβδομάδα', 'Έχασα προπονήσεις — ισορρόπησέ το'];
    const bWeek = h('button', { class: 'primary' }, '📅 Ξαναϋπολόγισε την υπόλοιπη εβδομάδα');
    bWeek.addEventListener('click', () => withLoading(bWeek, async () => {
      // Κρατάμε τις περασμένες μέρες και, για σήμερα, ό,τι έχει ήδη γίνει/καταγραφεί ή προστεθεί ως επιπλέον
      const todayLog = logFor(today());
      const keep = plan.days.filter(d => { const dt = dateOf(d.day); return dt && (dt < today() || (dt === today() && (todayLog.entries[entryKey(d)] || d.session === 'Επιπλέον'))); });
      const keptToday = keep.filter(d => dateOf(d.day) === today()).map(d => entryKey(d));
      const rest = plan.days.filter(d => !keep.includes(d));
      const names = [...new Set(rest.map(d => d.day))];
      if (!names.length) throw new Error('Η εβδομάδα τελείωσε — χρησιμοποίησε «Ξαναϋπολόγισε όλο το πρόγραμμα».');
      const r = await geminiJSON({ system: SYSTEM, contents: [textPart(REPLAN_WEEK_PROMPT(names, wish.value.trim()))], temperature: 0.6 });
      if (!Array.isArray(r.days) || !r.days.length) throw new Error('Δεν ήρθε νέο πρόγραμμα, δοκίμασε ξανά.');
      plan.previous = JSON.parse(JSON.stringify({ ...plan, previous: undefined }));
      const fresh = r.days.filter(d => weekdayIndex(d.day) >= 0 && !(dateOf(d.day) === today() && (keptToday.includes(entryKey(d)) || (keptToday.length && !d.session))));
      // σειρά: Δευτέρα → Κυριακή, και μέσα στη μέρα πρωί → απόγευμα → επιπλέον
      const ord = d => weekdayIndex(d.day) * 10 + (/πρω/.test(da(d.session)) ? 0 : !d.session ? 1 : /απογ|βραδ/.test(da(d.session)) ? 2 : 3);
      plan.days = [...keep, ...fresh].sort((a, b) => ord(a) - ord(b));
      plan.replan_note = r.note || ''; save();
      toast('Η υπόλοιπη εβδομάδα ξαναϋπολογίστηκε', 'success'); workoutView(root);
    }));
    const bAll = h('button', {}, '🔄 Ξαναϋπολόγισε όλο το πρόγραμμα');
    bAll.addEventListener('click', async () => {
      const extra = `Ο χρήστης ζητά αναπροσαρμογή του προγράμματος. Επιθυμία: ${wish.value.trim() || '(ισορρόπησε με βάση την καταγραφή)'}\nΛάβε υπόψη την καταγραφή του τι έκανε πραγματικά. Εξήγησε τι άλλαξες στο summary.`;
      const prev = JSON.parse(JSON.stringify({ ...plan, previous: undefined }));
      if (await generatePlan(bAll, extra)) { state.plan.previous = prev; save(); workoutView(root); }
    });
    return h('details', { class: 'card', open: !!plan.replan_note },
      h('summary', { style: 'cursor:pointer;font-weight:700' }, '🔁 Θέλεις περισσότερο, λιγότερο ή διαφορετικά; Ξαναϋπολόγισε το πρόγραμμα'),
      plan.replan_note && h('p', { class: 'small' }, '💬 ' + plan.replan_note),
      h('p', { class: 'small muted' }, 'Ο coach βλέπει τι έκανες, τι παρέλειψες και τι έκανες επιπλέον, και προσαρμόζει. Π.χ. 2 προπονήσεις τη μέρα (πρωί & απόγευμα), περισσότερη ή λιγότερη ένταση, λιγότερος χρόνος.'),
      h('div', { class: 'chips', style: 'margin:8px 0' }, QUICK.map(q => h('button', { class: 'chip', onclick: () => { wish.value = q; } }, q))),
      wish,
      h('div', { class: 'row', style: 'margin-top:8px' }, bWeek, bAll,
        plan.previous && h('button', { class: 'ghost', onclick: () => { const p = plan.previous; state.plan = p; save(); toast('Επαναφέρθηκε το προηγούμενο πρόγραμμα'); workoutView(root); } }, '↩ Προηγούμενο πρόγραμμα')));
  }

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
