/* ===========================================================================
   My Secret Diary
   ---------------------------------------------------------------------------
   One script for every page. It reads <body data-page="..."> and runs only
   what that page needs, so the app works at any URL on any host.

   Writing is always local first. Nothing waits on the network.
   =========================================================================== */
'use strict';

/* ---------------------------------------------------------------------------
   1. Languages
   ------------------------------------------------------------------------ */

const LANGUAGES = [
  { code: 'en',  name: 'English',     label: 'English',           stop: '.', rtl: false, latin: true  },
  { code: 'urr', name: 'Roman Urdu',  label: 'Roman Urdu',        stop: '.', rtl: false, latin: true  },
  { code: 'ur',  name: 'Urdu',        label: 'اردو · Urdu',       stop: '۔', rtl: true,  latin: false },
  { code: 'hi',  name: 'Hindi',       label: 'हिन्दी · Hindi',     stop: '।', rtl: false, latin: false },
  { code: 'pa',  name: 'Punjabi',     label: 'پنجابی · Punjabi',  stop: '۔', rtl: true,  latin: false },
  { code: 'ar',  name: 'Arabic',      label: 'العربية · Arabic',  stop: '.', rtl: true,  latin: false },
  { code: 'fa',  name: 'Persian',     label: 'فارسی · Persian',   stop: '.', rtl: true,  latin: false },
  { code: 'tr',  name: 'Turkish',     label: 'Türkçe · Turkish',  stop: '.', rtl: false, latin: true  },
  { code: 'fr',  name: 'French',      label: 'Français · French', stop: '.', rtl: false, latin: true  },
  { code: 'es',  name: 'Spanish',     label: 'Español · Spanish', stop: '.', rtl: false, latin: true  },
  { code: 'de',  name: 'German',      label: 'Deutsch · German',  stop: '.', rtl: false, latin: true  },
  { code: 'id',  name: 'Indonesian',  label: 'Indonesia',         stop: '.', rtl: false, latin: true  }
];

function langByCode(code, fallback = 'en') {
  return LANGUAGES.find(item => item.code === code)
      || LANGUAGES.find(item => item.code === fallback);
}

/* Nastaliq and Naskh are large. They load the first time a language that
   needs them is picked, never on a plain English page load. */
const SCRIPT_FONTS = {
  ur: 'Noto+Nastaliq+Urdu:wght@400;600',
  pa: 'Noto+Nastaliq+Urdu:wght@400;600',
  ar: 'Noto+Naskh+Arabic:wght@400;600',
  fa: 'Noto+Naskh+Arabic:wght@400;600',
  hi: 'Noto+Sans+Devanagari:wght@400;600'
};
const loadedFonts = new Set();

function ensureFont(code) {
  const family = SCRIPT_FONTS[code];
  if (!family || loadedFonts.has(family)) return;
  loadedFonts.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  document.head.appendChild(link);
}

/* ---------------------------------------------------------------------------
   2. Configuration
   ------------------------------------------------------------------------ */

const CONFIG = {
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  defaultModel: 'openai/gpt-4o-mini',
  autosave: 700
};

const KEYS = {
  user:    'pd.user',
  pin:     'pd.pin',
  hue:     'pd.hue',
  tone:    'pd.tone',
  entries: 'pd.entries',
  apiKey:  'pd.apiKey',
  model:   'pd.model',
  from:    'pd.from',
  into:    'pd.into',
  seen:    'pd.seenTip',
  face:    'pd.face'
};

/* Twenty starting points around the colour wheel, plus a slider for anything
   in between. Every one of these is just a hue angle. */
const PRESETS = [
  348, 335, 320, 300, 282, 265, 248, 232, 214, 199,
  186, 172, 158, 140, 108, 74, 46, 32, 18, 6
];

/* ---------------------------------------------------------------------------
   3. Storage
   ------------------------------------------------------------------------ */

const Store = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      console.warn('Could not read', key, err);
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      toast('This device is out of storage space. Nothing was saved.', 'error');
      return false;
    }
  },
  remove(key) { try { localStorage.removeItem(key); } catch (err) { /* ignore */ } }
};

const Session = {
  get(k)    { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  remove(k) { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } }
};

const Entries = {
  _cache: null,

  /* Each account gets its own drawer, so two people sharing a laptop never
     see each other's writing. */
  key() {
    const id = (typeof Cloud !== 'undefined' && Cloud.user) ? Cloud.user.id : 'local';
    return `${KEYS.entries}.${id}`;
  },

  reset() { this._cache = null; },

  replaceAll(list) {
    this._cache = list;
    Store.write(this.key(), list);
  },

  all() {
    if (this._cache) return this._cache;
    const list = Store.read(this.key(), []);
    if (!Array.isArray(list)) return [];

    // Normalise on read, so one damaged record can never break a page.
    this._cache = list
      .filter(e => e && typeof e === 'object' && e.id)
      .map(e => ({
        id: e.id,
        createdAt: Number(e.createdAt) || Date.now(),
        updatedAt: Number(e.updatedAt) || Number(e.createdAt) || Date.now(),
        title: typeof e.title === 'string' ? e.title : '',
        text: typeof e.text === 'string' ? e.text : '',
        from: typeof e.from === 'string' ? e.from : 'urr',
        into: typeof e.into === 'string' ? e.into : (e.language || 'en'),
        locked: e.locked === true,
        face: typeof e.face === 'string' ? e.face : 'serif',
        history: Array.isArray(e.history) ? e.history : []
      }));

    return this._cache;
  },

  get(id) { return this.all().find(e => e.id === id) || null; },

  blank() {
    const now = Date.now();
    return {
      id: uid(), createdAt: now, updatedAt: now,
      title: '', text: '', locked: false,
      face: Store.read(KEYS.face, 'serif'),
      from: Store.read(KEYS.from, 'urr'),
      into: Store.read(KEYS.into, 'en'),
      history: []
    };
  },

  save(entry) {
    const list = this.all();
    const i = list.findIndex(item => item.id === entry.id);
    entry.updatedAt = Date.now();
    if (i >= 0) list[i] = entry; else list.push(entry);
    this._cache = list;
    if (typeof Cloud !== 'undefined') Cloud.queue(entry);
    return Store.write(this.key(), list);
  },

  remove(id) {
    this._cache = this.all().filter(e => e.id !== id);
    Store.write(this.key(), this._cache);
    if (typeof Cloud !== 'undefined') Cloud.remove(id);
  }
};

/* ---------------------------------------------------------------------------
   4. Helpers
   ------------------------------------------------------------------------ */

function uid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

async function hash(text) {
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let v = 5381;
  for (const c of text) v = ((v * 33) ^ c.charCodeAt(0)) >>> 0;
  return 'weak:' + v.toString(16);
}

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function debounce(fn, wait) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
}

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

const fmtDate = ts => new Date(ts).toLocaleDateString(undefined,
  { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtTime = ts => new Date(ts).toLocaleTimeString(undefined,
  { hour: 'numeric', minute: '2-digit' });

function dayLabel(ts) {
  const then = new Date(ts), today = new Date(), yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (then.toDateString() === today.toDateString()) return 'Today';
  if (then.toDateString() === yest.toDateString()) return 'Yesterday';
  return fmtDate(ts);
}

const SENTENCE_END = ['.', '!', '?', '\n', '\u06D4', '\u061F', '\u0964'];
const TRIGGERS = ['.', '\u06D4', '\u0964'];

function sentenceStart(text, caret) {
  for (let i = caret - 2; i >= 0; i--) if (SENTENCE_END.includes(text[i])) return i + 1;
  return 0;
}

/** Skips "3.14", "...", stray dots and single letters. */
function isSentence(text) {
  const t = text.trim();
  return t.length >= 3 && /\p{L}{2}/u.test(t);
}

const countWords = text => text.trim().split(/\s+/).filter(Boolean).length;

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = el('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}


/* ---------------------------------------------------------------------------
   4b. Rich text helpers
   ------------------------------------------------------------------------ */

/* The page is stored as HTML. It is the writer's own content, but it is
   re-inserted into the DOM on every load, so anything executable is stripped
   on the way in rather than trusted. */
const ALLOWED = new Set(['P','BR','DIV','SPAN','B','STRONG','I','EM','U','MARK',
  'H2','H3','UL','OL','LI','BLOCKQUOTE','TABLE','THEAD','TBODY','TR','TH','TD','HR']);

function cleanHtml(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html;

  holder.querySelectorAll('*').forEach(node => {
    if (!ALLOWED.has(node.tagName)) {
      node.replaceWith(...node.childNodes);      // keep the words, drop the tag
      return;
    }
    [...node.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'href' || name === 'src') {
        node.removeAttribute(attr.name);
      }
    });
  });

  return holder.innerHTML;
}

/** Older pages were saved as plain text with newlines. */
function toHtml(stored) {
  if (!stored) return '';
  if (/<[a-z][\s\S]*>/i.test(stored)) return cleanHtml(stored);
  return stored.split(/\n{2,}/)
    .map(part => `<p>${esc(part).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function plainText(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html || '';
  holder.querySelectorAll('p, div, li, tr, h2, h3, blockquote').forEach(n => n.append('\n'));
  return (holder.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---- Mapping between character offsets and DOM positions ------------------
   Sentence detection works on plain characters, but editing has to happen on
   DOM ranges. These convert between the two within a single block, which is
   what keeps bold, highlights and list items intact around a swap. */

function textNodesIn(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  return nodes;
}

/** The nearest block-level ancestor inside the editor. */
function blockOf(node, editor) {
  let current = node.nodeType === 3 ? node.parentNode : node;
  while (current && current !== editor) {
    if (/^(P|DIV|LI|H2|H3|BLOCKQUOTE|TD|TH)$/.test(current.tagName)) return current;
    current = current.parentNode;
  }
  return editor;
}

function offsetWithin(block, node, offset) {
  let total = 0;
  for (const text of textNodesIn(block)) {
    if (text === node) return total + offset;
    total += text.length;
  }
  return total;
}

function rangeWithin(block, start, end) {
  const range = document.createRange();
  let seen = 0, startSet = false;

  for (const text of textNodesIn(block)) {
    const next = seen + text.length;
    if (!startSet && start <= next) { range.setStart(text, start - seen); startSet = true; }
    if (startSet && end <= next) { range.setEnd(text, end - seen); return range; }
    seen = next;
  }
  return startSet ? range : null;
}

function caretTo(node, offset) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/* ---------------------------------------------------------------------------
   5. Toasts
   ------------------------------------------------------------------------ */

function toast(message, kind = 'info') {
  let host = $('.toasts');
  if (!host) {
    host = el('div', 'toasts');
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const node = el('div', 'toast', esc(message));
  node.dataset.kind = kind;
  host.appendChild(node);
  setTimeout(() => {
    node.dataset.kind = 'closing';
    setTimeout(() => node.remove(), 220);
  }, 3200);
}

/* ---------------------------------------------------------------------------
   6. Dialogs
   ------------------------------------------------------------------------ */

function dialog({ title, message = '', bodyHtml = '', fields = [],
                  confirmText = 'Confirm', cancelText = 'Cancel',
                  danger = false, showCancel = true }) {
  return new Promise(resolve => {
    const overlay = el('div', 'overlay');

    const fieldsHtml = fields.map(f => `
      <label class="field">
        <span class="field__label">${esc(f.label)}</span>
        <input class="input" type="${esc(f.type || 'text')}" name="${esc(f.name)}"
               value="${esc(f.value || '')}"
               ${f.maxlength ? `maxlength="${Number(f.maxlength)}"` : ''}
               ${f.inputmode ? `inputmode="${esc(f.inputmode)}"` : ''}
               placeholder="${esc(f.placeholder || '')}">
        ${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}
      </label>`).join('');

    overlay.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h2>${esc(title)}</h2>
        ${message ? `<p class="dialog__msg">${esc(message)}</p>` : ''}
        ${bodyHtml}
        ${fieldsHtml}
        <div class="dialog__row">
          ${showCancel ? `<button class="btn btn--quiet" data-act="cancel">${esc(cancelText)}</button>` : ''}
          <button class="btn ${danger ? 'btn--danger' : ''}" data-act="ok">${esc(confirmText)}</button>
        </div>
      </div>`;

    function close(result) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    }
    function submit() {
      const values = {};
      $$('input', overlay).forEach(i => { values[i.name] = i.value; });
      close(values);
    }
    function onKey(e) {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); }
    }

    overlay.addEventListener('click', e => {
      if (e.target === overlay) close(null);
      if (e.target.dataset.act === 'cancel') close(null);
      if (e.target.dataset.act === 'ok') submit();
    });

    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    ($('input', overlay) || $('[data-act="ok"]', overlay)).focus();
  });
}

const confirmDialog = (title, message, confirmText = 'Delete') =>
  dialog({ title, message, confirmText, danger: true }).then(r => r !== null);

/* ---------------------------------------------------------------------------
   7. PIN lock
   ------------------------------------------------------------------------ */

function lockScreen({ title, message, verify, dismissible = false }) {
  return new Promise(resolve => {
    let pin = '';
    const overlay = el('div', 'overlay');

    overlay.innerHTML = `
      <div class="dialog lock" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <svg class="lock__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" aria-hidden="true">
          <rect x="4" y="10" width="16" height="11" rx="2.5"/>
          <path d="M8 10V7a4 4 0 0 1 8 0v3"/>
        </svg>
        <h2>${esc(title)}</h2>
        <p class="dialog__msg">${esc(message)}</p>
        <div class="dots" aria-hidden="true">
          <span class="dot"></span><span class="dot"></span>
          <span class="dot"></span><span class="dot"></span>
        </div>
        <div class="keys">
          ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="key" data-k="${n}">${n}</button>`).join('')}
          <button class="key key--word" data-k="clear">Clear</button>
          <button class="key" data-k="0">0</button>
          <button class="key key--word" data-k="back">Back</button>
        </div>
        ${dismissible ? '<div class="dialog__row"><button class="btn btn--quiet" data-act="cancel">Cancel</button></div>' : ''}
      </div>`;

    const card = $('.dialog', overlay);
    const dots = $$('.dot', overlay);
    const paint = () => dots.forEach((d, i) => { d.dataset.on = String(i < pin.length); });

    function reject() {
      card.classList.add('shake');
      setTimeout(() => card.classList.remove('shake'), 400);
      pin = ''; paint();
    }
    function close(r) {
      document.removeEventListener('keydown', onKey);
      overlay.remove(); resolve(r);
    }
    async function press(v) {
      if (v === 'clear') { pin = ''; paint(); return; }
      if (v === 'back')  { pin = pin.slice(0, -1); paint(); return; }
      if (pin.length >= 4) return;
      pin += v; paint();
      if (pin.length === 4) {
        if (await verify(pin)) close(pin); else reject();
      }
    }
    function onKey(e) {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Escape' && dismissible) close(null);
    }

    overlay.addEventListener('click', e => {
      const b = e.target.closest('[data-k]');
      if (b) press(b.dataset.k);
      if (e.target.dataset.act === 'cancel') close(null);
    });

    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    paint();
  });
}

async function requireUnlock(message = 'Enter your PIN to continue.') {
  const stored = Store.read(KEYS.pin, null);
  if (!stored) return true;
  if (Session.get('pd.unlocked') === '1') return true;

  const ok = await lockScreen({
    title: 'Diary locked',
    message,
    verify: async pin => (await hash(pin)) === stored
  });
  if (ok) Session.set('pd.unlocked', '1');
  return Boolean(ok);
}

async function changePinFlow() {
  const stored = Store.read(KEYS.pin, null);

  if (stored) {
    const ok = await lockScreen({
      title: 'Confirm it is you',
      message: 'Enter your current PIN first.',
      dismissible: true,
      verify: async pin => (await hash(pin)) === stored
    });
    if (!ok) return;
  }

  const answer = await dialog({
    title: stored ? 'Choose a new PIN' : 'Set a PIN',
    message: 'Four digits, asked for each time you open the diary.',
    confirmText: 'Save PIN',
    fields: [
      { name: 'pin',   label: 'New PIN',    type: 'password', inputmode: 'numeric', maxlength: 4 },
      { name: 'again', label: 'Repeat PIN', type: 'password', inputmode: 'numeric', maxlength: 4 }
    ]
  });
  if (!answer) return;

  if (!/^\d{4}$/.test(answer.pin)) { toast('A PIN has to be exactly four digits.', 'error'); return; }
  if (answer.pin !== answer.again) { toast('The two PINs did not match.', 'error'); return; }

  Store.write(KEYS.pin, await hash(answer.pin));
  Session.set('pd.unlocked', '1');
  toast('PIN saved.', 'ok');
}

/* ---------------------------------------------------------------------------
   8. Translation service
   ------------------------------------------------------------------------ */

const getApiKey = () => Store.read(KEYS.apiKey, '') || '';
const getModel  = () => Store.read(KEYS.model, CONFIG.defaultModel);

async function ask(messages, maxTokens) {
  const key = getApiKey();
  if (!key) { const e = new Error('no-key'); e.code = 'no-key'; throw e; }

  const response = await fetch(CONFIG.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: getModel(), temperature: 0.2, max_tokens: maxTokens, messages })
  });

  if (!response.ok) {
    const e = new Error('http-' + response.status);
    e.code = response.status === 401 ? 'bad-key'
           : response.status === 402 ? 'no-credit'
           : response.status === 429 ? 'rate' : 'http';
    throw e;
  }

  const data = await response.json();
  if (data.error) { const e = new Error(data.error.message); e.code = 'api'; throw e; }

  const text = (data.choices?.[0]?.message?.content || '').trim();
  if (!text) { const e = new Error('empty'); e.code = 'api'; throw e; }
  return text;
}

/** Short prompts and tight token limits — the model spends less time thinking
 *  and the answer comes back sooner. */
async function translate(text, from, into) {
  const raw = await ask([
    { role: 'system',
      content: `Translate the user's diary sentence from ${from.name} into ${into.name}. ` +
               `Keep it first-person and natural. Output the ${into.name} sentence alone — ` +
               `no quotes, no notes.` },
    { role: 'user', content: text }
  ], 110);

  let out = raw.replace(/^["'\s]+|["'\s]+$/g, '');
  if (into.latin) out = out.charAt(0).toUpperCase() + out.slice(1);
  if (!/[.!?\u06D4\u061F\u0964]$/.test(out)) out += into.stop;
  return out;
}

/* ---------------------------------------------------------------------------
   9. Dictionary
   ------------------------------------------------------------------------ */

const lookCache = new Map();

/** Pipe-delimited rather than JSON: fewer tokens to generate, so it returns
 *  noticeably faster, and it is still trivial to parse. */
async function lookUpModel(word, into) {
  const raw = await ask([
    { role: 'system',
      content: `Define the user's word in ${into.name}. Reply on one line as ` +
               `part-of-speech|meaning|example — three fields, pipe separated, ` +
               `nothing else. Meaning and example must be in ${into.name}.` },
    { role: 'user', content: word }
  ], 90);

  const [pos, meaning, example] = raw.split('|').map(s => (s || '').trim());
  if (!meaning) return null;
  return { pos, meaning, example };
}

async function lookUpFree(word) {
  try {
    const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!r.ok) return null;
    const data = await r.json();
    const m = data?.[0]?.meanings?.[0];
    const d = m?.definitions?.[0];
    if (!d?.definition) return null;
    return { pos: m.partOfSpeech || '', meaning: d.definition, example: d.example || '' };
  } catch (err) { return null; }
}

async function lookUp(word, into) {
  const term = word.trim();
  if (!term) return null;

  const cacheKey = `${into.code}::${term.toLowerCase()}`;
  if (lookCache.has(cacheKey)) return lookCache.get(cacheKey);

  let result = null;
  try {
    result = await lookUpModel(term, into);
  } catch (err) {
    if (into.code === 'en') result = await lookUpFree(term);
    else throw err;
  }
  if (!result && into.code === 'en') result = await lookUpFree(term);
  if (result) lookCache.set(cacheKey, result);
  return result;
}

function wireLookup() {
  const input = $('#lookInput');
  const out = $('#lookResult');
  if (!input || !out) return;

  function idle() {
    const into = langByCode(Store.read(KEYS.into, 'en'));
    out.innerHTML = `<span class="look__idle">Any word, in any language. The meaning comes back in ${esc(into.name)}.</span>`;
  }

  async function run() {
    const word = input.value.trim();
    if (!word) { idle(); return; }

    const into = langByCode(Store.read(KEYS.into, 'en'));
    ensureFont(into.code);
    out.innerHTML = '<span class="look__idle">Looking it up…</span>';

    let result;
    try {
      result = await lookUp(word, into);
    } catch (err) {
      out.innerHTML = `<span class="look__idle">${
        err.code === 'no-key' ? 'Add a translation key in Settings to look words up.'
        : err.code === 'rate' ? 'Too many requests just now. Wait a moment and try again.'
        : 'Could not reach the dictionary. Try again shortly.'}</span>`;
      return;
    }

    if (!result) {
      out.innerHTML = `<span class="look__idle">Nothing found for “${esc(word)}”.</span>`;
      return;
    }

    const dir = into.rtl ? 'rtl' : 'ltr';
    out.innerHTML =
      `<p class="look__word" lang="${esc(into.code)}" dir="${dir}">${esc(word)}` +
      (result.pos ? `<span class="look__pos">${esc(result.pos)}</span>` : '') + `</p>` +
      `<p class="look__mean" lang="${esc(into.code)}" dir="${dir}">${esc(result.meaning)}</p>` +
      (result.example ? `<p class="look__eg" lang="${esc(into.code)}" dir="${dir}">${esc(result.example)}</p>` : '');
  }

  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    run();
  });

  document.addEventListener('pd:lang', idle);
  idle();
}

/* ---------------------------------------------------------------------------
   10. Appearance
   ------------------------------------------------------------------------ */

function applyTheme() {
  const hue = Number(Store.read(KEYS.hue, 340));
  const tone = Store.read(KEYS.tone, 'light');
  document.documentElement.style.setProperty('--hue', String(hue));
  document.documentElement.dataset.tone = tone;

  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = `hsl(${hue} 58% ${tone === 'dark' ? 20 : 46}%)`;
}

function wireAppearance() {
  const grid = $('#swatches');
  const slider = $('#hueSlider');
  const toneRow = $('#toneRow');
  if (!grid) return;

  const current = () => Number(Store.read(KEYS.hue, 340));

  grid.innerHTML = PRESETS.map(hue => `
    <button class="swatch" data-hue="${hue}" aria-label="Colour ${hue}"
            style="background: hsl(${hue} 58% 52%)"></button>`).join('');

  function markActive() {
    const hue = current();
    $$('.swatch', grid).forEach(sw => {
      sw.setAttribute('aria-pressed', String(Number(sw.dataset.hue) === hue));
    });
    if (slider) slider.value = String(hue);
    $$('button', toneRow).forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.tone === Store.read(KEYS.tone, 'light')));
    });
  }

  grid.addEventListener('click', e => {
    const sw = e.target.closest('[data-hue]');
    if (!sw) return;
    Store.write(KEYS.hue, Number(sw.dataset.hue));
    applyTheme(); markActive();
  });

  if (slider) {
    slider.value = String(current());
    // Repaint live while dragging, but only write to storage when released.
    slider.addEventListener('input', () => {
      document.documentElement.style.setProperty('--hue', slider.value);
    });
    slider.addEventListener('change', () => {
      Store.write(KEYS.hue, Number(slider.value));
      applyTheme(); markActive();
    });
  }

  if (toneRow) {
    toneRow.addEventListener('click', e => {
      const b = e.target.closest('[data-tone]');
      if (!b) return;
      Store.write(KEYS.tone, b.dataset.tone);
      applyTheme(); markActive();
    });
  }

  markActive();
}

function wireDrawer() {
  const open = () => { document.body.dataset.drawer = 'open'; };
  const close = () => { document.body.dataset.drawer = 'closed'; };
  $$('[data-drawer-open]').forEach(b => b.addEventListener('click', open));
  $$('[data-drawer-close]').forEach(b => b.addEventListener('click', close));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  close();
}

/* ---------------------------------------------------------------------------
   11. Settings shared by pages
   ------------------------------------------------------------------------ */

async function apiKeyFlow() {
  const answer = await dialog({
    title: 'Translation service',
    message: 'Translation runs through OpenRouter. Paste a key from openrouter.ai/keys. ' +
             'It is kept in this browser only and never written into the code.',
    confirmText: 'Save',
    fields: [
      { name: 'key', label: 'API key', type: 'password', value: getApiKey(),
        placeholder: 'sk-or-v1-…', hint: 'Leave empty to turn translation off.' },
      { name: 'model', label: 'Model', value: getModel(),
        hint: 'Free models are slower. openai/gpt-4o-mini answers in about a second.' }
    ]
  });
  if (!answer) return false;

  const key = answer.key.trim();
  const model = answer.model.trim() || CONFIG.defaultModel;
  Store.write(KEYS.model, model);

  if (key) { Store.write(KEYS.apiKey, key); toast('Saved. Translation is on.', 'ok'); }
  else { Store.remove(KEYS.apiKey); toast('Key removed. Writing still saves normally.'); }
  return Boolean(key);
}

/* ---------------------------------------------------------------------------
   12. Landing page
   ------------------------------------------------------------------------ */

function runDemo() {
  const page = $('#demoPage');
  const pair = $('#demoPair');
  const state = $('#demoState');
  if (!page) return;

  const script = [
    { type: 'Aaj ka din bohat acha tha.', out: 'Today was a really good day.',
      pair: 'Roman Urdu → English', latin: true },
    { type: 'Shaam ko halki baarish hui.', out: 'There was light rain in the evening.',
      pair: 'Roman Urdu → English', latin: true },
    { type: 'I felt calm for once.', out: 'ایک بار سکون محسوس ہوا۔',
      pair: 'English → Urdu', latin: false }
  ];

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const caret = '<span class="demo__caret"></span>';

  let visible = true, done = false;

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(e => { visible = e[0].isIntersecting; }).observe(page);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) visible = false; });

  const idle = async () => { while (!visible && !done) await wait(400); };

  async function type(text) {
    for (let i = 1; i <= text.length; i++) {
      await idle();
      page.innerHTML = esc(text.slice(0, i)) + caret;
      await wait(text[i - 1] === ' ' ? 30 : 48);
    }
  }

  async function play() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      page.textContent = script[0].out;
      return;
    }
    for (let pass = 0; pass < 3; pass++) {
      for (const step of script) {
        await idle();
        page.dataset.script = 'latin';
        page.dir = 'ltr';
        page.innerHTML = caret;
        pair.textContent = step.pair;
        state.textContent = 'Saved';
        await wait(650);

        await type(step.type);
        await wait(480);

        state.textContent = 'Translating…';
        await wait(620);

        if (!step.latin) ensureFont('ur');
        page.dataset.script = step.latin ? 'latin' : 'other';
        page.dir = step.latin ? 'ltr' : 'rtl';
        page.innerHTML = `<span class="demo__new">${esc(step.out)}</span>` + caret;
        state.textContent = 'Saved';
        await wait(2400);
      }
    }
    done = true;
    page.dataset.script = 'latin';
    page.dir = 'ltr';
    page.textContent = script[0].out;
  }

  play();
}

function initLanding() {
  const accounts = typeof Cloud !== 'undefined' && Cloud.configured;

  if (accounts && Cloud.user) { window.location.replace('home.html'); return; }

  $$('[data-start]').forEach(link => {
    link.href = accounts ? 'auth.html' : 'home.html';
    if (!accounts) {
      link.addEventListener('click', event => {
        if (Store.read(KEYS.user, null)) return;
        event.preventDefault();
        askName();
      });
    }
  });

  async function askName() {
    const answer = await dialog({
      title: 'What should the diary call you?',
      message: 'Nothing is sent anywhere. It is only used to say hello.',
      confirmText: 'Open my diary',
      fields: [{ name: 'name', label: 'Your name', maxlength: 40, placeholder: 'Saman' }]
    });
    if (!answer) return;
    const name = answer.name.trim();
    if (name.length < 2) { toast('Please enter your name.', 'error'); return; }
    Store.write(KEYS.user, { name });
    window.location.href = 'home.html';
  }

  runDemo();
}

/* ---------------------------------------------------------------------------
   13. Auth page
   ------------------------------------------------------------------------ */

function initAuth() {
  const form = $('#authForm');
  const title = $('#authTitle');
  const lede = $('#authLede');
  const submit = $('#authSubmit');
  const nameField = $('#nameField');
  const hint = $('#passwordHint');
  const password = $('#authPassword');

  let mode = 'signin';

  if (!Cloud.configured) {
    form.hidden = true;
    $('.auth__links').hidden = true;
    $('.tabs').hidden = true;
    title.textContent = 'Accounts are not set up yet';
    lede.innerHTML = 'Paste your Supabase URL and anon key into <code>config.js</code> to turn on ' +
                     'accounts and syncing. Until then the diary works offline on this device.';
    const go = el('a', 'btn btn--block btn--lg', 'Open the diary anyway');
    go.href = 'home.html';
    $('.auth__card').appendChild(go);
    return;
  }

  if (Cloud.user) { window.location.replace('home.html'); return; }

  function setMode(next) {
    mode = next;
    const signup = mode === 'signup';
    $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.mode === mode)));
    nameField.hidden = !signup;
    title.textContent = signup ? 'Create your account' : 'Welcome back';
    lede.textContent = signup
      ? 'One account, and your diary follows you to every device.'
      : 'Everything you have written is waiting on every device you use.';
    submit.textContent = signup ? 'Create account' : 'Sign in';
    hint.textContent = signup ? 'At least 8 characters.' : '';
    password.autocomplete = signup ? 'new-password' : 'current-password';
  }

  $$('.tab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));

  form.addEventListener('submit', async event => {
    event.preventDefault();

    const name = $('#authName').value.trim();
    const email = $('#authEmail').value.trim();
    const pass = password.value;

    if (!/^\S+@\S+\.\S+$/.test(email)) { toast('That email does not look right.', 'error'); return; }
    if (mode === 'signup' && name.length < 2) { toast('Please enter your name.', 'error'); return; }
    if (pass.length < 8) { toast('Passwords need at least 8 characters.', 'error'); return; }

    submit.disabled = true;
    submit.textContent = mode === 'signup' ? 'Creating…' : 'Signing in…';

    try {
      if (mode === 'signup') {
        const { needsConfirmation } = await Cloud.signUp(email, pass, name);
        if (needsConfirmation) {
          await dialog({
            title: 'Check your inbox',
            message: `A confirmation link is on its way to ${email}. Open it, then sign in here.`,
            confirmText: 'Got it', showCancel: false
          });
          setMode('signin');
          return;
        }
        Store.write(KEYS.user, { name, email });
      } else {
        await Cloud.signIn(email, pass);
        Store.write(KEYS.user, { name: Cloud.displayName(), email });
      }

      Entries.reset();
      try {
        const { pulled } = await Cloud.merge();
        if (pulled) toast(`${pulled} ${pulled === 1 ? 'page' : 'pages'} restored.`, 'ok');
      } catch (err) {
        toast('Signed in, but syncing failed. Your writing is safe locally.', 'error');
      }

      window.location.href = 'home.html';
    } catch (err) {
      toast(/invalid login/i.test(err.message) ? 'That email and password do not match.'
          : /already registered/i.test(err.message) ? 'There is already an account with that email.'
          : err.message, 'error');
    } finally {
      submit.disabled = false;
      setMode(mode);
    }
  });

  $('#btnForgot').addEventListener('click', async () => {
    const answer = await dialog({
      title: 'Reset your password',
      message: 'We will email you a link to set a new one.',
      confirmText: 'Send link',
      fields: [{ name: 'email', label: 'Email', type: 'email', value: $('#authEmail').value }]
    });
    if (!answer) return;
    try {
      await Cloud.resetPassword(answer.email.trim());
      toast('Link sent. Check your inbox.', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  });

  setMode('signin');
}

/* ---------------------------------------------------------------------------
   14. Home page
   ------------------------------------------------------------------------ */

function initHome() {
  const signedIn = typeof Cloud !== 'undefined' && Cloud.user;
  const stored = Store.read(KEYS.user, null);
  if (!stored && !signedIn) { window.location.replace('index.html'); return; }

  const name = signedIn ? Cloud.displayName() : stored.name;
  $('#today').textContent = fmtDate(Date.now());
  $('#greeting').textContent = `Welcome back, ${name}`;

  const list = $('#entryList');
  const search = $('#search');

  function matches(entry, term) {
    if (!term) return true;
    if (entry.locked) return (entry.title || '').toLowerCase().includes(term);
    const originals = entry.history.map(h => h.original).join(' ');
    return [entry.title, entry.text, originals].join(' ').toLowerCase().includes(term);
  }

  function render() {
    const term = search.value.trim().toLowerCase();
    const all = Entries.all().sort((a, b) => b.createdAt - a.createdAt);
    const shown = all.filter(e => matches(e, term));

    $('#count').textContent = all.length === 0
      ? 'Nothing written yet. Today is a good place to start.'
      : `${all.length} ${all.length === 1 ? 'page' : 'pages'} written`;

    list.innerHTML = '';

    if (shown.length === 0) {
      list.appendChild(el('div', 'blank', term
        ? `<h2>Nothing found</h2><p>No page contains “${esc(term)}”.</p>`
        : `<h2>Your diary is empty</h2>
           <p>Write a line about today. You can come back and add more any time.</p>
           <button class="btn" data-new>Write my first page</button>`));
      return;
    }

    let day = null, grid = null;
    shown.forEach(entry => {
      const label = dayLabel(entry.createdAt);
      if (label !== day) {
        day = label;
        const section = el('section', 'day');
        section.appendChild(el('h2', 'day__label', esc(label)));
        grid = el('div', 'cards');
        section.appendChild(grid);
        list.appendChild(section);
      }
      grid.appendChild(card(entry));
    });
  }

  function card(entry) {
    const node = el('article', 'card');
    const title = entry.title || 'Untitled';
    const into = langByCode(entry.into);

    node.innerHTML = `
      <span class="card__time">${esc(fmtTime(entry.createdAt))} · ${esc(into.name)}</span>
      <h3 class="card__title">${esc(title)}</h3>
      ${entry.locked
        ? '<p class="card__locked">🔒 Locked — your PIN opens this.</p>'
        : `<p class="card__text">${esc(plainText(entry.text).slice(0, 170)) || 'Nothing written yet.'}</p>`}
      <span class="card__meta">${countWords(plainText(entry.text))} words</span>
      <div class="card__row">
        <button class="btn btn--sm" data-open>Open</button>
        <button class="btn btn--quiet btn--sm" data-del>Delete</button>
      </div>`;

    node.querySelector('[data-open]').addEventListener('click', async () => {
      if (entry.locked && !(await requireUnlock('This page is locked.'))) return;
      window.location.href = `diary.html?id=${encodeURIComponent(entry.id)}`;
    });

    node.querySelector('[data-del]').addEventListener('click', async () => {
      if (!await confirmDialog('Delete this page?',
        `“${title}” will be removed. This cannot be undone.`)) return;
      Entries.remove(entry.id);
      toast('Page deleted.', 'ok');
      render();
    });

    return node;
  }

  function paintAccount() {
    const box = $('#account');
    box.innerHTML = '';

    if (signedIn) {
      box.appendChild(el('p', 'account__who', esc(Cloud.user.email)));
      const pill = el('p', 'account__state');
      box.appendChild(pill);
      Cloud.onStatus(status => {
        pill.dataset.status = status;
        pill.textContent = {
          syncing: 'Syncing…',
          synced: 'Backed up to your account',
          error: 'Sync failed — will retry',
          offline: 'Offline — saved on this device'
        }[status] || status;
      });
      return;
    }

    box.appendChild(el('p', 'account__who', 'No account'));
    box.appendChild(el('p', 'account__state', 'Saved on this device only'));

    if (typeof Cloud !== 'undefined' && Cloud.configured) {
      const go = el('a', 'btn btn--quiet btn--block', 'Sign in to sync');
      go.href = 'auth.html';
      go.style.marginTop = '10px';
      box.appendChild(go);
    }
  }

  search.addEventListener('input', debounce(render, 220));
  list.addEventListener('click', e => {
    if (e.target.hasAttribute('data-new')) window.location.href = 'diary.html';
  });

  $('#btnNew').addEventListener('click', () => { window.location.href = 'diary.html'; });
  $('#btnPin').addEventListener('click', changePinFlow);
  $('#btnKey').addEventListener('click', apiKeyFlow);

  $('#btnBackup').addEventListener('click', async () => {
    const all = Entries.all().sort((a, b) => a.createdAt - b.createdAt);
    if (!all.length) { toast('There is nothing to save yet.'); return; }
    if (!(await requireUnlock('Enter your PIN to save a backup.'))) return;

    const text = all.map(entry => {
      const head = `${fmtDate(entry.createdAt)} — ${entry.title || 'Untitled'}`;
      return `${head}\n${'='.repeat(head.length)}\n\n${plainText(entry.text)}\n`;
    }).join('\n\n');

    download('my-secret-diary.txt', text);
    toast('Backup saved to your device.', 'ok');
  });

  $('#btnSignOut').addEventListener('click', async () => {
    const ok = await confirmDialog('Sign out?',
      signedIn ? 'Everything you have written stays safe in your account.'
               : 'Everything you have written stays saved on this device.',
      'Sign out');
    if (!ok) return;

    if (signedIn) { await Cloud.flush(); await Cloud.signOut(); }
    Store.remove(KEYS.user);
    Session.remove('pd.unlocked');
    Entries.reset();
    window.location.href = signedIn ? 'auth.html' : 'index.html';
  });

  paintAccount();
  render();
}

/* ---------------------------------------------------------------------------
   15. Diary page
   ------------------------------------------------------------------------ */

function initDiary() {
  const signedIn = typeof Cloud !== 'undefined' && Cloud.user;
  if (!Store.read(KEYS.user, null) && !signedIn) { window.location.replace('index.html'); return; }

  const params = new URLSearchParams(window.location.search);
  let entry = params.get('id') ? Entries.get(params.get('id')) : null;
  let isNew = false;
  if (!entry) { entry = Entries.blank(); isNew = true; }

  const write = $('#write');
  const titleBox = $('#title');
  const strip = $('#strip');
  const saveState = $('#saveState');
  const words = $('#words');
  const undoSlot = $('#undoSlot');
  const fromSel = $('#fromLang');
  const intoSel = $('#intoLang');

  let lastSwap = null;

  /* ---- saving ---- */

  const persist = debounce(() => {
    Entries.save(entry);
    if (isNew) {
      isNew = false;
      try { history.replaceState(null, '', `diary.html?id=${encodeURIComponent(entry.id)}`); }
      catch (err) { /* file:// blocks this */ }
    }
    saveState.textContent = `Saved ${fmtTime(Date.now())}`;
  }, CONFIG.autosave);

  function touch() {
    entry.text = write.innerHTML;
    saveState.textContent = 'Saving…';
    words.textContent = `${countWords(plainText(write.innerHTML))} words`;
    persist();
  }

  /* ---- formatting toolbar ----------------------------------------------
     execCommand is deprecated but still the only thing every browser
     implements for contenteditable, and it handles undo history for free.
     ------------------------------------------------------------------- */

  function exec(command, value) {
    write.focus();
    try { document.execCommand(command, false, value ?? null); }
    catch (err) { console.warn('Command failed:', command, err); }
    touch();
    refreshToolbar();
  }

  function insertAtCaret(html) {
    write.focus();
    try { document.execCommand('insertHTML', false, html); }
    catch (err) { write.insertAdjacentHTML('beforeend', html); }
    touch();
  }

  const COMMANDS = {
    bold:      () => exec('bold'),
    italic:    () => exec('italic'),
    underline: () => exec('underline'),
    bullets:   () => exec('insertUnorderedList'),
    numbers:   () => exec('insertOrderedList'),
    clear:     () => { exec('removeFormat'); exec('formatBlock', 'p'); },
    line:      () => insertAtCaret('<hr><p><br></p>'),

    highlight() {
      // No single command covers this, so wrap or unwrap by hand.
      const selection = window.getSelection();
      if (!selection.rangeCount || selection.isCollapsed) {
        toast('Select some words first, then highlight them.');
        return;
      }
      const existing = closestTag(selection.anchorNode, 'MARK');
      if (existing) { existing.replaceWith(...existing.childNodes); touch(); refreshToolbar(); return; }

      const range = selection.getRangeAt(0);
      const mark = document.createElement('mark');
      try {
        range.surroundContents(mark);
      } catch (err) {
        // The selection crossed element boundaries; fall back to extraction.
        mark.appendChild(range.extractContents());
        range.insertNode(mark);
      }
      selection.removeAllRanges();
      touch();
      refreshToolbar();
    },

    table() {
      const cells = n => Array.from({ length: n }, () => '<td><br></td>').join('');
      insertAtCaret(
        '<table><thead><tr><th>&nbsp;</th><th>&nbsp;</th><th>&nbsp;</th></tr></thead>' +
        `<tbody><tr>${cells(3)}</tr><tr>${cells(3)}</tr></tbody></table><p><br></p>`);
    }
  };

  function closestTag(node, tag) {
    let current = node?.nodeType === 3 ? node.parentNode : node;
    while (current && current !== write) {
      if (current.tagName === tag) return current;
      current = current.parentNode;
    }
    return null;
  }

  $$('.tool[data-cmd]').forEach(button => {
    // pointerdown, not click: it covers mouse and touch alike, and the
    // selection is still alive at that point on both.
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      COMMANDS[button.dataset.cmd]?.();
    });
  });

  $('#blockSel').addEventListener('change', event => {
    exec('formatBlock', event.target.value);
    event.target.value = 'p';
  });

  $('#faceSel').addEventListener('change', event => {
    entry.face = event.target.value;
    write.dataset.face = entry.face;
    Store.write(KEYS.face, entry.face);
    touch();
  });

  function refreshToolbar() {
    const state = {
      bold: 'bold', italic: 'italic', underline: 'underline',
      bullets: 'insertUnorderedList', numbers: 'insertOrderedList'
    };
    Object.entries(state).forEach(([name, command]) => {
      const button = $(`.tool[data-cmd="${name}"]`);
      if (!button) return;
      let on = false;
      try { on = document.queryCommandState(command); } catch (err) { /* ignore */ }
      button.setAttribute('aria-pressed', String(on));
    });

    const mark = $('.tool[data-cmd="highlight"]');
    if (mark) {
      const sel = window.getSelection();
      mark.setAttribute('aria-pressed',
        String(Boolean(sel.anchorNode && closestTag(sel.anchorNode, 'MARK'))));
    }
  }

  document.addEventListener('selectionchange', () => {
    if (document.activeElement === write) refreshToolbar();
  });

  // Keyboard shortcuts people already expect
  write.addEventListener('keydown', event => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'b') { event.preventDefault(); COMMANDS.bold(); }
    if (key === 'i') { event.preventDefault(); COMMANDS.italic(); }
    if (key === 'u') { event.preventDefault(); COMMANDS.underline(); }
    if (key === 'h') { event.preventDefault(); COMMANDS.highlight(); }
  });

  // Pasted content arrives as plain text, so no foreign styling leaks in.
  write.addEventListener('paste', event => {
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData).getData('text/plain');
    insertAtCaret(esc(text).replace(/\n/g, '<br>'));
  });

  /* ---- languages -------------------------------------------------------
     The writing surface follows the language being written IN. Getting this
     backwards puts full stops on the wrong side of Latin text.
     ------------------------------------------------------------------- */

  const fromLang = () => langByCode(entry.from, 'urr');
  const intoLang = () => langByCode(entry.into, 'en');

  function applyLangs() {
    const from = fromLang(), into = intoLang();
    ensureFont(from.code);
    ensureFont(into.code);

    write.dir = from.rtl ? 'rtl' : 'ltr';
    write.lang = from.code;
    write.dataset.script = from.latin ? 'latin' : 'other';
    write.dataset.placeholder =
      `Write in ${from.name}. Finish a sentence with ` +
      `${from.stop === '.' ? 'a full stop' : `“${from.stop}”`} and it becomes ${into.name}.`;

    idleStrip();
    document.dispatchEvent(new CustomEvent('pd:lang'));
  }

  function fillSelect(select, selected) {
    select.innerHTML = LANGUAGES.map(l =>
      `<option value="${esc(l.code)}"${l.code === selected ? ' selected' : ''}>${esc(l.label)}</option>`
    ).join('');
  }

  fillSelect(fromSel, entry.from);
  fillSelect(intoSel, entry.into);

  fromSel.addEventListener('change', () => {
    entry.from = fromSel.value;
    Store.write(KEYS.from, entry.from);
    applyLangs(); touch();
  });

  intoSel.addEventListener('change', () => {
    entry.into = intoSel.value;
    Store.write(KEYS.into, entry.into);
    applyLangs(); touch();
    toast(`New sentences will become ${intoLang().name}.`, 'ok');
  });

  $('#swap').addEventListener('click', () => {
    [entry.from, entry.into] = [entry.into, entry.from];
    fromSel.value = entry.from;
    intoSel.value = entry.into;
    Store.write(KEYS.from, entry.from);
    Store.write(KEYS.into, entry.into);
    applyLangs(); touch();
  });

  /* ---- the strip ---- */

  function showStrip(was, now, { busy = false, error = false } = {}) {
    strip.dataset.busy = String(busy);
    strip.dataset.error = String(error);
    strip.innerHTML =
      `<span class="strip__was">${esc(was)}</span>` +
      `<span class="strip__arrow">→</span>` +
      `<span class="strip__now">${esc(now)}</span>`;
  }

  function idleStrip() {
    strip.dataset.busy = 'false';
    strip.dataset.error = 'false';
    strip.innerHTML = `<span class="strip__idle">Finished sentences turn into ${esc(intoLang().name)} as you write.</span>`;
  }

  function offerUndo() {
    undoSlot.innerHTML = '<button class="link-btn" type="button">Undo that change</button>';
    undoSlot.firstChild.addEventListener('click', () => {
      if (!lastSwap) return;
      write.innerHTML = lastSwap.before;
      lastSwap = null;
      undoSlot.innerHTML = '';
      idleStrip(); touch(); write.focus();
    });
  }

  /* ---- the swap --------------------------------------------------------
     Works inside whichever block the caret sits in, so formatting elsewhere
     on the page is never touched. The replaced run is measured in plain
     characters, then converted back into a DOM range.
     ------------------------------------------------------------------- */

  let chain = Promise.resolve();
  let lastSource = '';

  function swap() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const block = blockOf(selection.anchorNode, write);
    const caret = offsetWithin(block, selection.anchorNode, selection.anchorOffset);
    const text = block.textContent;

    const start = sentenceStart(text, caret);
    const source = text.slice(start, caret - 1).trim();

    if (!isSentence(source)) return;
    if (!getApiKey()) return;
    if (entry.from === entry.into) return;
    if (source === lastSource) return;      // already handled this exact run
    lastSource = source;

    const target = text.slice(start, caret);
    const lead = target.match(/^\s*/)[0];

    showStrip(source, 'translating…', { busy: true });

    chain = chain.then(async () => {
      let result;
      try {
        result = await translate(source, fromLang(), intoLang());
      } catch (err) {
        showStrip(source,
          err.code === 'bad-key'    ? 'that key was rejected — check Settings'
          : err.code === 'no-credit' ? 'this model needs credits — pick another in Settings'
          : err.code === 'rate'     ? 'too many requests, wait a moment'
          : 'could not reach the translator — your words are untouched',
          { error: true });
        return;
      }

      // Re-read the block: you may have carried on typing meanwhile.
      if (!write.contains(block)) { idleStrip(); return; }
      const now = block.textContent;
      const at = now.indexOf(target);
      if (at === -1) { idleStrip(); return; }

      const range = rangeWithin(block, at, at + target.length);
      if (!range) { idleStrip(); return; }

      const before = write.innerHTML;

      const holder = document.createElement('span');
      holder.className = 'swapped';
      holder.textContent = lead + result;

      range.deleteContents();
      range.insertNode(holder);

      // Put the caret after the new text, then unwrap the highlight span so
      // the saved HTML stays clean.
      caretTo(holder.lastChild || holder, (holder.textContent || '').length);
      setTimeout(() => {
        if (!holder.parentNode) return;
        const parent = holder.parentNode;
        holder.replaceWith(...holder.childNodes);
        parent.normalize();
        entry.text = write.innerHTML;
      }, 750);

      lastSwap = { before, after: write.innerHTML };
      entry.history.push({ at: Date.now(), original: source, result });
      offerUndo();
      showStrip(source, result);
      touch();
    });
  }

  /* Phone keyboards do not report the character in keydown or keyup — Gboard
     and the iOS keyboard send keyCode 229 / key "Unidentified" for ordinary
     letters. The trigger is therefore read from the input event, which carries
     the text that was actually inserted on every platform. */

  function endsWithTrigger(text) {
    return Boolean(text) && TRIGGERS.some(mark => text.endsWith(mark));
  }

  /** Fallback for the few Android paths that leave event.data null. */
  function charBeforeCaret() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return '';
    const { anchorNode, anchorOffset } = selection;
    if (anchorNode?.nodeType === 3 && anchorOffset > 0) {
      return anchorNode.textContent[anchorOffset - 1];
    }
    return '';
  }

  let composing = false;
  write.addEventListener('compositionstart', () => { composing = true; });
  write.addEventListener('compositionend', event => {
    composing = false;
    if (endsWithTrigger(event.data)) swap();
  });

  write.addEventListener('input', event => {
    touch();
    if (composing) return;                       // wait for the IME to settle

    if (event.inputType && event.inputType.startsWith('delete')) return;

    // Only consult the caret when the event told us nothing. If it did report
    // the inserted text and that text was not a trigger, nothing should fire —
    // otherwise a full stop left over from an earlier sentence would set the
    // swap off again on the next keystroke.
    const inserted = event.data == null ? charBeforeCaret() : event.data;
    if (endsWithTrigger(inserted)) swap();
  });
  titleBox.addEventListener('input', () => { entry.title = titleBox.value.trim(); touch(); });

  /* ---- header actions ---- */

  function paintLock() {
    const button = $('#btnLock');
    button.dataset.on = String(entry.locked);
    button.setAttribute('aria-pressed', String(entry.locked));
    const label = entry.locked ? 'Remove the lock' : 'Lock this page';
    button.dataset.tip = label;
    button.setAttribute('aria-label', label);
  }

  $('#btnLock').addEventListener('click', () => {
    if (!Store.read(KEYS.pin, null)) {
      toast('Set a PIN from your diary page first, then you can lock this.', 'error');
      return;
    }
    entry.locked = !entry.locked;
    paintLock(); touch();
    toast(entry.locked ? 'This page now needs your PIN.' : 'Lock removed.', 'ok');
  });

  $('#btnHistory').addEventListener('click', () => {
    if (!entry.history.length) {
      toast('Nothing has been translated on this page yet.');
      return;
    }
    const rows = entry.history.map(h =>
      `<p style="margin-bottom:12px">
         <span style="color:var(--muted)">${esc(h.original)}</span><br>
         <span>${esc(h.result || h.english || '')}</span>
       </p>`).join('');
    dialog({
      title: 'What you first typed',
      message: 'Every change this page made, oldest first. Your own words are kept.',
      bodyHtml: `<div style="max-height:44vh;overflow-y:auto">${rows}</div>`,
      confirmText: 'Close', showCancel: false
    });
  });

  $('#btnDownload').addEventListener('click', () => {
    const body = plainText(write.innerHTML);
    if (!body) { toast('Write something first.'); return; }
    const head = `${fmtDate(entry.createdAt)} — ${entry.title || 'Untitled'}`;
    download(`diary-${new Date(entry.createdAt).toISOString().slice(0, 10)}.txt`,
             `${head}\n${'='.repeat(head.length)}\n\n${body}\n`);
    toast('Saved to your device.', 'ok');
  });

  $('#btnDelete').addEventListener('click', async () => {
    if (!await confirmDialog('Delete this page?',
      'Everything written here will be removed. This cannot be undone.')) return;
    Entries.remove(entry.id);
    window.location.href = 'home.html';
  });

  /* ---- notices ---- */

  function paintNotice() {
    const holder = $('#notice');
    holder.innerHTML = '';
    if (getApiKey()) return;

    const note = el('div', 'note enter',
      `<p><strong>Translation is off.</strong> You can still write, and everything
        saves — sentences just stay in your own words.</p>`);
    const button = el('button', 'btn btn--sm', 'Set it up');
    button.addEventListener('click', async () => { if (await apiKeyFlow()) paintNotice(); });
    note.appendChild(button);
    holder.appendChild(note);
  }

  function paintTip() {
    if (Store.read(KEYS.seen, false)) return;
    const holder = $('#tip');
    const tip = el('div', 'tip enter',
      `<span>Pick your two languages above, then just write. Ending a sentence
        is what changes it.</span>`);
    const close = el('button', 'link-btn tip__x', 'Got it');
    close.addEventListener('click', () => { Store.write(KEYS.seen, true); holder.innerHTML = ''; });
    tip.appendChild(close);
    holder.appendChild(tip);
  }

  /* ---- go ---- */

  titleBox.value = entry.title || '';
  write.innerHTML = toHtml(entry.text);
  entry.face = entry.face || Store.read(KEYS.face, 'serif');
  write.dataset.face = entry.face;
  $('#faceSel').value = entry.face;

  $('#entryDate').textContent = fmtDate(entry.createdAt);
  saveState.textContent = isNew ? 'Not saved yet' : `Saved ${fmtTime(entry.updatedAt)}`;
  words.textContent = `${countWords(plainText(write.innerHTML))} words`;

  paintLock();
  paintNotice();
  paintTip();
  applyLangs();

  write.focus();
  const last = write.lastChild;
  if (last) caretTo(last, last.nodeType === 3 ? last.length : last.childNodes.length);
}

/* ---------------------------------------------------------------------------
   16. Start
   ------------------------------------------------------------------------ */

document.addEventListener('DOMContentLoaded', async () => {
  applyTheme();

  const page = document.body.dataset.page;

  if (typeof Cloud !== 'undefined') {
    try { await Cloud.init(); } catch (err) { console.warn('Cloud init failed:', err); }
  }

  if (page === 'landing') { initLanding(); return; }
  if (page === 'auth')    { initAuth(); return; }

  wireDrawer();
  wireAppearance();
  wireLookup();

  if (!(await requireUnlock())) return;

  if (page === 'home')  initHome();
  if (page === 'diary') initDiary();

  if (typeof Cloud !== 'undefined' && Cloud.user) {
    Cloud.merge()
      .then(({ pulled }) => { if (pulled && page === 'home') window.location.reload(); })
      .catch(() => { /* the status pill already shows it */ });
  }
});
