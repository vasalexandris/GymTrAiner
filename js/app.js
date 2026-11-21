import { h , mount} from './ui.js';
import { onboarding, goalsView } from './views/onboarding.js';
import { dashboardView } from './views/dashboard.js';
import { workoutView } from './views/workout.js';
import { sessionView } from './views/session.js';
import { nutritionView } from './views/nutrition.js';
import { progressView } from './views/progress.js';
import { medicalView } from './views/medical.js';
import { coachView } from './views/coach.js';
import { settingsView } from './views/settings.js';

const routes = {
  '/': dashboardView, '/onboarding': onboarding, '/goals': goalsView, '/workout': workoutView, '/session': sessionView,
  '/nutrition': nutritionView, '/progress': progressView, '/medical': medicalView, '/coach': coachView, '/settings': settingsView,
};
const NAV = [['/', '🏠', 'Αρχική'], ['/workout', '🏋️', 'Γυμναστική'], ['/nutrition', '🥗', 'Διατροφή'], ['/progress', '📈', 'Πρόοδος'], ['/coach', '💬', 'Coach'], ['/medical', '🩺', 'Εξετάσεις'], ['/onboarding', '📝', 'Προφίλ'], ['/settings', '⚙️', 'Ρυθμίσεις']];

const nav = document.getElementById('nav'), view = document.getElementById('view');

function render() {
  const path = location.hash.slice(1) || '/';
  mount(nav, h('div', { class: 'logo' }, 'Gym', h('span', {}, 'TrAI'), 'ner'),
    ...NAV.map(([p, ic, label]) => h('a', { href: '#' + p, class: p === path ? 'active' : '' }, h('span', { class: 'ic' }, ic), label)));
  try { (routes[path] || dashboardView)(view); }
  catch (e) { console.error(e); mount(view, h('div', { class: 'card' }, h('h2', {}, 'Κάτι πήγε στραβά'), h('p', {}, e.message))); }
  window.scrollTo(0, 0);
}
addEventListener('hashchange', render);
render();
