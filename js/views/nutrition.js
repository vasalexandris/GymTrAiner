import { h, withLoading, toast, mount } from '../ui.js';
import { state, save, today } from '../store.js';
import { geminiJSON, textPart } from '../api.js';
import { generateBoth } from '../generate.js';
import { weekdayIndex, dateOf } from '../week.js';
import { SYSTEM, MEAL_PROMPT, HOUSEHOLD_PROMPT, FOOD_ESTIMATE_PROMPT, ADJUST_DAY_PROMPT } from '../prompts.js';

export async function generateMeal(btn, extra = '') {
  return withLoading(btn, async () => {
    const meal = await geminiJSON({ system: SYSTEM, contents: [textPart(MEAL_PROMPT(extra))], temperature: 0.7 });
    if (!Array.isArray(meal.days) || !meal.days.length) throw new Error('Μη έγκυρο πρόγραμμα διατροφής, δοκίμασε ξανά.');
    meal.created = today();
    state.meal = meal; save();
    toast('Το πρόγραμμα διατροφής είναι έτοιμο!', 'success');
    return true;
  });
}

const MACROS = ['kcal', 'protein', 'carbs', 'fat'];
const r0 = v => Math.round(+v || 0);

/** Τι έφαγε την ημέρα: ✓ = το γεύμα του προγράμματος, ✎ = εκτίμηση AI, ✗ = 0 */
function eatenOf(day, log) {
  const tot = { kcal: 0, protein: 0, carbs: 0, fat: 0, lines: [], logged: 0 };
  (day.meals || []).forEach((m, i) => {
    const e = log?.meals?.[i]; if (!e) return;
    tot.logged++;
    const src = e.status === 'ok' ? m : e.status === 'other' ? (e.est || {}) : null;
    if (src) MACROS.forEach(k => { tot[k] += +src[k] || 0; });
    tot.lines.push(e.status === 'ok' ? `- ${m.type}: ${m.name} (όπως στο πρόγραμμα)` : e.status === 'skip' ? `- ${m.type}: το παρέλειψε` : `- ${m.type}: αντί για «${m.name}» έφαγε «${e.text}»${e.est ? ` ≈ ${e.est.kcal} kcal` : ''}`);
  });
  MACROS.forEach(k => { tot[k] = r0(tot[k]); });
  return tot;
}

const HAND_GUIDE = [
  ['✋', 'Παλάμη', 'Πρωτεΐνη (κρέας, ψάρι, κοτόπουλο, τόφου): μια μερίδα ≈ μέγεθος & πάχος της παλάμης σου ≈ 100–120 g'],
  ['✊', 'Γροθιά', 'Υδατάνθρακες (ρύζι, ζυμαρικά, πατάτες, όσπρια μαγειρεμένα): μια γροθιά ≈ 1 φλιτζάνι ≈ 150–180 g'],
  ['🤲', 'Χούφτα', 'Λαχανικά: 1–2 γεμάτες χούφτες · Ξηροί καρποί: μια μικρή χούφτα ≈ 30 g'],
  ['👍', 'Αντίχειρας', 'Λίπη (ελαιόλαδο, βούτυρο, ταχίνι): ένας αντίχειρας ≈ 1 κουταλιά της σούπας ≈ 10–15 g'],
  ['🥄', 'Κουτάλια & φλιτζάνια', '1 κ.σ. ≈ 15 ml · 1 κ.γ. ≈ 5 ml · 1 φλιτζάνι τσαγιού ≈ 240 ml · 1 φέτα ψωμί ≈ 30 g · 1 αυγό ≈ 55 g'],
];

export function nutritionView(root) {
  const m = state.meal;
  if (!m) {
    const btn = h('button', { class: 'primary' }, state.plan ? '✨ Δημιούργησε πρόγραμμα διατροφής' : '✨ Δημιούργησε πρόγραμμα γυμναστικής & διατροφής');
    btn.addEventListener('click', async () => { if (await (state.plan ? generateMeal(btn) : generateBoth(btn))) nutritionView(root); });
    mount(root, h('h1', {}, 'Διατροφή'), h('div', { class: 'card empty' }, h('div', { class: 'ico' }, '🥗'),
      h('p', {}, state.profile ? 'Εβδομαδιαίο πλάνο γευμάτων προσαρμοσμένο σε στόχους, αλλεργίες και προτιμήσεις.' : 'Συμπλήρωσε πρώτα το προφίλ σου.'),
      state.profile ? btn : h('a', { class: 'btn primary', href: '#/onboarding' }, 'Προφίλ')));
    return;
  }
  state.foodLog ||= {};
  const todayIdx = Math.max(0, m.days.findIndex(d => weekdayIndex(d.day) === (new Date().getDay() + 6) % 7));
  let idx = todayIdx, openOther = null;
  const body = h('div'), tabs = h('div', { class: 'day-tabs' });
  const sum = (d, k) => r0((d.meals || []).reduce((a, x) => a + (+x[k] || 0), 0));
  const hasHousehold = m.days.every(d => (d.meals || []).every(x => x.household));

  const draw = () => {
    mount(tabs, ...m.days.map((d, i) => h('button', { class: i === idx ? 'on' : '', onclick: () => { idx = i; openOther = null; draw(); } }, d.day.slice(0, 3) + (i === todayIdx ? ' •' : ''))));
    const d = m.days[idx];
    const date = dateOf(d.day), isFuture = date && date > today();
    const log = state.foodLog[date] || { day: d.day, meals: {} };
    const eaten = eatenOf(d, log);
    const target = m.daily_calories || sum(d, 'kcal');
    const pct = Math.min(100, Math.round(eaten.kcal / Math.max(target, 1) * 100));
    const changed = Object.values(log.meals).some(e => e.status !== 'ok');
    const setStatus = (i, entry) => {
      if (entry) log.meals[i] = entry; else delete log.meals[i];
      if (Object.keys(log.meals).length) state.foodLog[date] = log; else delete state.foodLog[date];
      save(); draw();
    };

    mount(body, h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('h2', {}, `${d.day}${date ? ` · ${new Date(date).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' })}` : ''}`),
        h('span', { class: 'tag ok' }, `Πρόγραμμα: ${sum(d, 'kcal')} kcal · Π ${sum(d, 'protein')}g · Υ ${sum(d, 'carbs')}g · Λ ${sum(d, 'fat')}g`)),
      !isFuture && h('div', { class: 'food-progress' },
        h('div', { class: 'row between small' }, h('span', {}, `Έφαγες: ${eaten.kcal} / ${target} kcal · Π ${eaten.protein}g · Υ ${eaten.carbs}g · Λ ${eaten.fat}g`), h('span', { class: 'muted' }, `${eaten.logged}/${d.meals.length} γεύματα`)),
        h('div', { class: 'bar' }, h('i', { style: `width:${pct}%;background:${eaten.kcal > target * 1.08 ? 'var(--warn)' : 'var(--brand)'}` }))),
      d.meals_original && h('p', { class: 'small' }, '⚖️ Τα υπόλοιπα γεύματα αυτής της ημέρας προσαρμόστηκαν. ',
        h('button', { class: 'ghost small', onclick: () => { d.meals = d.meals_original; delete d.meals_original; delete d.adjust_note; save(); draw(); } }, '↩ Επαναφορά αρχικού')),
      d.adjust_note && h('p', { class: 'muted small' }, '💬 ' + d.adjust_note),
      (d.meals || []).map((x, i) => {
        const e = log.meals[i];
        const otherBox = openOther === i ? otherForm(i, x, setStatus) : null;
        return h('div', { class: 'meal' + (e ? ' logged-' + e.status : '') },
          h('div', { style: 'flex:1' },
            h('div', { class: 'small muted' }, x.type),
            h('strong', {}, x.name),
            h('div', { class: 'muted small' }, x.description),
            x.household && h('div', { class: 'small household' }, '🥄 ', x.household),
            e?.status === 'other' && h('div', { class: 'small other-note' }, `✎ Έφαγες: ${e.text}`, e.est ? ` — ≈ ${e.est.kcal} kcal (Π ${e.est.protein}g · Υ ${e.est.carbs}g · Λ ${e.est.fat}g)${e.est.note ? ' · ' + e.est.note : ''}` : ' — (χωρίς εκτίμηση)'),
            !isFuture && h('div', { class: 'row meal-actions' },
              h('button', { class: 'chip' + (e?.status === 'ok' ? ' on' : ''), onclick: () => setStatus(i, e?.status === 'ok' ? null : { status: 'ok', name: x.name }) }, '✓ Το έφαγα'),
              h('button', { class: 'chip' + (e?.status === 'other' ? ' on' : ''), onclick: () => { openOther = openOther === i ? null : i; draw(); } }, '✎ Έφαγα κάτι άλλο'),
              h('button', { class: 'chip' + (e?.status === 'skip' ? ' on' : ''), onclick: () => setStatus(i, e?.status === 'skip' ? null : { status: 'skip', name: x.name }) }, '✗ Δεν το έφαγα')),
            otherBox),
          h('span', { class: 'tag', style: 'white-space:nowrap;align-self:flex-start' }, `${x.kcal} kcal`));
      }),
      !isFuture && changed && adjustBox(d, date, log, eaten)));
  };

  // ---- «Έφαγα κάτι άλλο»: περιγραφή → εκτίμηση από AI ----
  function otherForm(i, x, setStatus) {
    const ta = h('textarea', { rows: 2, placeholder: 'π.χ. 2 φέτες πίτσα μαργαρίτα και μια κόκα κόλα zero · ένα πιάτο φακές με ψωμί · τίποτα, μόνο καφέ' });
    const go = h('button', { class: 'primary' }, 'Αποθήκευση');
    go.addEventListener('click', () => withLoading(go, async () => {
      const text = ta.value.trim(); if (!text) return toast('Γράψε τι έφαγες', 'error');
      let est = null;
      try { est = await geminiJSON({ system: SYSTEM, contents: [textPart(FOOD_ESTIMATE_PROMPT(text, x))], temperature: 0.2, maxTokens: 1024 }); MACROS.forEach(k => { est[k] = r0(est[k]); }); }
      catch (e) { toast('Δεν έγινε εκτίμηση θερμίδων (' + e.message + ') — αποθηκεύτηκε η περιγραφή.', 'error'); }
      openOther = null; setStatus(i, { status: 'other', name: x.name, text, est });
    }));
    return h('div', { class: 'other-form' }, h('label', {}, 'Τι έφαγες; (περιέγραψε όπως θες — και στο περίπου)'), ta, h('div', { class: 'row', style: 'margin-top:6px' }, go, h('button', { class: 'ghost', onclick: () => { openOther = null; draw(); } }, 'Ακύρωση')));
  }

  // ---- Επαναϋπολογισμός: (α) υπόλοιπα γεύματα της ημέρας ή (β) πρόγραμμα/στόχοι ----
  function adjustBox(d, date, log, eaten) {
    const remaining = d.meals.map((meal, index) => ({ meal, index })).filter(r => !log.meals[r.index]);
    const wish = h('input', { type: 'text', placeholder: 'Τι προτιμάς; (προαιρετικό) π.χ. ελαφρύ βραδινό, χωρίς μαγείρεμα, θέλω να χάνω πιο αργά' });
    const bDay = h('button', { class: 'primary', disabled: !remaining.length }, '⚖️ Προσάρμοσε τα υπόλοιπα γεύματα σήμερα');
    bDay.addEventListener('click', () => withLoading(bDay, async () => {
      const r = await geminiJSON({ system: SYSTEM, contents: [textPart(ADJUST_DAY_PROMPT(d, eaten, remaining, m, wish.value.trim()))], temperature: 0.5, maxTokens: 4096 });
      if (!Array.isArray(r.meals) || !r.meals.length) throw new Error('Δεν ήρθε προσαρμογή, δοκίμασε ξανά.');
      d.meals_original ||= JSON.parse(JSON.stringify(d.meals));
      for (const nm of r.meals) if (Number.isInteger(nm.index) && d.meals[nm.index] && !log.meals[nm.index]) { const { index, ...rest } = nm; d.meals[nm.index] = rest; }
      d.adjust_note = r.note || ''; save(); toast('Τα υπόλοιπα γεύματα προσαρμόστηκαν', 'success'); draw();
    }));
    const bPlan = h('button', {}, '🎯 Αναπροσάρμοσε πρόγραμμα & στόχους');
    bPlan.addEventListener('click', async () => {
      const days = Object.entries(state.foodLog).filter(([, l]) => Object.keys(l.meals || {}).length).sort().slice(-7)
        .map(([dt, l]) => `${dt}: ` + Object.values(l.meals).map(x => x.status === 'ok' ? `✓ ${x.name}` : x.status === 'skip' ? `✗ ${x.name}` : `✎ ${x.text}${x.est ? ` (~${x.est.kcal} kcal)` : ''}`).join('; ')).join('\n');
      const extra = `Ο χρήστης κατέγραψε τι έφαγε πραγματικά τις τελευταίες μέρες:\n${days}\n` +
        `Αναπροσάρμοσε ρεαλιστικά το πρόγραμμα (και αν χρειάζεται τους ημερήσιους στόχους θερμίδων/μακροθρεπτικών), ώστε να ταιριάζει με τις συνήθειές του χωρίς να χάνεται ο στόχος υγείας. Εξήγησε τι άλλαξες στο summary.` +
        (wish.value.trim() ? `\nΕπιθυμία χρήστη: ${wish.value.trim()}` : '');
      if (await generateMeal(bPlan, extra)) nutritionView(root);
    });
    return h('div', { class: 'adjust-box' },
      h('h3', {}, '🔁 Η μέρα δεν πήγε όπως το πρόγραμμα; Τι θέλεις να κάνουμε;'),
      h('p', { class: 'small muted' }, `Υπόλοιπο ημέρας: ${Math.max(0, (m.daily_calories || 0) - eaten.kcal)} kcal. Μπορείς να αφήσεις τα υπόλοιπα γεύματα όπως είναι, να τα προσαρμόσουμε για σήμερα, ή να αλλάξουμε το πρόγραμμα/τους στόχους με βάση τι τρως στην πράξη.`),
      wish, h('div', { class: 'row', style: 'margin-top:8px' }, bDay, bPlan));
  }

  const regen = h('button', {}, '🔄 Νέο πρόγραμμα');
  regen.addEventListener('click', async () => { if (await generateMeal(regen)) nutritionView(root); });
  const hh = h('button', {}, '🥄 Πρόσθεσε ποσότητες χωρίς ζυγαριά');
  hh.addEventListener('click', () => withLoading(hh, async () => {
    const r = await geminiJSON({ system: SYSTEM, contents: [textPart(HOUSEHOLD_PROMPT(m.days))], temperature: 0.3, maxTokens: 8192 });
    (r.days || []).forEach((arr, i) => (arr || []).forEach((t, j) => { if (m.days[i]?.meals?.[j] && t) m.days[i].meals[j].household = t; }));
    save(); toast('Προστέθηκαν ποσότητες με καθημερινά μέτρα', 'success'); nutritionView(root);
  }));

  mount(root,
    h('div', { class: 'row between' }, h('div', {}, h('h1', {}, 'Διατροφή'), h('p', { class: 'sub' }, `Δημιουργήθηκε ${m.created || ''}`)), h('div', { class: 'row' }, !hasHousehold && hh, regen)),
    h('div', { class: 'card' }, h('p', {}, m.summary),
      h('div', { class: 'grid c3' },
        h('div', { class: 'stat' }, h('div', { class: 'big' }, m.daily_calories), h('div', { class: 'muted' }, 'kcal/ημέρα')),
        h('div', { class: 'stat' }, h('div', { class: 'big' }, `${m.macros?.protein_g}g`), h('div', { class: 'muted' }, 'πρωτεΐνη')),
        h('div', { class: 'stat' }, h('div', { class: 'big' }, m.water_l ? `${m.water_l} lt` : '—'), h('div', { class: 'muted' }, 'νερό'))),
      h('p', { class: 'muted small' }, `Υδατάνθρακες ${m.macros?.carbs_g}g · Λιπαρά ${m.macros?.fat_g}g`)),
    tabs, body,
    h('details', { class: 'card' }, h('summary', { style: 'cursor:pointer;font-weight:700' }, '✋ Δεν έχεις ζυγαριά; Οδηγός μερίδων με το χέρι σου'),
      h('div', { class: 'hand-guide' }, HAND_GUIDE.map(([ic, t, d]) => h('div', { class: 'hg' }, h('div', { class: 'ic' }, ic), h('div', {}, h('strong', {}, t), h('div', { class: 'small muted' }, d))))),
      h('p', { class: 'hint' }, 'Οι μερίδες «με το χέρι» προσαρμόζονται αυτόματα στο μέγεθός σου — μεγαλύτερο χέρι, μεγαλύτερη μερίδα. Για απώλεια βάρους, προτίμησε το κάτω όριο.')),
    h('div', { class: 'grid c2' },
      m.shopping_list?.length && h('div', { class: 'card' }, h('h3', {}, '🛒 Λίστα αγορών'), h('ul', {}, m.shopping_list.map(x => h('li', {}, x)))),
      m.tips?.length && h('div', { class: 'card' }, h('h3', {}, '💡 Συμβουλές'), h('ul', {}, m.tips.map(x => h('li', {}, x))))));
  draw();
}
