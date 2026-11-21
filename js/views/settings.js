import { h, toast, download , mount} from '../ui.js';
import { state, save, exportData, importData, resetAll } from '../store.js';
import { gemini, textPart, listModels } from '../api.js';

export function settingsView(root) {
  const S = state.settings;
  const status = h('span', { class: 'small muted' });
  mount(root, 
    h('h1', {}, 'Ρυθμίσεις'),
    h('div', { class: 'banner' }, '🔒 Τα API keys αποθηκεύονται ', h('strong', {}, 'μόνο στον browser σου'), ' (localStorage) και στέλνονται απευθείας στη Google. Δεν περνούν από κανέναν δικό μας server. Σε κοινόχρηστο υπολογιστή χρησιμοποίησε «Διαγραφή keys» μετά.'),
    h('div', { class: 'card' },
      h('div', { class: 'field' }, h('label', { for: 'gk' }, 'Gemini API key'), h('input', { id: 'gk', type: 'password', autocomplete: 'off', value: S.geminiKey, placeholder: 'AIza…' }),
        h('div', { class: 'hint' }, 'Δωρεάν από το Google AI Studio (aistudio.google.com/apikey). Πρόσθεσε περιορισμό «HTTP referrers» στο domain του GitHub Pages σου.')),
      h('div', { class: 'field' }, h('label', { for: 'yk' }, 'YouTube Data API key (προαιρετικό)'), h('input', { id: 'yk', type: 'password', autocomplete: 'off', value: S.ytKey, placeholder: 'AIza…' }),
        h('div', { class: 'hint' }, 'Χωρίς key, τα κουμπιά βίντεο/μουσικής ανοίγουν αναζήτηση στο YouTube. Με key, παίζουν μέσα στην εφαρμογή. (Quota: ~100 αναζητήσεις/ημέρα· τα αποτελέσματα αποθηκεύονται.)')),
      h('div', { class: 'field' }, h('label', { for: 'md' }, 'Μοντέλο Gemini'), h('input', { id: 'md', value: S.model, list: 'models' }),
        h('div', { class: 'hint' }, 'Τα «-latest» δείχνουν πάντα στο τρέχον μοντέλο. Αν εξαντληθεί το ημερήσιο όριο (δωρεάν πακέτο), δοκίμασε «flash-lite» — συνήθως έχει μεγαλύτερο όριο. Κάθε μοντέλο έχει δικό του όριο.'),
        h('button', { type: 'button', style: 'margin-top:6px', onclick: async e => {
          e.target.disabled = true;
          try {
            S.geminiKey = root.querySelector('#gk').value.trim();
            const names = await listModels();
            const dl = root.querySelector('#models'); dl.replaceChildren(...names.map(m => h('option', { value: m })));
            status.textContent = `Βρέθηκαν ${names.length} μοντέλα — πάτα στο πεδίο και διάλεξε (ή σβήσε το κείμενο για να τα δεις).`;
          } catch (err) { status.textContent = '❌ ' + err.message; }
          e.target.disabled = false;
        } }, '📋 Λίστα διαθέσιμων μοντέλων'),
        h('datalist', { id: 'models' }, ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-pro-latest'].map(m => h('option', { value: m })))),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => { S.geminiKey = root.querySelector('#gk').value.trim(); S.ytKey = root.querySelector('#yk').value.trim(); S.model = root.querySelector('#md').value.trim() || 'gemini-2.5-flash'; save(); toast('Αποθηκεύτηκε', 'success'); } }, 'Αποθήκευση'),
        h('button', { onclick: async () => {
          S.geminiKey = root.querySelector('#gk').value.trim(); S.model = root.querySelector('#md').value.trim() || S.model; save();
          status.textContent = 'Δοκιμή…';
          try { await gemini({ contents: [textPart('Απάντησε μόνο: OK')], maxTokens: 256, temperature: 0 }); status.textContent = '✅ Η σύνδεση λειτουργεί'; }
          catch (e) { status.textContent = '❌ ' + e.message; }
        } }, 'Δοκιμή σύνδεσης'), status)),
    h('div', { class: 'card' }, h('h2', {}, 'Τα δεδομένα μου'),
      h('p', { class: 'muted' }, 'Όλα τα δεδομένα (προφίλ, προγράμματα, πρόοδος, εξετάσεις) μένουν στον browser. Κάνε εξαγωγή για αντίγραφο ή για μεταφορά σε άλλη συσκευή (τα keys δεν περιλαμβάνονται).'),
      h('div', { class: 'row' },
        h('button', { onclick: () => download('gymtrainer-backup.json', exportData()) }, '⬇ Εξαγωγή'),
        h('label', { class: 'btn', style: 'margin:0;cursor:pointer;font-weight:400' }, '⬆ Εισαγωγή', h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: async e => { try { importData(await e.target.files[0].text()); toast('Έγινε εισαγωγή', 'success'); location.hash = '#/'; } catch (err) { toast(err.message, 'error'); } } })),
        h('button', { class: 'danger', onclick: () => { S.geminiKey = ''; S.ytKey = ''; save(); settingsView(root); toast('Τα keys διαγράφηκαν'); } }, 'Διαγραφή keys'),
        h('button', { class: 'danger', onclick: () => { if (confirm('Θα διαγραφούν ΟΛΑ τα δεδομένα σου. Συνέχεια;')) { resetAll(); location.hash = '#/'; } } }, 'Διαγραφή όλων'))));
}
