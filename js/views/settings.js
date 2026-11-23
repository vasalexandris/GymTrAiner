import { h, toast, download , mount} from '../ui.js';
import { state, save, exportData, importData, resetAll } from '../store.js';
import { gemini, textPart, listModels } from '../api.js';
import { getCustomModel, saveCustomModel, deleteCustomModel } from '../modelstore.js';
import { LOOKS } from '../avatar.js';
import { loadLibrary, libraryStats, exportLibrary } from '../videolib.js';

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
    libraryCard(),
    coachCard(),
    h('div', { class: 'card' }, h('h2', {}, 'Τα δεδομένα μου'),
      h('p', { class: 'muted' }, 'Όλα τα δεδομένα (προφίλ, προγράμματα, πρόοδος, εξετάσεις) μένουν στον browser. Κάνε εξαγωγή για αντίγραφο ή για μεταφορά σε άλλη συσκευή (τα keys δεν περιλαμβάνονται).'),
      h('div', { class: 'row' },
        h('button', { onclick: () => download('gymtrainer-backup.json', exportData()) }, '⬇ Εξαγωγή'),
        h('label', { class: 'btn', style: 'margin:0;cursor:pointer;font-weight:400' }, '⬆ Εισαγωγή', h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: async e => { try { importData(await e.target.files[0].text()); toast('Έγινε εισαγωγή', 'success'); location.hash = '#/'; } catch (err) { toast(err.message, 'error'); } } })),
        h('button', { class: 'danger', onclick: () => { S.geminiKey = ''; S.ytKey = ''; save(); settingsView(root); toast('Τα keys διαγράφηκαν'); } }, 'Διαγραφή keys'),
        h('button', { class: 'danger', onclick: () => { if (confirm('Θα διαγραφούν ΟΛΑ τα δεδομένα σου. Συνέχεια;')) { resetAll(); location.hash = '#/'; } } }, 'Διαγραφή όλων'))));
}

function coachCard() {
  const info = h('p', { class: 'small muted' }, 'Έλεγχος…');
  const refresh = () => getCustomModel().then(m => { info.textContent = m ? `✅ Έχεις ανεβάσει: ${m.name} (${(m.buf.byteLength / 1048576).toFixed(1)} MB, ${m.date}). Διάλεξέ το στην προπόνηση: «Coach: Δικό μου μοντέλο».` : 'Δεν έχεις ανεβάσει δικό σου μοντέλο.'; });
  const input = h('input', { type: 'file', accept: '.glb,model/gltf-binary', onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 60 * 1048576) return toast('Πολύ μεγάλο αρχείο (όριο 60MB)', 'error');
    info.textContent = '⏳ Έλεγχος μοντέλου…';
    try {
      const buf = await f.arrayBuffer();
      const { loadCoachModel } = await import('../skinned.js');
      await loadCoachModel(buf.slice(0)); // επαληθεύει ότι έχει σκελετό τύπου Mixamo
      await saveCustomModel(buf, f.name);
      const C = (state.settings.coach ||= {}); C.look = 'custom'; save();
      toast('Το μοντέλο αποθηκεύτηκε και επιλέχθηκε!', 'success');
    } catch (err) { toast('Μη συμβατό μοντέλο: ' + err.message, 'error'); }
    e.target.value = ''; refresh();
  } });
  refresh();
  return h('div', { class: 'card' }, h('h2', {}, '🧍 3D Coach'),
    h('p', {}, 'Ο coach είναι ρεαλιστικό 3D μοντέλο με σκελετό. Μπορείς να βάλεις ', h('strong', {}, 'το δικό σου μοντέλο'), ' — π.χ. έναν φωτορεαλιστικό χαρακτήρα από το Mixamo.'),
    h('ol', { class: 'small' },
      h('li', {}, 'Στο mixamo.com (δωρεάν λογαριασμός Adobe) διάλεξε χαρακτήρα και κάνε Download σε μορφή FBX, «T-Pose», χωρίς animation.'),
      h('li', {}, 'Μετάτρεψέ το σε .glb (π.χ. Blender: Import FBX → Export glTF Binary).'),
      h('li', {}, 'Ανέβασέ το εδώ. Μένει μόνο στον browser σου.')),
    h('div', { class: 'grid c2', style: 'margin-bottom:12px' },
      h('div', { class: 'field' }, h('label', {}, 'Ποιότητα γραφικών'), h('select', { onchange: e => { (state.settings.coach ||= {}).quality = e.target.value || undefined; save(); } },
        [['', 'Αυτόματη (υψηλή σε PC, κανονική σε κινητό)'], ['high', 'Υψηλή (σκιές επαφής/ambient occlusion)'], ['normal', 'Κανονική (πιο γρήγορη)']].map(([v, l]) => h('option', { value: v, selected: (state.settings.coach?.quality || '') === v }, l)))),
      h('div', { class: 'field' }, h('label', {}, 'Περιβάλλον'), h('select', { onchange: e => { (state.settings.coach ||= {}).env = e.target.value; save(); } },
        [['studio', 'Φωτογραφικό στούντιο'], ['home', 'Σπίτι (ξύλινο πάτωμα)']].map(([v, l]) => h('option', { value: v, selected: (state.settings.coach?.env || 'studio') === v }, l)))),
      h('div', { class: 'field' }, h('label', {}, 'Ποιος/ποια coach;'), h('select', { onchange: e => { const C = (state.settings.coach ||= {}); C.look = e.target.value; C.lookV2 = true; C.view = '3d'; save(); toast('Ο coach άλλαξε', 'success'); } },
        Object.entries(LOOKS).filter(([k, l]) => l.model).map(([k, l]) => h('option', { value: k, selected: (state.settings.coach?.look || 'real') === k }, `${l.gender === 'm' ? '🧔' : '👩'} ${l.name}`)))),
      h('div', { class: 'field' }, h('label', {}, 'Κόμμωση (μόνο για τη Μισέλ)'), h('select', { onchange: e => { (state.settings.coach ||= {}).hair = e.target.value; save(); } },
        [['original', 'Αρχική'], ['ponytail', 'Αλογοουρά'], ['bun', 'Κότσος'], ['braid', 'Πλεξούδα'], ['short', 'Κοντά']].map(([v, l]) => h('option', { value: v, selected: (state.settings.coach?.hair || 'original') === v }, l))))),
    h('div', { class: 'row' }, h('label', { class: 'btn', style: 'margin:0;cursor:pointer;font-weight:400' }, '⬆ Ανέβασμα .glb', h('span', { hidden: true }, input)),
      h('button', { class: 'danger', onclick: async () => { await deleteCustomModel(); const C = state.settings.coach; if (C?.look === 'custom') { C.look = 'real'; save(); } toast('Διαγράφηκε'); refresh(); } }, 'Διαγραφή μοντέλου')),
    info);
}

function libraryCard() {
  const info = h('p', { class: 'small muted' }, '…');
  loadLibrary().then(() => { const st = libraryStats(); info.textContent = `Κοινή βιβλιοθήκη εφαρμογής: ${st.shared} ασκήσεις · Βρέθηκαν/ορίστηκαν στη συσκευή σου: ${st.local} (μαζί με συνώνυμα).`; });
  return h('div', { class: 'card' }, h('h2', {}, '🎬 Βιβλιοθήκη βίντεο'),
    h('p', {}, 'Κάθε βίντεο επίδειξης και το σημείο της επανάληψης βρίσκονται ', h('strong', {}, 'μία φορά'), '. Όσα είναι στην κοινή βιβλιοθήκη της εφαρμογής χρησιμοποιούνται από όλους τους χρήστες ', h('strong', {}, 'χωρίς κλήσεις API'), '.'),
    info,
    h('div', { class: 'row' }, h('button', { onclick: () => download('video-library.json', exportLibrary()) }, '⬇ Εξαγωγή βιβλιοθήκης (για το repo)')),
    h('p', { class: 'hint' }, 'Μετά τις δοκιμές σου, κάνε εξαγωγή και αντικατέστησε το data/video-library.json στο repo — από εκεί και πέρα όλοι οι χρήστες τα παίρνουν έτοιμα.'));
}
