import { state, save } from './store.js';

const GEM = 'https://generativelanguage.googleapis.com/v1beta/models/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function parseJSON(text) {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(clean); }
  catch {
    const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(clean.slice(a, b + 1));
    throw new Error('Η απάντηση του AI δεν ήταν έγκυρο JSON. Δοκίμασε ξανά.');
  }
}

export async function gemini({ system, contents, json = false, temperature = 0.7, maxTokens = 16384 }) {
  const key = state.settings.geminiKey;
  if (!key) throw new Error('Λείπει το Gemini API key — πρόσθεσέ το στις Ρυθμίσεις.');
  const body = { contents, generationConfig: { temperature, maxOutputTokens: maxTokens } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (json) body.generationConfig.responseMimeType = 'application/json';

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${GEM}${encodeURIComponent(state.settings.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts || []).map(p => p.text || '').join('');
      if (!text) throw new Error('Κενή απάντηση από το AI' + (cand?.finishReason ? ` (${cand.finishReason})` : data.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason})` : ''));
      return text;
    }
    lastErr = new Error(data?.error?.message || `Σφάλμα HTTP ${r.status}`);
    if (![429, 500, 503].includes(r.status)) break;
    await sleep(1500 * (attempt + 1));
  }
  throw lastErr;
}

export const geminiJSON = async opts => parseJSON(await gemini({ ...opts, json: true }));
export const textPart = text => ({ role: 'user', parts: [{ text }] });

// ---- YouTube ----
export const ytSearchUrl = q => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);

/** Επιστρέφει [{id,title,channel,thumb}] ή null αν δεν υπάρχει key. Cache για εξοικονόμηση quota (100 units/search). */
export async function ytSearch(query, { max = 3, music = false } = {}) {
  const key = state.settings.ytKey;
  if (!key) return null;
  const ck = (music ? 'm:' : 'v:') + query.toLowerCase();
  if (state.ytCache[ck]) return state.ytCache[ck];
  const p = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: String(max), q: query, videoEmbeddable: 'true', safeSearch: 'strict', key });
  if (music) p.set('videoCategoryId', '10');
  const r = await fetch('https://www.googleapis.com/youtube/v3/search?' + p);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('YouTube: ' + (data?.error?.message || r.status));
  const items = (data.items || []).map(i => ({
    id: i.id.videoId, title: i.snippet.title, channel: i.snippet.channelTitle,
    thumb: i.snippet.thumbnails?.medium?.url,
  }));
  state.ytCache[ck] = items;
  save();
  return items;
}
