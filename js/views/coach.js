import { h, md, toast , mount} from '../ui.js';
import { state, save } from '../store.js';
import { gemini } from '../api.js';
import { SYSTEM, contextText } from '../prompts.js';

const QUICK = ['Δεν έχω διάθεση σήμερα, τι κάνω;', 'Πονάει το γόνατό μου — τι αλλάζω;', 'Τι να φάω πριν και μετά την προπόνηση;', 'Πώς ξεπερνάω τη στασιμότητα στο βάρος;'];

export function coachView(root) {
  const log = h('div', { class: 'chat' });
  const draw = () => {
    mount(log, ...(state.chat.length ? state.chat.map(m => h('div', { class: 'msg ' + m.role }, m.role === 'model' ? md(m.text) : m.text))
      : [h('div', { class: 'msg model' }, 'Γεια! Είμαι ο προσωπικός σου coach. Ρώτα με ό,τι θέλεις για προπόνηση, διατροφή, κίνητρο ή αποκατάσταση. 💪')]));
    log.scrollTop = log.scrollHeight;
  };
  const input = h('textarea', { rows: 2, placeholder: 'Γράψε το μήνυμά σου… (Enter για αποστολή)', style: 'min-height:48px' });
  let busy = false;
  const send = async text => {
    text = text.trim(); if (!text || busy) return;
    busy = true; input.value = '';
    state.chat.push({ role: 'user', text }); draw();
    const wait = h('div', { class: 'msg model muted' }, '…'); log.append(wait);
    try {
      const contents = state.chat.slice(-20).map(m => ({ role: m.role, parts: [{ text: m.text }] }));
      const reply = await gemini({ system: SYSTEM + '\n\nΣυμφραζόμενα για τον χρήστη:\n' + contextText({ includePlans: true }), contents, temperature: 0.8, maxTokens: 4096 });
      state.chat.push({ role: 'model', text: reply });
    } catch (e) { toast(e.message, 'error'); state.chat.pop(); input.value = text; }
    save(); busy = false; draw();
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } });
  mount(root, 
    h('div', { class: 'row between' }, h('div', {}, h('h1', {}, 'Ο Coach σου'), h('p', { class: 'sub' }, 'Συμβουλές, κίνητρο και υποστήριξη — ξέρει το προφίλ και την πρόοδό σου.')),
      state.chat.length > 0 && h('button', { class: 'ghost', onclick: () => { if (confirm('Καθαρισμός συνομιλίας;')) { state.chat = []; save(); draw(); } } }, 'Καθαρισμός')),
    h('div', { class: 'card' }, log),
    h('div', { class: 'chips', style: 'margin-bottom:10px' }, QUICK.map(q => h('button', { class: 'chip', onclick: () => send(q) }, q))),
    h('div', { class: 'row', style: 'align-items:stretch;flex-wrap:nowrap' }, h('div', { style: 'flex:1' }, input), h('button', { class: 'primary', onclick: () => send(input.value) }, 'Στείλε')));
  draw();
}
