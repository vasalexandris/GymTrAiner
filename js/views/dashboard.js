import { h , mount} from '../ui.js';
import { state } from '../store.js';

export function dashboardView(root) {
  const s = state, p = s.profile;
  const steps = [
    ['Γνωριμία', !!p, '#/onboarding', 'Συμπλήρωσε το προφίλ σου'],
    ['Στόχοι', s.selectedGoals.length > 0, '#/goals', 'Διάλεξε στόχους'],
    ['Γυμναστική', !!s.plan, '#/workout', 'Φτιάξε πρόγραμμα'],
    ['Διατροφή', !!s.meal, '#/nutrition', 'Φτιάξε πρόγραμμα διατροφής'],
  ];
  const next = steps.find(x => !x[1]);
  const week = s.logs.workouts.filter(w => Date.now() - new Date(w.date) < 7 * 864e5).length;
  const w = s.logs.weights.at(-1);
  mount(root, 
    h('h1', {}, p?.name ? `Γεια σου, ${p.name}! 👋` : 'Καλώς ήρθες στο GymTrAIner 👋'),
    h('p', { class: 'sub' }, 'Ο προσωπικός σου γυμναστής, διατροφολόγος και coach — με τεχνητή νοημοσύνη.'),
    !s.settings.geminiKey && h('div', { class: 'banner' }, '🔑 Για να ξεκινήσεις χρειάζεται το Gemini API key σου. ', h('a', { href: '#/settings' }, 'Πήγαινε στις Ρυθμίσεις →')),
    h('div', { class: 'card' }, h('h2', {}, 'Η διαδρομή σου'),
      h('div', { class: 'steps' }, steps.map(x => h('i', { class: x[1] ? 'on' : '' }))),
      h('div', { class: 'row' }, steps.map(x => h('span', { class: 'tag ' + (x[1] ? 'ok' : '') }, (x[1] ? '✔ ' : '○ ') + x[0]))),
      next && h('p', {}, h('a', { class: 'btn primary', href: next[2] }, next[3] + ' →'))),
    h('div', { class: 'grid c3' },
      h('div', { class: 'card stat' }, h('div', { class: 'big' }, week), h('div', { class: 'muted' }, 'προπονήσεις την τελευταία εβδομάδα')),
      h('div', { class: 'card stat' }, h('div', { class: 'big' }, w ? w.kg : '—'), h('div', { class: 'muted' }, 'τρέχον βάρος (kg)')),
      h('div', { class: 'card stat' }, h('div', { class: 'big' }, s.meal?.daily_calories || '—'), h('div', { class: 'muted' }, 'kcal/ημέρα στόχος'))),
    s.plan && h('div', { class: 'card' }, h('h2', {}, 'Σήμερα'), (() => {
      const t = new Date().toLocaleDateString('el-GR', { weekday: 'long' }).toLowerCase().slice(0, 4);
      const d = s.plan.days.find(x => x.day.toLowerCase().startsWith(t));
      return d ? h('div', {}, h('p', {}, h('strong', {}, d.day + ': '), d.rest ? 'Ημέρα ανάπαυσης 😴' : d.focus), !d.rest && h('a', { class: 'btn primary', href: '#/workout' }, 'Δες την προπόνηση →')) : h('p', { class: 'muted' }, '—');
    })()),
    h('div', { class: 'banner small' }, '⚕️ Το GymTrAIner δεν αποτελεί ιατρική συμβουλή. Αν έχεις πρόβλημα υγείας ή τραυματισμό, συμβουλέψου γιατρό πριν ξεκινήσεις.'));
}
