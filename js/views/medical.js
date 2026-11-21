import { h, withLoading, toast , mount} from '../ui.js';
import { state, save, today, uid } from '../store.js';
import { geminiJSON } from '../api.js';
import { SYSTEM, MEDICAL_PROMPT } from '../prompts.js';
import { generateBoth } from '../generate.js';

const MAX = 12 * 1024 * 1024;
const b64 = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
const STATUS = { normal: ['φυσιολογικό', 'ok'], low: ['χαμηλό', 'warn'], high: ['υψηλό', 'bad'], unknown: ['—', ''] };

export function medicalView(root) {
  let file = null, text = '';
  const analyze = h('button', { class: 'primary' }, '🔬 Ανάλυση εξέτασης');
  analyze.addEventListener('click', () => withLoading(analyze, async () => {
    if (!file && !text.trim()) return toast('Ανέβασε αρχείο ή επικόλλησε κείμενο', 'error');
    const parts = [{ text: MEDICAL_PROMPT + '\n\n## Προφίλ χρήστη (για συμφραζόμενα)\n' + JSON.stringify({ age: state.profile?.age, sex: state.profile?.sex, conditions: state.profile?.conditions }) }];
    if (text.trim()) parts.push({ text: 'Κείμενο εξετάσεων:\n' + text });
    if (file) parts.push({ inline_data: { mime_type: file.type || 'application/pdf', data: await b64(file) } });
    const analysis = await geminiJSON({ system: SYSTEM, contents: [{ role: 'user', parts }], temperature: 0.2 });
    state.medical.push({ id: uid(), date: today(), name: file?.name || analysis.exam_type || 'Εξέταση', analysis }); save();
    toast('Η εξέταση αναλύθηκε και θα λαμβάνεται υπόψη', 'success');
    medicalView(root);
  }));
  const apply = h('button', {}, '🔁 Εφάρμοσε τα ευρήματα στα προγράμματα');
  apply.addEventListener('click', async () => {
    const extra = 'Ελήφθησαν υπόψη νέα ιατρικά ευρήματα (δες ενότητα Ιατρικές εξετάσεις). Προσάρμοσε ένταση/ασκήσεις/διατροφή αναλόγως.';
    await generateBoth(apply, extra);
  });
  mount(root, 
    h('h1', {}, 'Ιατρικές εξετάσεις'),
    h('div', { class: 'banner' }, '⚕️ Η ανάλυση είναι ενημερωτική και ', h('strong', {}, 'δεν αντικαθιστά τον γιατρό'), '. Το αρχείο στέλνεται στο Gemini API για επεξεργασία· δεν αποθηκεύεται — κρατάμε μόνο την περίληψη στον browser σου.'),
    h('div', { class: 'card' },
      h('div', { class: 'field' }, h('label', {}, 'Αρχείο (PDF ή φωτογραφία, έως 12MB)'), h('input', { type: 'file', accept: 'application/pdf,image/*', onchange: e => { const f = e.target.files[0]; if (f && f.size > MAX) { toast('Το αρχείο είναι πολύ μεγάλο', 'error'); e.target.value = ''; file = null; } else file = f || null; } })),
      h('div', { class: 'field' }, h('label', {}, '…ή επικόλλησε τα αποτελέσματα ως κείμενο'), h('textarea', { oninput: e => text = e.target.value, placeholder: 'π.χ. Χοληστερόλη ολική: 215 mg/dl (< 200) …' })),
      analyze),
    state.medical.length > 0 && h('div', { class: 'row' }, apply),
    state.medical.slice().reverse().map(m => h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('h2', {}, `${m.analysis.exam_type || m.name}`), h('div', { class: 'row' }, h('span', { class: 'tag' }, m.date),
        h('button', { class: 'danger ghost', onclick: () => { if (confirm('Διαγραφή εξέτασης;')) { state.medical = state.medical.filter(x => x.id !== m.id); save(); medicalView(root); } } }, '🗑'))),
      h('p', {}, m.analysis.summary),
      m.analysis.markers?.length > 0 && h('div', { style: 'overflow-x:auto' }, h('table', {}, h('tr', {}, ['Δείκτης', 'Τιμή', 'Αναφορά', ''].map(t => h('th', {}, t))),
        m.analysis.markers.map(k => { const [lbl, cls] = STATUS[k.status] || STATUS.unknown; return h('tr', {}, h('td', {}, k.name), h('td', {}, `${k.value} ${k.unit || ''}`), h('td', { class: 'muted' }, k.reference || '–'), h('td', {}, h('span', { class: 'tag ' + cls }, lbl))); }))),
      m.analysis.training_implications && h('p', {}, h('strong', {}, '🏋️ Για την προπόνηση: '), m.analysis.training_implications),
      m.analysis.nutrition_implications && h('p', {}, h('strong', {}, '🥗 Για τη διατροφή: '), m.analysis.nutrition_implications),
      m.analysis.see_doctor && h('p', { class: 'banner' }, h('strong', {}, '👨‍⚕️ Συζήτησε με γιατρό: '), m.analysis.see_doctor))));
}
