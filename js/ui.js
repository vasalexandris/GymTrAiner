// Μικρά βοηθητικά UI. Όλο το περιεχόμενο AI περνά από textContent (ασφάλεια από XSS).
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

function inline(text) {
  const frag = document.createDocumentFragment();
  text.split(/(\*\*[^*]+\*\*)/g).forEach(part => {
    if (/^\*\*[^*]+\*\*$/.test(part)) frag.append(h('strong', {}, part.slice(2, -2)));
    else if (part) frag.append(part);
  });
  return frag;
}

// Ελάχιστο, ασφαλές markdown: ##, -, 1., **bold**, παράγραφοι
export function md(text) {
  const root = h('div', { class: 'md' });
  let list = null;
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    let m;
    if (!t) { list = null; continue; }
    if ((m = t.match(/^#{1,4}\s+(.*)/))) { list = null; root.append(h('h4', {}, inline(m[1]))); continue; }
    if ((m = t.match(/^([-*•]|\d+[.)])\s+(.*)/))) {
      const ordered = /\d/.test(m[1]);
      if (!list || list.tagName !== (ordered ? 'OL' : 'UL')) { list = h(ordered ? 'ol' : 'ul'); root.append(list); }
      list.append(h('li', {}, inline(m[2])));
      continue;
    }
    list = null;
    root.append(h('p', {}, inline(t)));
  }
  return root;
}

export function toast(msg, type = 'info') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast ' + type }, msg);
  box.append(t);
  setTimeout(() => t.remove(), type === 'error' ? 7000 : 3500);
}

export const spinner = (label = 'Ο προπονητής σκέφτεται…') =>
  h('div', { class: 'loading' }, h('div', { class: 'spin' }), h('span', {}, label));

// Εκτελεί async ενέργεια με spinner πάνω στο κουμπί/container
export async function withLoading(btn, fn) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Περίμενε…';
  try { return await fn(); }
  catch (e) { console.error(e); toast(e.message || String(e), 'error'); }
  finally { btn.disabled = false; btn.textContent = old; }
}

export function download(filename, text, mime = 'application/json') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: mime })), download: filename });
  document.body.append(a); a.click(); a.remove();
}

export const fmtDate = d => new Date(d).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' });

/** replaceChildren που δέχεται nested arrays και αγνοεί false/null */
export function mount(parent, ...children) {
  parent.replaceChildren(...children.flat(Infinity).filter(c => c != null && c !== false));
  return parent;
}
