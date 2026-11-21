import { h, toast } from './ui.js';
import { state, save } from './store.js';

// label (εμφάνιση) → όρος αναζήτησης στο YouTube
export const GENRES = {
  'Pop': 'pop workout hits', 'Rock': 'rock workout', 'Hip-Hop / Rap': 'hip hop workout', 'Electronic / EDM': 'EDM workout',
  'House / Techno': 'house techno workout', 'Ελληνική ποπ': 'ελληνικά ποπ workout', 'Ελληνικά λαϊκά': 'ελληνικά λαϊκά γυμναστική',
  'Έντεχνο / Ελληνικό ροκ': 'ελληνικό ροκ workout', 'Latin / Reggaeton': 'reggaeton latin workout', 'Metal': 'metal workout',
  'R&B / Soul': 'rnb workout', 'Funk / Disco': 'funk disco workout', 'Indie / Alternative': 'indie alternative workout', 'Κλασική / Soundtracks': 'epic orchestral workout',
  'Χωρίς μουσική': null,
};
export const GENRE_OPTIONS = Object.keys(GENRES);

/** Επιστρέφει {label, query} ή null αν ο χρήστης δεν θέλει μουσική. Εναλλάσσει τα είδη ανά άσκηση. */
export function musicQuery(ex, idx = 0) {
  const sel = state.profile?.music_genres || [];
  if (sel.includes('Χωρίς μουσική') && sel.length === 1) return null;
  const genres = sel.filter(g => GENRES[g]);
  const bpm = ex.music?.bpm;
  if (!genres.length) return ex.music?.search_query ? { label: `${ex.music.style || ''}${bpm ? ` · ~${bpm} BPM` : ''}`, query: ex.music.search_query } : null;
  const g = genres[idx % genres.length];
  const artists = state.profile?.music_artists;
  return { label: `${g}${bpm ? ` · ~${bpm} BPM` : ''}`, query: [GENRES[g], bpm ? `${bpm} bpm` : '', idx % genres.length === 0 && artists ? artists : ''].filter(Boolean).join(' ') };
}

/** Κάρτα για αλλαγή προτιμήσεων μουσικής οποιαδήποτε στιγμή. */
export function musicPrefsCard(onSaved) {
  if (!state.profile) return null;
  const sel = new Set(state.profile.music_genres || []);
  const artists = h('input', { type: 'text', value: state.profile.music_artists || '', placeholder: 'Αγαπημένοι καλλιτέχνες (προαιρετικό), π.χ. Queen, Σακελλαρίδης' });
  return h('details', { class: 'card' },
    h('summary', { style: 'cursor:pointer;font-weight:700' }, '🎵 Τι μουσική σου αρέσει στη γυμναστική;' + (sel.size ? ` (${[...sel].slice(0, 3).join(', ')}${sel.size > 3 ? '…' : ''})` : '')),
    h('div', { class: 'chips', style: 'margin:12px 0' }, GENRE_OPTIONS.map(o => h('label', { class: 'chip' },
      h('input', { type: 'checkbox', checked: sel.has(o), onchange: e => { e.target.checked ? sel.add(o) : sel.delete(o); } }), o))),
    h('div', { class: 'field' }, artists),
    h('button', { class: 'primary', onclick: () => { state.profile.music_genres = [...sel]; state.profile.music_artists = artists.value.trim(); save(); toast('Οι προτιμήσεις μουσικής αποθηκεύτηκαν', 'success'); onSaved?.(); } }, 'Αποθήκευση'),
    h('p', { class: 'hint' }, 'Εφαρμόζεται άμεσα στα κουμπιά μουσικής κάθε άσκησης και στα επόμενα προγράμματα.'));
}
