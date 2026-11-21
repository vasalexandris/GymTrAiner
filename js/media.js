import { h, toast , mount} from './ui.js';
import { ytSearch, ytSearchUrl } from './api.js';
import { state } from './store.js';
import { musicQuery } from './music.js';

function results(items, box) {
  mount(box, );
  if (!items.length) { box.append(h('p', { class: 'muted small' }, 'Δεν βρέθηκαν αποτελέσματα.')); return; }
  const player = h('div');
  const grid = h('div', { class: 'vids' }, items.map(v =>
    h('button', {
      class: 'vid', title: v.title, onclick: () => mount(player, h('iframe', {
        class: 'player', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?rel=0&autoplay=1`,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, title: v.title,
      })),
    }, h('img', { src: v.thumb, alt: '', loading: 'lazy' }), h('span', {}, v.title))));
  box.append(grid, player);
}

/** Κουμπί που φορτώνει βίντεο YouTube (ή ανοίγει αναζήτηση αν δεν υπάρχει key). */
export function mediaButton(label, query, { music = false } = {}) {
  const box = h('div');
  const btn = h('button', { class: 'ghost', type: 'button' }, label);
  btn.addEventListener('click', async () => {
    if (!state.settings.ytKey) { window.open(ytSearchUrl(query), '_blank', 'noopener'); return; }
    btn.disabled = true;
    try { results(await ytSearch(query, { music }), box); }
    catch (e) { toast(e.message, 'error'); window.open(ytSearchUrl(query), '_blank', 'noopener'); }
    finally { btn.disabled = false; }
  });
  return h('div', {}, btn, box);
}

export const videoBlock = ex => ex.youtube_query ? mediaButton('▶ Δες σωστή εκτέλεση', ex.youtube_query) : null;
export function musicBlock(ex, idx = 0) {
  const m = musicQuery(ex, idx);
  return m ? h('div', {}, h('div', { class: 'small muted' }, `🎵 ${m.label}`), mediaButton('🎧 Μουσική για αυτή την άσκηση', m.query, { music: true })) : null;
}
