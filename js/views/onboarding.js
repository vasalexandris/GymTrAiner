import { h, toast, spinner, withLoading , mount} from '../ui.js';
import { state, save } from '../store.js';
import { geminiJSON, textPart } from '../api.js';
import { SYSTEM, ASSESS_PROMPT } from '../prompts.js';
import { GENRE_OPTIONS } from '../music.js';

const EQUIP = ['Χωρίς εξοπλισμό', 'Αλτήρες', 'Λάστιχα αντίστασης', 'Kettlebell', 'Μπάρα έλξεων', 'Στρώμα γυμναστικής', 'Μπάρα & βάρη', 'Διάδρομος/ποδήλατο', 'Γυμναστήριο (πλήρες)'];
const DAYS = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο', 'Κυριακή'];

const STEPS = [
  { title: 'Τα βασικά', fields: [
    { k: 'name', label: 'Πώς σε λένε;', type: 'text' },
    { k: 'age', label: 'Ηλικία', type: 'number', min: 14, max: 99, req: true },
    { k: 'sex', label: 'Φύλο (για υπολογισμό θερμίδων)', type: 'select', options: ['Γυναίκα', 'Άνδρας', 'Προτιμώ να μην πω'], req: true },
    { k: 'height_cm', label: 'Ύψος (cm)', type: 'number', min: 120, max: 230, req: true },
    { k: 'weight_kg', label: 'Βάρος (kg)', type: 'number', min: 35, max: 250, step: 0.1, req: true },
    { k: 'target_weight_kg', label: 'Βάρος-στόχος (kg, προαιρετικό)', type: 'number', step: 0.1 },
  ] },
  { title: 'Υγεία & τραυματισμοί', fields: [
    { k: 'injuries', label: 'Τραυματισμοί ή πόνοι τώρα/στο παρελθόν', type: 'textarea', ph: 'π.χ. πόνος στο δεξί γόνατο, δισκοπάθεια Ο.Μ.Σ.Σ., ώμος…' },
    { k: 'conditions', label: 'Παθήσεις / φάρμακα που σχετίζονται', type: 'textarea', ph: 'π.χ. υπέρταση, σακχαρώδης διαβήτης, άσθμα, θυρεοειδής…' },
    { k: 'activity_level', label: 'Καθημερινή δραστηριότητα', type: 'select', options: ['Καθιστική δουλειά, λίγη κίνηση', 'Ελαφρά (περπάτημα)', 'Μέτρια (όρθιος/η, κινούμενος/η)', 'Έντονη (χειρωνακτική)'] },
  ] },
  { title: 'Προπόνηση', fields: [
    { k: 'experience', label: 'Εμπειρία στη γυμναστική', type: 'select', options: ['Καθόλου / ξεκινάω', 'Λίγη (< 1 έτος)', 'Μέτρια (1-3 έτη)', 'Μεγάλη (3+ έτη)'], req: true },
    { k: 'equipment', label: 'Τι εξοπλισμό έχεις;', type: 'multi', options: EQUIP },
    { k: 'days', label: 'Ποιες μέρες μπορείς να γυμνάζεσαι;', type: 'multi', options: DAYS },
    { k: 'minutes', label: 'Διάρκεια ανά προπόνηση (λεπτά)', type: 'select', options: ['20-30', '30-45', '45-60', '60-90'] },
    { k: 'music_genres', label: '🎵 Τι μουσική σου αρέσει όταν γυμνάζεσαι; (διάλεξε όσες θες)', type: 'multi', options: GENRE_OPTIONS },
    { k: 'music_artists', label: 'Αγαπημένοι καλλιτέχνες/τραγούδια (προαιρετικό)', type: 'text', ph: 'π.χ. Queen, Eminem, Μπάμπης Στόκας' },
    { k: 'likes', label: 'Τι σου αρέσει / τι αποφεύγεις;', type: 'textarea', ph: 'π.χ. μου αρέσει το HIIT, δεν θέλω τρέξιμο…' },
    { k: 'motivation', label: 'Διάθεση για γυμναστική σήμερα (1 = καθόλου, 5 = τέλεια)', type: 'range' },
  ] },
  { title: 'Διατροφή', fields: [
    { k: 'diet_type', label: 'Τύπος διατροφής', type: 'select', options: ['Κανονική / όλα', 'Χορτοφαγική', 'Vegan', 'Πεσκετεριανή', 'Χαμηλούς υδατάνθρακες', 'Νηστεία (διαλειμματική)'] },
    { k: 'allergies', label: 'Αλλεργίες / δυσανεξίες / τροφές που αποφεύγεις', type: 'textarea', ph: 'π.χ. λακτόζη, ξηροί καρποί, γλουτένη' },
    { k: 'meals_per_day', label: 'Γεύματα ημερησίως', type: 'select', options: ['2', '3', '4', '5+'] },
    { k: 'cooking', label: 'Μαγείρεμα', type: 'select', options: ['Μαγειρεύω καθημερινά', 'Λίγος χρόνος (< 20΄)', 'Σχεδόν δεν μαγειρεύω', 'Meal prep 1-2 φορές/εβδομάδα'] },
    { k: 'budget', label: 'Budget διατροφής', type: 'select', options: ['Οικονομικό', 'Μέτριο', 'Χωρίς περιορισμό'] },
    { k: 'water', label: 'Νερό ημερησίως', type: 'select', options: ['< 1 lt', '1-2 lt', '2+ lt'] },
    { k: 'habits', label: 'Συνήθειες', type: 'multi', options: ['Καπνίζω', 'Αλκοόλ συχνά', 'Πολλά γλυκά', 'Πολύ καφέ', 'Fast food', 'Παραλείπω γεύματα', 'Βραδινό αργά'] },
  ] },
  { title: 'Ζωή & στόχοι', fields: [
    { k: 'sleep_h', label: 'Ύπνος (ώρες/βράδυ)', type: 'select', options: ['< 5', '5-6', '6-7', '7-8', '8+'] },
    { k: 'stress', label: 'Επίπεδο στρες (1 = χαμηλό, 5 = πολύ)', type: 'range' },
    { k: 'wish', label: 'Τι θέλεις να πετύχεις; Με δικά σου λόγια', type: 'textarea', ph: 'π.χ. να χάσω την κοιλιά, να νιώθω ενεργητικός, να τρέξω 5 χλμ…' },
  ] },
];

function renderField(f, data) {
  const val = data[f.k];
  let input;
  if (f.type === 'select') {
    input = h('select', { id: f.k, onchange: e => data[f.k] = e.target.value },
      h('option', { value: '' }, '— επίλεξε —'),
      f.options.map(o => h('option', { value: o, selected: o === val }, o)));
  } else if (f.type === 'textarea') {
    input = h('textarea', { id: f.k, placeholder: f.ph || '', oninput: e => data[f.k] = e.target.value }, val || '');
  } else if (f.type === 'multi') {
    const cur = new Set(val || []);
    input = h('div', { class: 'chips' }, f.options.map(o => h('label', { class: 'chip' },
      h('input', { type: 'checkbox', checked: cur.has(o), onchange: e => { e.target.checked ? cur.add(o) : cur.delete(o); data[f.k] = [...cur]; } }), o)));
  } else if (f.type === 'range') {
    const out = h('strong', {}, String(val ?? 3));
    if (val == null) data[f.k] = 3;
    input = h('div', { class: 'row' }, h('input', { type: 'range', id: f.k, min: 1, max: 5, value: val ?? 3, oninput: e => { data[f.k] = +e.target.value; out.textContent = e.target.value; } }), out);
  } else {
    input = h('input', { id: f.k, type: f.type, placeholder: f.ph || '', min: f.min, max: f.max, step: f.step, value: val ?? '', oninput: e => data[f.k] = f.type === 'number' && e.target.value !== '' ? +e.target.value : e.target.value });
  }
  return h('div', { class: 'field' }, h('label', { for: f.k }, f.label + (f.req ? ' *' : '')), input);
}

export async function runAssessment(btn) {
  return withLoading(btn, async () => {
    const r = await geminiJSON({ system: SYSTEM, contents: [textPart(ASSESS_PROMPT())], temperature: 0.5 });
    state.assessment = r.assessment || null;
    state.goals = (r.goals || []).map((g, i) => ({ ...g, id: g.id || 'g' + (i + 1) }));
    state.selectedGoals = [];
    save();
    location.hash = '#/goals';
  });
}

export function onboarding(root) {
  const data = { ...(state.profile || {}) };
  let step = 0;
  const draw = () => {
    const S = STEPS[step];
    const last = step === STEPS.length - 1;
    mount(root, 
      h('h1', {}, 'Γνωριμία'),
      h('p', { class: 'sub' }, 'Όσο πιο ειλικρινείς οι απαντήσεις, τόσο πιο σωστό το πρόγραμμα. Μπορείς να τα αλλάξεις αργότερα.'),
      h('div', { class: 'steps' }, STEPS.map((_, i) => h('i', { class: i <= step ? 'on' : '' }))),
      h('div', { class: 'card' },
        h('h2', {}, `${step + 1}/${STEPS.length} · ${S.title}`),
        S.fields.map(f => renderField(f, data)),
        h('div', { class: 'row between' },
          h('button', { disabled: step === 0, onclick: () => { step--; draw(); } }, '← Πίσω'),
          h('button', { class: 'primary', id: 'next', onclick: async e => {
            const miss = S.fields.find(f => f.req && (data[f.k] === '' || data[f.k] == null));
            if (miss) return toast(`Συμπλήρωσε: ${miss.label}`, 'error');
            if (!last) { step++; draw(); window.scrollTo(0, 0); return; }
            state.profile = { ...data, updated: new Date().toISOString().slice(0, 10) };
            if (!state.logs.weights.length && data.weight_kg) state.logs.weights.push({ date: state.profile.updated, kg: data.weight_kg });
            save();
            if (!state.settings.geminiKey) { toast('Το προφίλ αποθηκεύτηκε. Πρόσθεσε Gemini key για να συνεχίσεις.', 'success'); location.hash = '#/settings'; return; }
            await runAssessment(e.target);
          } }, last ? '✨ Ανάλυση από τον AI coach' : 'Επόμενο →'))));
  };
  draw();
}

export function goalsView(root) {
  const a = state.assessment;
  if (!a && !state.goals.length) {
    mount(root, h('div', { class: 'card empty' }, h('div', { class: 'ico' }, '🎯'), h('p', {}, 'Δεν υπάρχουν ακόμη στόχοι. Συμπλήρωσε πρώτα το προφίλ σου.'), h('a', { class: 'btn primary', href: '#/onboarding' }, 'Ξεκίνα')));
    return;
  }
  const sel = new Set(state.selectedGoals);
  mount(root, 
    h('h1', {}, 'Εκτίμηση & στόχοι'),
    a && h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('h2', {}, 'Η εκτίμηση του coach'), a.starting_point && h('span', { class: 'tag ok' }, a.starting_point)),
      a.bmi && h('p', {}, h('strong', {}, 'BMI: '), String(a.bmi)),
      h('p', {}, a.summary),
      h('div', { class: 'grid c2' },
        h('div', {}, h('h3', {}, '💪 Δυνατά σημεία'), h('ul', {}, (a.strengths || []).map(s => h('li', {}, s)))),
        h('div', {}, h('h3', {}, '⚠️ Προσοχή'), h('ul', {}, (a.risks || []).map(s => h('li', {}, s)))))),
    h('h2', {}, 'Προτεινόμενοι στόχοι — διάλεξε όσους σε εκφράζουν'),
    state.goals.map(g => h('label', { class: 'card', style: 'display:block;cursor:pointer' },
      h('div', { class: 'row' },
        h('input', { type: 'checkbox', style: 'width:20px;height:20px', checked: sel.has(g.id), onchange: e => { e.target.checked ? sel.add(g.id) : sel.delete(g.id); } }),
        h('div', {}, h('h3', {}, g.title), h('div', { class: 'muted' }, g.why), h('div', { class: 'row', style: 'margin-top:6px' }, g.target && h('span', { class: 'tag' }, '🎯 ' + g.target), g.timeframe && h('span', { class: 'tag' }, '⏱ ' + g.timeframe)))))),
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => { if (!sel.size) return toast('Διάλεξε τουλάχιστον έναν στόχο', 'error'); state.selectedGoals = [...sel]; save(); location.hash = '#/workout'; } }, 'Συνέχεια → Φτιάξε πρόγραμμα'),
      h('button', { onclick: e => runAssessment(e.target) }, '🔄 Νέες προτάσεις')));
}
