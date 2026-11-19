'use strict';

/* =====================================================================
   Tiện ích chung
   ===================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const app = $('#app');

const LS = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const sample = (arr, n) => shuffle(arr).slice(0, n);
const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(msg, isErr = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

let me = null;
const authHeaders = () => {
  const tk = LS.get('token', null);
  return tk ? { Authorization: 'Bearer ' + tk } : {};
};
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    LS.del('token');
    me = null;
    renderUserChip();
    location.hash = '#/login';
  }
  if (!res.ok) {
    let msg = `Lỗi ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

/** Tải ảnh lên server; ảnh lớn được thu nhỏ còn tối đa 1200px. */
async function uploadImage(file) {
  let blob = file;
  if (file.size > 1.2 * 1024 * 1024 && file.type !== 'image/gif') {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    } catch {}
  }
  const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': blob.type, ...authHeaders() }, body: blob });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'Tải ảnh thất bại');
  return j.url;
}

/** Tải file từ API (có xác thực) về máy */
async function downloadFile(path, fallbackName) {
  const res = await fetch('/api' + path, { headers: authHeaders() });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || 'Không tải được file');
  }
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return name;
}

/** Nhập học phần từ file Excel (.xlsx) hoặc CSV */
async function importFiles(files) {
  const list = [...files].filter((f) => /\.(xlsx|csv|tsv|txt)$/i.test(f.name));
  if (!list.length) return toast('Hãy chọn file Excel (.xlsx) hoặc .csv', true);
  const created = [];
  for (const file of list) {
    toast(`Đang nhập “${file.name}”…`);
    const res = await fetch('/api/import?name=' + encodeURIComponent(file.name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
      body: file,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(`${file.name}: ${j.error || 'không nhập được'}`, true);
      continue;
    }
    created.push(...j);
  }
  if (!created.length) return;
  const cards = created.reduce((n, x) => n + x.termCount, 0);
  toast(`Đã nhập ${created.length} học phần (${cards} thẻ). Thẻ thiếu phiên âm sẽ được tự tra trong giây lát.`);
  location.hash = created.length === 1 ? '#/set/' + created[0].id : '#/library';
  if (created.length > 1) route();
}

/** Nút "Nhập file Excel" + kéo thả file vào trang */
function importButton(label = 'Nhập file Excel') {
  return `<label class="btn" title="Nhập học phần từ file Excel (.xlsx) hoặc .csv">${I.upload} ${label}<input type="file" accept=".xlsx,.csv,.tsv,.txt" multiple hidden data-import></label>`;
}
function bindImport(root = app) {
  $$('[data-import]', root).forEach((inp) => (inp.onchange = () => importFiles(inp.files).finally(() => (inp.value = ''))));
}
// Kéo thả file Excel vào bất kỳ đâu trong ứng dụng
document.addEventListener('dragover', (e) => {
  if (!me || !e.dataTransfer?.types?.includes('Files') || e.target.closest('.drop-zone')) return;
  e.preventDefault();
  document.body.classList.add('drag-file');
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('drag-file');
});
document.addEventListener('drop', (e) => {
  document.body.classList.remove('drag-file');
  if (!me || e.target.closest('.drop-zone') || !e.dataTransfer?.files?.length) return;
  const sheets = [...e.dataTransfer.files].filter((f) => /\.(xlsx|csv|tsv)$/i.test(f.name));
  if (!sheets.length) return;
  e.preventDefault();
  importFiles(sheets);
});

// So khớp câu trả lời: bỏ dấu câu, chữ hoa; chấp nhận một trong các nghĩa ngăn bởi , ; /
const norm = (s) =>
  String(s || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[.,!?;:"'“”‘’…\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

/** @returns {'exact'|'close'|false} */
function checkAnswer(input, answer) {
  const x = norm(input);
  if (!x) return false;
  const full = norm(answer);
  if (x === full) return 'exact';
  const parts = String(answer).split(/[,;/\n]/).map(norm).filter(Boolean);
  if (parts.length > 1 && parts.includes(x)) return 'exact';
  const tol = full.length >= 6 ? 1 : 0;
  if (tol && levenshtein(x, full) <= tol) return 'close';
  return false;
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

/* =====================================================================
   Biểu tượng
   ===================================================================== */
const svg = (p, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${p}</svg>`;
const I = {
  star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  starFill: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/>'),
  sound: svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
  cards: svg('<rect x="3" y="6" width="14" height="14" rx="2"/><path d="M7 2h12a2 2 0 0 1 2 2v12"/>'),
  learn: svg('<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 3"/><path d="M21 3v6h-6"/>'),
  test: svg('<path d="M9 3h6l1 2h3v16H5V5h3z"/><path d="m9 13 2 2 4-4"/>'),
  match: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M14 6.5h4a2 2 0 0 1 2 2V11"/><path d="M10 17.5H6a2 2 0 0 1-2-2V13"/>'),
  spell: svg('<path d="M3 18h6"/><path d="M4 18 8 6l4 12"/><path d="M5.5 14h5"/><path d="m14 15 2.5 2.5L21 12"/>'),
  prev: svg('<path d="m15 18-6-6 6-6"/>'),
  next: svg('<path d="m9 18 6-6-6-6"/>'),
  shuffle: svg('<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>'),
  close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  play: svg('<path d="m6 4 14 8-14 8z" fill="currentColor"/>'),
  pause: svg('<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>'),
  up: svg('<path d="m18 15-6-6-6 6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  swap: svg('<path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/>'),
  upload: svg('<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/>'),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  wand: svg('<path d="m15 4 5 5L9 20H4v-5z"/><path d="M19 2v3"/><path d="M17.5 3.5h3"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>'),
  book: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/>'),
  image: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>'),
  users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>'),
  ext: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
};

/* =====================================================================
   Giao diện sáng/tối & giọng đọc UK/US
   ===================================================================== */
let accent = LS.get('accent', 'uk');
function applyTheme() {
  const t = LS.get('theme', null);
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  $('#themeBtn').innerHTML = dark ? I.sun : I.moon;
}
$('#themeBtn').onclick = () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  LS.set('theme', dark ? 'light' : 'dark');
  applyTheme();
};
function renderAccentBtn() {
  $('#accentBtn').innerHTML = `<span style="font-weight:800;font-size:12px">${accent.toUpperCase()}</span>`;
  $('#accentBtn').title = `Giọng đọc & phiên âm: ${accent === 'uk' ? 'Anh – Anh (UK)' : 'Anh – Mỹ (US)'} — bấm để đổi`;
}
$('#accentBtn').onclick = () => {
  accent = accent === 'uk' ? 'us' : 'uk';
  LS.set('accent', accent);
  renderAccentBtn();
  toast(`Đã chuyển sang giọng ${accent === 'uk' ? 'Anh – Anh (UK)' : 'Anh – Mỹ (US)'}`);
  // Chỉ vẽ lại những màn hình không có dữ liệu đang nhập dở
  if (/^(#\/?)?$|^#\/library$|^#\/set\/[\w-]+(\/flashcards)?$/.test(location.hash)) route();
};
applyTheme();
renderAccentBtn();

const ipaOf = (t, acc = accent) => (acc === 'us' ? t.ipaUs || t.ipaUk : t.ipaUk || t.ipaUs) || '';
/** Phiên âm có thể bấm vào để xem cách đọc từng âm */
const ipaLink = (ipa, word, cls = '') =>
  ipa ? `<span class="ipa ipa-link ${cls}" data-ipa="${esc(ipa)}" data-word="${esc(word || '')}" title="Bấm để xem cách đọc từng âm">${esc(ipa)}</span>` : '';
const imgTag = (t, cls = 'card-img') => (t.image ? `<img class="${cls}" src="${esc(t.image)}" alt="" loading="lazy" />` : '');

/* =====================================================================
   Từ điển (Cambridge qua server) & phát âm
   ===================================================================== */
const defCache = new Map();
const defResolved = new Map();
function define(word) {
  const key = word.trim().toLowerCase();
  if (!defCache.has(key)) {
    const p = api('/dict/define?word=' + encodeURIComponent(word.trim()))
      .then((r) => {
        defResolved.set(key, r);
        if (r.transient) defCache.delete(key);
        return r;
      })
      .catch((err) => {
        defCache.delete(key);
        throw err;
      });
    defCache.set(key, p);
  }
  return defCache.get(key);
}

const hasVietnamese = (s) => /[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/i.test(s);

function speakTTS(text, lang) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const v = speechSynthesis.getVoices().find((x) => x.lang.replace('_', '-').startsWith(lang));
  if (v) u.voice = v;
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

let currentAudio = null;
function playUrl(url, fallback) {
  if (currentAudio) currentAudio.pause();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (!url) return fallback();
  let done = false;
  const fail = () => {
    if (!done) {
      done = true;
      fallback();
    }
  };
  const a = new Audio(url);
  currentAudio = a;
  a.onerror = fail;
  a.play().catch(fail);
}

/** Phát âm thuật ngữ: ưu tiên audio Cambridge/Wiktionary, nếu không có thì dùng giọng đọc của trình duyệt. */
async function playTerm(t, acc = accent) {
  let url = acc === 'us' ? t.audioUs || t.audioUk : t.audioUk || t.audioUs;
  const tts = () => speakTTS(t.term, acc === 'us' ? 'en-US' : 'en-GB');
  if (!url && t.term && /^[a-z][a-z' -]{0,40}$/i.test(t.term.trim())) {
    try {
      const r = await Promise.race([define(t.term), sleep(2500).then(() => null)]);
      if (r) url = (acc === 'us' ? r.us.audio || r.uk.audio : r.uk.audio || r.us.audio) || null;
    } catch {}
  }
  playUrl(url, tts);
}
function playText(text) {
  speakTTS(text, hasVietnamese(text) ? 'vi-VN' : accent === 'us' ? 'en-US' : 'en-GB');
}
if ('speechSynthesis' in window) speechSynthesis.getVoices();

/* ---------- ô gợi ý từ (autocomplete) ---------- */
function attachAutocomplete(input, { onPick, onEnter } = {}) {
  const wrap = input.parentElement;
  let panel = null;
  let items = [];
  let active = -1;
  let ctrl = null;
  let lastQ = '';

  const close = () => {
    panel?.remove();
    panel = null;
    active = -1;
  };
  // Sau khi chọn / Enter / Esc thì bỏ qua các kết quả gợi ý đến muộn
  let gen = 0;
  const dismiss = () => {
    gen++;
    ctrl?.abort();
    close();
  };
  const render = (source) => {
    if (!items.length) return close();
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'ac-panel';
      wrap.appendChild(panel);
      panel.addEventListener('mousedown', (e) => {
        const it = e.target.closest('.ac-item');
        if (!it) return;
        e.preventDefault();
        pick(items[+it.dataset.i]);
      });
    }
    panel.innerHTML =
      items
        .map((x, i) => {
          const full = defResolved.get(x.word.toLowerCase());
          const exact = full && (full.uk.ipa || full.us.ipa);
          const ipa = exact ? ipaOf({ ipaUk: full.uk.ipa, ipaUs: full.us.ipa }) : x.ipa;
          return `<div class="ac-item ${i === active ? 'active' : ''}" data-i="${i}">
            <div><span class="w">${esc(x.word)}</span>${ipa ? `<span class="ipa" ${exact ? '' : 'title="Phiên âm gần đúng"'}>${exact ? '' : '≈ '}${esc(ipa)}</span>` : ''}
            ${x.pos ? `<span class="muted small"> · ${esc(x.pos)}</span>` : ''}</div>
            ${x.def ? `<div class="d">${esc(x.def)}</div>` : ''}
          </div>`;
        })
        .join('') +
      `<div class="ac-foot"><span>${
        source === 'cambridge' ? 'Gợi ý từ <b>Cambridge Dictionary</b>' : 'Gợi ý từ Datamuse (Cambridge đang tạm chặn)'
      }</span><span>↑ ↓ để chọn · Enter</span></div>`;
  };
  const load = async (q, g) => {
    if (g !== gen) return;
    ctrl?.abort();
    ctrl = new AbortController();
    try {
      const r = await api('/dict/suggest?q=' + encodeURIComponent(q), { signal: ctrl.signal });
      if (g !== gen || input.value.trim() !== q || document.activeElement !== input) return;
      items = r.items.slice(0, 8);
      active = -1;
      render(r.source);
      // Thay phiên âm gần đúng của vài gợi ý đầu bằng phiên âm chuẩn UK/US
      const shown = items;
      for (const x of shown.slice(0, 3)) {
        if (defResolved.has(x.word.toLowerCase())) continue;
        define(x.word)
          .then(() => panel && items === shown && render(r.source))
          .catch(() => {});
      }
    } catch {}
  };
  const pick = (item) => {
    dismiss();
    lastQ = item.word;
    input.value = item.word;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    close();
    onPick?.(item);
  };
  const debounced = debounce(load, 200);
  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q === lastQ) return;
    lastQ = q;
    if (q.length < 2 || q.length > 40 || !/^[a-z]/i.test(q)) return dismiss();
    debounced(q, ++gen);
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (panel && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      $$('.ac-item', panel).forEach((el, i) => el.classList.toggle('active', i === active));
      $$('.ac-item', panel)[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (panel && active >= 0) {
        e.preventDefault();
        pick(items[active]);
      } else if (onEnter) {
        e.preventDefault();
        dismiss();
        onEnter(input.value.trim());
      }
    } else if (e.key === 'Escape') dismiss();
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
}

/* =====================================================================
   Modal
   ===================================================================== */
const openModals = new Set();
function openModal(html, { onClose } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog">${html}</div>`;
  document.body.appendChild(bg);
  const close = () => {
    if (!openModals.delete(close)) return;
    bg.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  openModals.add(close);
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  bg.addEventListener('mousedown', (e) => {
    if (e.target === bg) close();
  });
  $$('[data-close]', bg).forEach((b) => (b.onclick = close));
  return { el: $('.modal', bg), close };
}

function confirmModal(title, text, okLabel = 'Đồng ý', danger = false) {
  return new Promise((resolve) => {
    let ok = false;
    const m = openModal(
      `<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
       <div class="acts"><button class="btn" data-close>Hủy</button>
       <button class="btn btn-primary" id="okBtn" ${danger ? 'style="background:var(--error)"' : ''}>${esc(okLabel)}</button></div>`,
      { onClose: () => resolve(ok) }
    );
    $('#okBtn', m.el).onclick = () => {
      ok = true;
      m.close();
    };
  });
}

/* ---------- bảng tra từ điển ---------- */
function pronChips(r) {
  const chip = (acc, p) =>
    p.ipa || p.audio
      ? `<span class="ipa-chip"><b>${acc.toUpperCase()}</b>${p.ipa ? ipaLink(p.ipa, r.word) : '<span>—</span>'}
         <button class="icon-btn" data-play="${acc}" title="Nghe giọng ${acc.toUpperCase()}">${I.sound}</button></span>`
      : '';
  return chip('uk', r.uk) + chip('us', r.us);
}
function sourceBadge(source) {
  const names = { cambridge: 'Cambridge Dictionary', wiktionary: 'Wiktionary', datamuse: 'Datamuse', none: 'Không có dữ liệu' };
  return `<span class="src-badge ${source}">${esc(names[source] || source)}</span>`;
}
function bindPronButtons(root, r, word) {
  $$('[data-play]', root).forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const acc = b.dataset.play;
      playTerm({ term: word, audioUk: r.uk.audio, audioUs: r.us.audio }, acc);
    };
  });
}

async function openDictModal(word) {
  if (!word) return;
  const m = openModal(`<p class="muted loading-dots">Đang tra “${esc(word)}”</p>`);
  let r;
  try {
    r = await define(word);
  } catch (err) {
    m.el.innerHTML = `<h2>${esc(word)}</h2><p class="muted">Không tìm thấy từ này (${esc(err.message)}).</p>
      <div class="acts"><button class="btn" data-close>Đóng</button></div>`;
    $('[data-close]', m.el).onclick = m.close;
    return;
  }
  const sets = (await api('/sets').catch(() => [])).filter((s) => s.isOwner);
  const cambridgeUrl = `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(r.word.toLowerCase().replace(/\s+/g, '-'))}`;
  m.el.innerHTML = `
    <div class="dict-head">
      <div><h2>${esc(r.word)}</h2>${sourceBadge(r.source)}
      ${r.source !== 'cambridge' ? '<span class="muted small"> · Cambridge tạm chặn truy cập tự động, đang dùng nguồn dự phòng</span>' : ''}</div>
      <button class="icon-btn" data-close>${I.close}</button>
    </div>
    <div class="dict-prons">${pronChips(r)}</div>
    ${r.vi ? `<div><b>Nghĩa tiếng Việt:</b> <span style="color:var(--success);font-weight:600">${esc(r.vi)}</span></div>` : ''}
    ${
      r.viByPos && Object.keys(r.viByPos).length
        ? `<div class="small muted" style="margin-top:4px">${Object.entries(r.viByPos)
            .map(([p, l]) => `<i>${esc(p)}</i>: ${esc(l.join(', '))}`)
            .join(' · ')}</div>`
        : ''
    }
    ${r.entries
      .map(
        (e) => `<div class="dict-entry"><span class="pos">${esc(e.pos || '')}</span>
        ${e.ipaUk && e.ipaUk !== r.uk.ipa ? `<span class="ipa muted"> ${esc(e.ipaUk)}</span>` : ''}
        ${e.senses
          .map(
            (s) => `<div class="dict-sense">${s.level ? `<span class="pill gray">${esc(s.level)}</span> ` : ''}${esc(s.def)}
              ${s.vi ? `<div class="vi">${esc(s.vi)}</div>` : ''}
              ${s.examples.map((x) => `<div class="ex">• ${esc(x)}</div>`).join('')}</div>`
          )
          .join('')}</div>`
      )
      .join('')}
    <div style="margin-top:12px"><a href="${cambridgeUrl}" target="_blank" rel="noopener" class="small">Xem trên Cambridge Dictionary ↗</a>
    ${r.sourceUrl && r.source !== 'cambridge' ? ` · <a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener" class="small">Nguồn ${esc(r.source)} ↗</a>` : ''}</div>
    ${
      sets.length
        ? `<div class="dict-entry"><b>Thêm vào học phần</b>
      <div class="row wrap" style="margin-top:8px">
        <select class="inp" id="dSet" style="flex:1;min-width:180px">${sets.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join('')}</select>
        <select class="inp" id="dDef" style="flex:1;min-width:180px">
          ${r.vi ? `<option value="vi">Nghĩa: ${esc(r.vi.slice(0, 40))}</option>` : ''}
          ${r.entries[0]?.senses[0] ? `<option value="en">Định nghĩa tiếng Anh</option>` : ''}
        </select>
        <button class="btn btn-primary" id="dAdd">Thêm</button>
      </div></div>`
        : ''
    }`;
  $$('[data-close]', m.el).forEach((b) => (b.onclick = m.close));
  bindPronButtons(m.el, r, r.word);
  const add = $('#dAdd', m.el);
  if (add)
    add.onclick = async () => {
      const sel = $('#dSet', m.el);
      const mode = $('#dDef', m.el).value;
      await api('/sets/' + sel.value + '/terms', { method: 'POST', body: termFromDict(r, mode === 'en' ? r.entries[0].senses[0].def : r.vi) });
      toast(`Đã thêm “${r.word}” vào “${sel.selectedOptions[0].textContent}”`);
      m.close();
    };
}

function termFromDict(r, definition) {
  return {
    term: r.word,
    definition,
    ipaUk: r.uk.ipa || '',
    ipaUs: r.us.ipa || '',
    audioUk: r.uk.audio || '',
    audioUs: r.us.audio || '',
    pos: r.entries[0]?.pos || '',
    example: r.entries[0]?.senses[0]?.examples?.[0] || '',
  };
}

attachAutocomplete($('#globalSearch input'), {
  onPick: (item) => {
    $('#globalSearch input').blur();
    openDictModal(item.word);
  },
  onEnter: (q) => openDictModal(q),
});

/* =====================================================================
   Router
   ===================================================================== */
let cleanup = null;
function onLeave(fn) {
  const prev = cleanup;
  cleanup = () => {
    prev?.();
    fn();
  };
}
const routes = [
  [/^#\/login$/, () => viewLogin()],
  [/^#\/classes$/, () => viewClasses()],
  [/^#\/class\/([\w-]+)$/, (id) => viewClassReport(id)],
  [/^#\/ipa$/, () => viewIpa()],
  [/^#?\/?$/, () => viewHome()],
  [/^#\/library$/, () => viewLibrary()],
  [/^#\/create(\?.*)?$/, () => viewEditor(null)],
  [/^#\/edit\/([\w-]+)$/, (id) => viewEditor(id)],
  [/^#\/set\/([\w-]+)$/, (id) => viewSet(id)],
  [/^#\/set\/([\w-]+)\/(flashcards|learn|test|match|spell)$/, (id, mode) => MODES[mode](id)],
  [/^#\/docs$/, () => viewDocs()],
];
async function route() {
  if (cleanup) {
    const c = cleanup;
    cleanup = null;
    c();
  }
  if (currentAudio) currentAudio.pause();
  for (const close of [...openModals]) close();
  const hash = location.hash || '#/';
  if (!me && hash !== '#/login') {
    location.hash = '#/login';
    return;
  }
  document.body.classList.toggle('logged-out', !me);
  $$('[data-nav]').forEach((a) =>
    a.classList.toggle('active', (a.dataset.nav === 'home' && hash === '#/') || hash.startsWith('#/' + a.dataset.nav))
  );
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      window.scrollTo(0, 0);
      try {
        await fn(...m.slice(1));
      } catch (err) {
        console.error(err);
        app.innerHTML = `<div class="page"><div class="empty"><div class="big">😕</div><h2>${esc(err.message)}</h2><a class="btn" href="#/">Về trang chủ</a></div></div>`;
      }
      return;
    }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', route);

async function loadSet(id) {
  const [set, prog] = await Promise.all([api('/sets/' + id), api('/progress/' + id)]);
  set._prog = prog;
  for (const t of set.terms) t.starred = prog.starred.includes(t.id);
  return set;
}
/** Mở một chế độ học: tải học phần và ghi nhận thời điểm học gần nhất */
async function studySet(id) {
  const set = await loadSet(id);
  patchProg(set, { studied: true });
  return set;
}
function patchProg(set, patch) {
  return api('/progress/' + set.id, { method: 'PATCH', body: patch })
    .then((p) => (set._prog = p))
    .catch((err) => toast('Không lưu được tiến độ: ' + err.message, true));
}
function setCard(s) {
  return `<a class="set-card" href="#/set/${s.id}">
    <h3>${esc(s.title)}</h3>
    <div class="row wrap" style="gap:6px"><span class="pill">${s.termCount} thuật ngữ</span>
      ${s.assignedVia?.length ? `<span class="pill green">Được giao · ${esc(s.assignedVia.join(', '))}</span>` : ''}</div>
    <div class="preview">${esc(s.preview.map((t) => t.term).join(' · '))}</div>
    <div class="foot">${avatar(s.isOwner ? me.name : s.ownerName)} ${s.isOwner ? 'Bạn' : esc(s.ownerName)} · ${new Date(s.updatedAt).toLocaleDateString('vi-VN')}</div>
  </a>`;
}
function avatar(name, size = 24) {
  const colors = ['#4255ff', '#ff725b', '#18ae79', '#ff983a', '#7b61ff', '#e0457b'];
  const n = String(name || '?');
  const c = colors[[...n].reduce((a, ch) => a + ch.charCodeAt(0), 0) % colors.length];
  return `<span class="avatar" style="width:${size}px;height:${size}px;background:${c};font-size:${Math.round(size * 0.45)}px">${esc(n.trim()[0]?.toUpperCase() || '?')}</span>`;
}

/* =====================================================================
   Trang chủ & Thư viện
   ===================================================================== */
const SAMPLE_SET = {
  title: 'Từ vựng IELTS cơ bản',
  description: 'Học phần mẫu – phiên âm theo Cambridge Dictionary',
  terms: [
    ['abandon', 'từ bỏ, bỏ rơi', '/əˈbæn.dən/', '/əˈbæn.dən/', 'verb'],
    ['accurate', 'chính xác', '/ˈæk.jə.rət/', '/ˈæk.jɚ.ət/', 'adjective'],
    ['benefit', 'lợi ích', '/ˈben.ɪ.fɪt/', '/ˈben.ə.fɪt/', 'noun'],
    ['consequence', 'hậu quả', '/ˈkɒn.sɪ.kwəns/', '/ˈkɑːn.sə.kwens/', 'noun'],
    ['determine', 'xác định, quyết định', '/dɪˈtɜː.mɪn/', '/dɪˈtɝː.mɪn/', 'verb'],
    ['environment', 'môi trường', '/ɪnˈvaɪ.rən.mənt/', '/ɪnˈvaɪ.rən.mənt/', 'noun'],
    ['efficient', 'hiệu quả', '/ɪˈfɪʃ.ənt/', '/ɪˈfɪʃ.ənt/', 'adjective'],
    ['significant', 'quan trọng, đáng kể', '/sɪɡˈnɪf.ɪ.kənt/', '/sɪɡˈnɪf.ə.kənt/', 'adjective'],
    ['opportunity', 'cơ hội', '/ˌɒp.əˈtʃuː.nə.ti/', '/ˌɑː.pɚˈtuː.nə.t̬i/', 'noun'],
    ['vocabulary', 'từ vựng', '/vəˈkæb.jə.lər.i/', '/voʊˈkæb.jə.ler.i/', 'noun'],
  ].map(([term, definition, ipaUk, ipaUs, pos]) => ({ term, definition, ipaUk, ipaUs, pos })),
};

async function createSample() {
  const s = await api('/sets', { method: 'POST', body: SAMPLE_SET });
  location.hash = '#/set/' + s.id;
}

async function viewHome() {
  const [sets, classes] = await Promise.all([api('/sets'), api('/classes')]);
  const mine = sets.filter((s) => s.isOwner);
  const assigned = sets.filter((s) => !s.isOwner);
  const isTeacher = me.role === 'teacher';
  const teacherClasses = classes.filter((c) => c.isTeacher);
  app.innerHTML = `<div class="page">
    <div class="hero">
      <div><h1>Xin chào, ${esc(me.name)}! 👋</h1>
      <p>${
        isTeacher
          ? 'Tạo học phần có phiên âm Cambridge và hình ảnh, rồi giao cho lớp của bạn.'
          : 'Học từ vựng với Thẻ ghi nhớ, Học, Kiểm tra, Ghép thẻ — phiên âm UK/US từ Cambridge Dictionary.'
      }</p></div>
      <div class="row wrap"><a class="btn btn-lg" href="#/create">+ Tạo học phần</a>
      <span class="hero-import">${importButton()}</span>
      ${isTeacher ? `<a class="btn btn-lg" href="#/classes" style="background:rgba(255,255,255,.18);color:#fff">${I.users} Lớp học</a>` : ''}</div>
    </div>
    ${
      !isTeacher && !classes.length
        ? `<div class="notice">👩‍🏫 Giáo viên gửi file Excel cho bạn? Bấm <b>Nhập file Excel</b> (hoặc kéo thả file vào đây) là có ngay học phần. Học xong, mở học phần → <b>Xuất Excel → Kết quả học của tôi</b> để gửi lại giáo viên.</div>`
        : ''
    }
    ${
      assigned.length
        ? `<div class="row between"><h2 style="margin:0 0 16px">📌 Được giáo viên giao</h2></div>
           <div class="set-grid">${assigned.map(setCard).join('')}</div>`
        : ''
    }
    ${
      isTeacher && teacherClasses.length
        ? `<h2>Lớp học của bạn</h2><div class="set-grid">${teacherClasses
            .map(
              (c) => `<a class="set-card" href="#/class/${c.id}"><h3>${esc(c.name)}</h3>
              <div class="row wrap" style="gap:6px"><span class="pill">${c.students.length} học sinh</span><span class="pill gray">${c.sets.length} học phần</span></div>
              <div class="preview">Mã lớp: <b>${esc(c.code)}</b></div>
              <div class="foot">Xem tiến độ học sinh →</div></a>`
            )
            .join('')}</div>`
        : ''
    }
    ${
      mine.length
        ? `<div class="row between"><h2>Học phần của bạn</h2><a href="#/library" class="small" style="font-weight:700">Xem tất cả</a></div>
           <div class="set-grid">${mine.slice(0, 6).map(setCard).join('')}</div>`
        : !assigned.length
        ? `<div class="empty" style="margin-top:24px"><div class="big">📚</div><h2>Bạn chưa có học phần nào</h2>
           <p class="muted">Tạo học phần đầu tiên — gõ từ tiếng Anh, Quizzy sẽ gợi ý, tự điền phiên âm và nghĩa tiếng Việt.</p>
           <div class="row" style="justify-content:center;margin-top:16px"><a class="btn btn-primary" href="#/create">Tạo học phần</a>
           <button class="btn" id="sampleBtn">Thêm học phần mẫu</button></div></div>`
        : ''
    }
    <h2>Tra nhanh & luyện phát âm</h2>
    <div class="card" style="padding:20px 24px">
      <p class="muted" style="margin-top:0">Gõ vào ô tìm kiếm phía trên để tra từ: phiên âm UK/US, nghe phát âm, nghĩa tiếng Việt và ví dụ. Bấm vào phiên âm bất kỳ để xem cách đọc từng âm, hoặc mở <a href="#/ipa" style="font-weight:700">Bảng IPA</a>.</p>
      <div class="row wrap">${['beautiful', 'schedule', 'environment', 'thorough', 'pronunciation']
        .map((w) => `<button class="btn btn-sm" data-look="${w}">${w}</button>`)
        .join('')}</div>
    </div>
  </div>`;
  $('#sampleBtn')?.addEventListener('click', createSample);
  $$('[data-look]').forEach((b) => (b.onclick = () => openDictModal(b.dataset.look)));
  bindImport();
}

async function viewLibrary() {
  const sets = await api('/sets');
  let tab = LS.get('libTab', 'mine');
  app.innerHTML = `<div class="page">
    <div class="row between wrap" style="margin-bottom:16px"><h1>Thư viện của bạn</h1>
      <div class="row"><input id="libFilter" class="num-input" style="width:220px" placeholder="Lọc học phần…" />
      <select id="libSort" class="inp" style="width:auto"><option value="recent">Gần đây</option><option value="title">Tên A–Z</option><option value="size">Nhiều thẻ nhất</option></select></div>
    </div>
    <div class="row wrap" style="margin-bottom:16px">${importButton()}
      <button class="btn" id="exportAll" title="Mỗi học phần của bạn là một trang tính">📗 Xuất tất cả ra Excel</button>
      <button class="btn btn-ghost" id="tplBtn" title="File Excel mẫu để soạn thẻ trực tiếp trong Excel">⬇ Tải file mẫu</button>
      <span class="small muted">Mẹo: kéo thả file Excel vào trang để nhập nhanh.</span></div>
    <div class="tabs" id="libTabs" style="margin-bottom:20px"><button data-t="mine">Của tôi (${sets.filter((s) => s.isOwner).length})</button><button data-t="assigned">Được giao (${sets.filter((s) => !s.isOwner).length})</button></div>
    <div id="libGrid"></div></div>`;
  const draw = () => {
    $$('#libTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    const q = norm($('#libFilter').value);
    let list = sets.filter((s) => (tab === 'mine' ? s.isOwner : !s.isOwner) && (!q || norm(s.title + ' ' + s.description).includes(q)));
    const sort = $('#libSort').value;
    if (sort === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'vi'));
    if (sort === 'size') list = [...list].sort((a, b) => b.termCount - a.termCount);
    $('#libGrid').innerHTML = list.length
      ? `<div class="set-grid">${list.map(setCard).join('')}</div>`
      : tab === 'mine'
      ? `<div class="empty"><p class="muted">Không có học phần nào.</p><a class="btn btn-primary" href="#/create">Tạo học phần</a>
         ${sets.some((s) => s.isOwner) ? '' : '<button class="btn" id="sampleBtn">Thêm học phần mẫu</button>'}</div>`
      : `<div class="empty"><p class="muted">Chưa có học phần nào được giao. Tham gia lớp của giáo viên bằng mã lớp trong mục <a href="#/classes">Lớp học</a>.</p></div>`;
    $('#sampleBtn')?.addEventListener('click', createSample);
  };
  $('#libTabs').onclick = (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    tab = b.dataset.t;
    LS.set('libTab', tab);
    draw();
  };
  $('#libFilter').oninput = draw;
  $('#libSort').onchange = draw;
  bindImport();
  $('#tplBtn').onclick = () => downloadFile('/template', 'Mau soan the Quizzy.xlsx').catch((err) => toast(err.message, true));
  $('#exportAll').onclick = async () => {
    if (!sets.some((s) => s.isOwner)) return toast('Bạn chưa có học phần nào để xuất', true);
    try {
      toast('Đã tải xuống: ' + (await downloadFile('/export', 'Quizzy.xlsx')));
    } catch (err) {
      toast(err.message, true);
    }
  };
  draw();
}

/* =====================================================================
   Tạo / sửa học phần
   ===================================================================== */
const blankTerm = () => ({ term: '', definition: '', ipaUk: '', ipaUs: '', audioUk: '', audioUs: '', pos: '', example: '', image: '', imageCredit: '' });

async function viewEditor(id) {
  const editing = Boolean(id);
  let set;
  let restoredDraft = false;
  if (editing) {
    set = await loadSet(id);
    if (!set.isOwner) throw new Error('Chỉ người tạo mới sửa được học phần này');
  } else {
    const draft = LS.get('draft:new:' + me.id, null);
    if (draft && draft.terms?.some((t) => t.term || t.definition)) {
      set = draft;
      restoredDraft = true;
    } else set = { title: '', description: '', terms: [blankTerm(), blankTerm(), blankTerm()] };
  }
  const terms = set.terms.map((t) => ({ ...blankTerm(), ...t, _looked: (t.ipaUk || t.ipaUs) ? t.term.toLowerCase() : '' }));
  let autofill = LS.get('autofill', 'vi');
  const myClasses = me.role === 'teacher' ? (await api('/classes')).filter((c) => c.isTeacher) : [];
  const presetClass = new URLSearchParams(location.hash.split('?')[1] || '').get('class');

  app.innerHTML = `<div class="page page-narrow">
    <div class="editor-head">
      <h1 style="margin:0">${editing ? 'Chỉnh sửa học phần' : 'Tạo học phần mới'}</h1>
      <div class="row">${editing ? `<a class="btn" href="#/set/${id}">Hủy</a>` : ''}
      <button class="btn btn-primary" id="saveBtn">${editing ? 'Lưu' : 'Tạo'}</button></div>
    </div>
    ${restoredDraft ? `<div class="notice" id="draftNote">📝 Đã khôi phục bản nháp chưa lưu. <a href="#" id="discardDraft" style="margin-left:auto;font-weight:700">Bỏ bản nháp</a></div>` : ''}
    <div class="meta-box">
      <div class="field"><input id="fTitle" placeholder='Nhập tiêu đề, ví dụ “Từ vựng IELTS – Chủ đề Môi trường”' value="${esc(set.title)}" /><label>Tiêu đề</label></div>
      <div class="field"><textarea id="fDesc" rows="1" placeholder="Thêm mô tả…">${esc(set.description)}</textarea><label>Mô tả</label></div>
      ${
        me.role === 'teacher'
          ? `<div class="field"><label>Giao cho lớp</label><div class="row wrap" id="classPick" style="margin-top:6px">${
              myClasses.length
                ? myClasses
                    .map(
                      (c) => `<label class="check-pill"><input type="checkbox" value="${c.id}" ${
                        (editing && c.sets.some((x) => x.id === id)) || c.id === presetClass ? 'checked' : ''
                      }> ${esc(c.name)} <span class="muted small">(${c.students.length} HS)</span></label>`
                    )
                    .join('')
                : '<span class="muted small">Bạn chưa có lớp nào. <a href="#/classes">Tạo lớp học</a> để giao bài cho học sinh.</span>'
            }</div></div>`
          : ''
      }
    </div>
    <div class="toolbar">
      <button class="btn btn-sm" id="importBtn">${I.upload} Nhập từ văn bản</button>
      <button class="btn btn-sm" id="fillAllBtn" title="Tra Cambridge cho mọi thẻ chưa có phiên âm">${I.wand} Tự điền phiên âm tất cả</button>
      <button class="btn btn-sm" id="swapBtn" title="Đổi chỗ thuật ngữ và định nghĩa">${I.swap} Đảo thuật ngữ/định nghĩa</button>
      <div class="spacer"></div>
      <label class="small muted">Tự điền định nghĩa:</label>
      <select class="inp" id="autofillSel" style="width:auto;height:32px">
        <option value="vi">Nghĩa tiếng Việt</option><option value="en">Định nghĩa tiếng Anh</option>
        <option value="both">Cả hai</option><option value="none">Không tự điền</option>
      </select>
    </div>
    <div id="rows"></div>
    <button class="add-row-btn" id="addRow"><span>+ Thêm thẻ</span></button>
    <div class="row" style="justify-content:flex-end;margin-top:24px"><button class="btn btn-primary btn-lg" id="saveBtn2">${editing ? 'Lưu thay đổi' : 'Tạo học phần'}</button></div>
  </div>`;

  const titleEl = $('#fTitle');
  const descEl = $('#fDesc');
  $('#autofillSel').value = autofill;
  $('#autofillSel').onchange = (e) => {
    autofill = e.target.value;
    LS.set('autofill', autofill);
  };
  autosize(descEl);
  descEl.oninput = () => {
    autosize(descEl);
    saveDraft();
  };
  titleEl.oninput = () => saveDraft();

  const collect = () => ({
    title: titleEl.value,
    description: descEl.value,
    terms: terms.map(({ _looked, _dict, starred, ...t }) => t),
    ...(me.role === 'teacher' ? { classIds: $$('#classPick input:checked').map((x) => x.value) } : {}),
  });
  const saveDraft = debounce(() => {
    if (!editing) LS.set('draft:new:' + me.id, collect());
  }, 400);
  $('#discardDraft')?.addEventListener('click', (e) => {
    e.preventDefault();
    LS.del('draft:new:' + me.id);
    route();
  });

  const defaultDefinition = (r) => {
    const en = r.entries[0]?.senses[0]?.def || '';
    const vi = r.vi || r.entries.flatMap((e) => e.senses).find((s) => s.vi)?.vi || '';
    if (autofill === 'vi') return vi || en;
    if (autofill === 'en') return en || vi;
    if (autofill === 'both') return [vi, en].filter(Boolean).join('\n');
    return '';
  };

  function renderExtra(row, t, state) {
    const box = $('.term-extra', row);
    if (state === 'loading') {
      box.innerHTML = `<span class="muted small loading-dots">Đang tra Cambridge</span>`;
      return;
    }
    if (state === 'notfound') {
      box.innerHTML = `<span class="muted small">Không tìm thấy phiên âm cho từ này</span>`;
      return;
    }
    const chips = ['uk', 'us']
      .map((acc) => {
        const ipa = acc === 'uk' ? t.ipaUk : t.ipaUs;
        if (!ipa) return '';
        return `<span class="ipa-chip"><b>${acc.toUpperCase()}</b><span class="ipa" data-editipa="${acc}" title="Bấm để sửa phiên âm" style="cursor:text">${esc(ipa)}</span>
          <button class="icon-btn" data-play="${acc}" title="Nghe">${I.sound}</button></span>`;
      })
      .join('');
    box.innerHTML = chips
      ? `${chips}${t.pos ? `<span class="muted small"><i>${esc(t.pos)}</i></span>` : ''}${t._dict ? sourceBadge(t._dict.source) : ''}`
      : t.term.trim() && /^[a-z]/i.test(t.term.trim())
      ? `<button class="btn btn-sm btn-ghost" data-lookup>${I.wand} Tra phiên âm</button>`
      : '';
    $$('[data-play]', box).forEach(
      (b) => (b.onclick = () => playTerm(t, b.dataset.play))
    );
    $$('[data-editipa]', box).forEach(
      (s) =>
        (s.onclick = () => {
          const acc = s.dataset.editipa;
          const key = acc === 'uk' ? 'ipaUk' : 'ipaUs';
          const v = prompt(`Phiên âm ${acc.toUpperCase()} cho “${t.term}”:`, t[key]);
          if (v != null) {
            t[key] = v.trim();
            renderExtra(row, t);
            saveDraft();
          }
        })
    );
    $('[data-lookup]', box)?.addEventListener('click', () => lookupRow(t, row, true));
  }

  function renderDefSuggestions(row, t) {
    const box = $('.suggest-defs', row);
    const r = t._dict;
    if (!r || document.activeElement !== $('.f-def', row)) {
      box.innerHTML = '';
      return;
    }
    const opts = [];
    if (r.vi) opts.push({ pos: 'Tiếng Việt', text: r.vi });
    for (const [pos, list] of Object.entries(r.viByPos || {})) opts.push({ pos, text: list.join(', ') });
    for (const e of r.entries)
      for (const s of e.senses.slice(0, 2)) {
        if (s.vi && r.source === 'cambridge') opts.push({ pos: e.pos, text: s.vi });
        opts.push({ pos: e.pos, text: s.def });
      }
    const uniqOpts = opts.filter((o, i) => o.text && opts.findIndex((x) => x.text === o.text) === i).slice(0, 6);
    box.innerHTML = uniqOpts
      .map((o) => `<button class="def-option" data-text="${esc(o.text)}"><span class="pos">${esc(o.pos)}</span>${esc(o.text)}</button>`)
      .join('');
    $$('.def-option', box).forEach((b) =>
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const ta = $('.f-def', row);
        t.definition = b.dataset.text;
        ta.value = t.definition;
        autosize(ta);
        saveDraft();
      })
    );
  }

  async function lookupRow(t, row, fillDef) {
    const word = t.term.trim();
    if (!word || !/^[a-z]/i.test(word) || word.length > 60) return;
    t._looked = word.toLowerCase();
    renderExtra(row, t, 'loading');
    try {
      const r = await define(word);
      if (t.term.trim().toLowerCase() !== t._looked || !row.isConnected) return;
      if (!r.found) throw new Error('not found');
      Object.assign(t, {
        ipaUk: r.uk.ipa || '',
        ipaUs: r.us.ipa || '',
        audioUk: r.uk.audio || '',
        audioUs: r.us.audio || '',
        pos: r.entries[0]?.pos || '',
        example: r.entries[0]?.senses[0]?.examples?.[0] || '',
        _dict: r,
      });
      if (fillDef && !t.definition.trim()) {
        t.definition = defaultDefinition(r);
        const ta = $('.f-def', row);
        ta.value = t.definition;
        autosize(ta);
      }
      renderExtra(row, t);
      renderDefSuggestions(row, t);
      saveDraft();
    } catch {
      if (row.isConnected) renderExtra(row, t, 'notfound');
    }
  }

  function rowEl(t, i) {
    const row = document.createElement('div');
    row.className = 'term-row';
    row.innerHTML = `
      <div class="term-row-head"><span>${i + 1}</span>
        <div class="row" style="gap:0">
          <button class="icon-btn sm" data-mv="-1" title="Lên">${I.up}</button>
          <button class="icon-btn sm" data-mv="1" title="Xuống">${I.down}</button>
          <button class="icon-btn sm" data-del title="Xóa thẻ">${I.trash}</button>
        </div>
      </div>
      <div class="term-row-body">
        <div class="field">
          <input class="f-term" placeholder="Nhập thuật ngữ (gõ để xem gợi ý)" autocomplete="off" spellcheck="false" value="${esc(t.term)}" />
          <label>Thuật ngữ</label>
          <div class="term-extra"></div>
        </div>
        <div class="field">
          <textarea class="f-def" rows="1" placeholder="Nhập định nghĩa">${esc(t.definition)}</textarea>
          <label>Định nghĩa</label>
          <div class="suggest-defs"></div>
        </div>
        <div class="img-slot" title="Thêm ảnh minh họa (hoặc dán ảnh vào ô định nghĩa)"></div>
      </div>`;
    const inp = $('.f-term', row);
    const ta = $('.f-def', row);
    const slot = $('.img-slot', row);
    const drawImg = () => {
      slot.innerHTML = t.image
        ? `<img src="${esc(t.image)}" alt=""><button class="img-remove" title="Xóa ảnh">${I.close}</button>`
        : `${I.image}<span>Ảnh</span>`;
      slot.classList.toggle('has', Boolean(t.image));
    };
    drawImg();
    slot.onclick = (e) => {
      if (e.target.closest('.img-remove')) {
        t.image = '';
        t.imageCredit = '';
        drawImg();
        saveDraft();
        return;
      }
      openImagePicker(t.term || t.definition, (url, credit) => {
        t.image = url;
        t.imageCredit = credit || '';
        drawImg();
        saveDraft();
      });
    };
    ta.addEventListener('paste', async (e) => {
      const file = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      try {
        toast('Đang tải ảnh lên…');
        t.image = await uploadImage(file);
        t.imageCredit = '';
        drawImg();
        saveDraft();
      } catch (err) {
        toast(err.message, true);
      }
    });
    inp.addEventListener('input', () => {
      t.term = inp.value;
      if (t._looked && t.term.trim().toLowerCase() !== t._looked) {
        Object.assign(t, { ipaUk: '', ipaUs: '', audioUk: '', audioUs: '', pos: '', example: '', _dict: null, _looked: '' });
        $('.term-extra', row).innerHTML = '';
      }
      saveDraft();
    });
    attachAutocomplete(inp, {
      onPick: () => {
        lookupRow(t, row, true);
        ta.focus();
      },
    });
    inp.addEventListener('blur', () => {
      setTimeout(() => {
        const w = t.term.trim().toLowerCase();
        if (w && w !== t._looked) lookupRow(t, row, true);
      }, 150);
    });
    ta.addEventListener('input', () => {
      t.definition = ta.value;
      autosize(ta);
      saveDraft();
    });
    ta.addEventListener('focus', () => {
      if (!t._dict && t.term.trim() && (t.ipaUk || t.ipaUs)) {
        define(t.term).then((r) => {
          t._dict = r;
          renderDefSuggestions(row, t);
        }).catch(() => {});
      }
      renderDefSuggestions(row, t);
    });
    ta.addEventListener('blur', () => setTimeout(() => renderDefSuggestions(row, t), 100));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey && i === terms.length - 1) {
        e.preventDefault();
        terms.push(blankTerm());
        drawRows();
        $$('.f-term')[terms.length - 1].focus();
      }
    });
    $('[data-del]', row).onclick = () => {
      if (terms.length <= 2) return toast('Học phần cần ít nhất 2 thẻ', true);
      terms.splice(terms.indexOf(t), 1);
      drawRows();
      saveDraft();
    };
    $$('[data-mv]', row).forEach(
      (b) =>
        (b.onclick = () => {
          const from = terms.indexOf(t);
          const to = from + +b.dataset.mv;
          if (to < 0 || to >= terms.length) return;
          [terms[from], terms[to]] = [terms[to], terms[from]];
          drawRows();
          saveDraft();
        })
    );
    requestAnimationFrame(() => autosize(ta));
    renderExtra(row, t);
    return row;
  }

  function drawRows() {
    const box = $('#rows');
    box.innerHTML = '';
    terms.forEach((t, i) => box.appendChild(rowEl(t, i)));
  }
  drawRows();

  $('#addRow').onclick = () => {
    terms.push(blankTerm());
    drawRows();
    $$('.f-term')[terms.length - 1].focus();
  };
  $('#swapBtn').onclick = () => {
    for (const t of terms) {
      [t.term, t.definition] = [t.definition, t.term];
      Object.assign(t, { ipaUk: '', ipaUs: '', audioUk: '', audioUs: '', pos: '', example: '', _dict: null, _looked: '' });
    }
    drawRows();
    saveDraft();
  };

  async function fillAll(onlyMissing = true) {
    const rows = $$('.term-row');
    const todo = terms
      .map((t, i) => ({ t, row: rows[i] }))
      .filter(({ t }) => t.term.trim() && /^[a-z]/i.test(t.term.trim()) && (!onlyMissing || !(t.ipaUk || t.ipaUs)));
    if (!todo.length) return toast('Tất cả thẻ đã có phiên âm');
    toast(`Đang tra ${todo.length} từ…`);
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const { t, row } = todo[i++];
        await lookupRow(t, row, true);
        await sleep(120);
      }
    };
    await Promise.all([worker(), worker()]);
    toast('Đã điền xong phiên âm');
  }
  $('#fillAllBtn').onclick = () => fillAll();

  $('#importBtn').onclick = () => {
    const m = openModal(`
      <h2>Nhập dữ liệu</h2>
      <p class="muted small">Dán dữ liệu từ Word, Excel, Google Docs… Mỗi thẻ một dòng. Có thể chỉ dán danh sách từ tiếng Anh — Quizzy sẽ tự tra nghĩa và phiên âm.</p>
      <textarea id="impText" placeholder="abandon\ttừ bỏ\nbenefit\tlợi ích\nconsequence"></textarea>
      <div class="row wrap" style="margin-top:12px;gap:20px">
        <div><b class="small">Giữa thuật ngữ và định nghĩa</b><br>
          <label class="small"><input type="radio" name="sep" value="tab" checked> Tab</label>
          <label class="small"><input type="radio" name="sep" value="comma"> Dấu phẩy</label>
          <label class="small"><input type="radio" name="sep" value="dash"> Gạch “ - ”</label>
          <label class="small"><input type="radio" name="sep" value="colon"> Dấu “:”</label></div>
        <div><b class="small">Giữa các thẻ</b><br>
          <label class="small"><input type="radio" name="csep" value="nl" checked> Dòng mới</label>
          <label class="small"><input type="radio" name="csep" value="semi"> Dấu chấm phẩy</label></div>
      </div>
      <label class="switch" style="margin-top:12px"><input type="checkbox" id="impLook" checked><span class="tr"></span>Tự tra phiên âm & nghĩa từ Cambridge</label>
      <p class="small muted" id="impCount">0 thẻ</p>
      <div class="acts"><button class="btn" data-close>Hủy</button><button class="btn btn-primary" id="impOk">Nhập</button></div>`);
    const parse = () => {
      const text = $('#impText', m.el).value;
      const sep = { tab: '\t', comma: ',', dash: ' - ', colon: ':' }[$('input[name=sep]:checked', m.el).value];
      const cards = $('input[name=csep]:checked', m.el).value === 'nl' ? text.split(/\r?\n/) : text.split(';');
      return cards
        .map((line) => {
          const i = line.indexOf(sep);
          return i < 0 ? { term: line.trim(), definition: '' } : { term: line.slice(0, i).trim(), definition: line.slice(i + sep.length).trim() };
        })
        .filter((c) => c.term || c.definition);
    };
    const upd = () => ($('#impCount', m.el).textContent = `${parse().length} thẻ`);
    $('#impText', m.el).oninput = upd;
    $$('input[type=radio]', m.el).forEach((r) => (r.onchange = upd));
    $('#impOk', m.el).onclick = () => {
      const cards = parse();
      if (!cards.length) return toast('Chưa có dữ liệu', true);
      const look = $('#impLook', m.el).checked;
      // Bỏ các thẻ trống ở cuối trước khi nhập
      while (terms.length && !terms[terms.length - 1].term && !terms[terms.length - 1].definition) terms.pop();
      for (const c of cards) terms.push({ ...blankTerm(), ...c, _looked: look ? '' : c.term.toLowerCase() });
      drawRows();
      saveDraft();
      m.close();
      toast(`Đã nhập ${cards.length} thẻ`);
      if (look) fillAll();
    };
  };

  const save = async () => {
    const data = collect();
    data.terms = data.terms.filter((t) => t.term.trim() || t.definition.trim());
    if (!data.title.trim()) {
      titleEl.focus();
      return toast('Hãy nhập tiêu đề', true);
    }
    if (data.terms.length < 2) return toast('Học phần cần ít nhất 2 thẻ', true);
    if (data.terms.some((t) => !t.term.trim() || !t.definition.trim()))
      return toast('Một số thẻ còn thiếu thuật ngữ hoặc định nghĩa', true);
    const s = editing ? await api('/sets/' + id, { method: 'PUT', body: data }) : await api('/sets', { method: 'POST', body: data });
    if (!editing) LS.del('draft:new:' + me.id);
    toast(editing ? 'Đã lưu' : 'Đã tạo học phần');
    location.hash = '#/set/' + s.id;
  };
  $('#saveBtn').onclick = save;
  $('#saveBtn2').onclick = save;
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  };
  document.addEventListener('keydown', onKey);
  onLeave(() => document.removeEventListener('keydown', onKey));
}

/* ---------- chọn ảnh minh họa ---------- */
function openImagePicker(query, onPick) {
  const m = openModal(`<div class="dict-head"><h2>Chọn ảnh minh họa</h2><button class="icon-btn" data-close>${I.close}</button></div>
    <div class="tabs" id="imgTabs" style="margin:12px 0"><button class="on" data-t="search">Tìm ảnh</button><button data-t="upload">Tải lên từ máy</button><button data-t="url">Dán đường dẫn</button></div>
    <div data-p="search">
      <div class="write-row"><input id="imgQ" placeholder="Tìm ảnh, ví dụ: apple" value="${esc(query)}"><button class="btn btn-primary btn-lg" id="imgGo">Tìm</button></div>
      <div id="imgRes" class="img-grid"></div>
      <p class="small muted">Ảnh miễn phí từ Openverse / Wikimedia Commons (giấy phép Creative Commons). Ảnh được lưu về máy chủ của bạn.</p>
    </div>
    <div data-p="upload" class="hidden">
      <label class="drop-zone" id="drop"><input type="file" accept="image/*" id="imgFile" hidden>${I.upload}<b>Chọn ảnh hoặc kéo thả vào đây</b><span class="small muted">JPG, PNG, GIF, WEBP – tối đa 6 MB. Mẹo: bạn cũng có thể dán ảnh (Ctrl+V) trực tiếp vào ô định nghĩa.</span></label>
    </div>
    <div data-p="url" class="hidden">
      <div class="write-row"><input id="imgUrl" placeholder="https://…/anh.jpg"><button class="btn btn-primary btn-lg" id="imgUrlGo">Dùng ảnh</button></div>
    </div>`);
  const el = m.el;
  const done = (url, credit) => {
    onPick(url, credit);
    m.close();
  };
  $('#imgTabs', el).onclick = (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    $$('#imgTabs button', el).forEach((x) => x.classList.toggle('on', x === b));
    $$('[data-p]', el).forEach((p) => p.classList.toggle('hidden', p.dataset.p !== b.dataset.t));
  };
  const importUrl = async (urls, credit) => {
    let last = null;
    for (const url of urls.filter(Boolean)) {
      try {
        const r = await api('/images/import', { method: 'POST', body: { url } });
        return done(r.url, credit);
      } catch (err) {
        last = err;
      }
    }
    toast(last?.message || 'Không tải được ảnh', true);
  };
  let results = [];
  const search = async () => {
    const q = $('#imgQ', el).value.trim();
    if (!q) return;
    const box = $('#imgRes', el);
    box.innerHTML = '<p class="muted loading-dots">Đang tìm ảnh</p>';
    try {
      const r = await api('/images/search?q=' + encodeURIComponent(q));
      results = r.items;
      box.innerHTML = results.length
        ? results.map((x, i) => `<button class="img-opt" data-i="${i}" title="${esc(x.title + ' — ' + x.credit)}"><img src="${esc(x.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join('')
        : '<p class="muted">Không tìm thấy ảnh nào.</p>';
    } catch (err) {
      box.innerHTML = `<p class="muted">Lỗi tìm ảnh: ${esc(err.message)}</p>`;
    }
  };
  $('#imgRes', el).onclick = (e) => {
    const b = e.target.closest('.img-opt');
    if (!b) return;
    const x = results[+b.dataset.i];
    b.classList.add('loading');
    importUrl([x.thumb, x.url], x.credit);
  };
  $('#imgGo', el).onclick = search;
  $('#imgQ', el).onkeydown = (e) => e.key === 'Enter' && search();
  const takeFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return toast('Hãy chọn một tệp ảnh', true);
    try {
      toast('Đang tải ảnh lên…');
      done(await uploadImage(file), '');
    } catch (err) {
      toast(err.message, true);
    }
  };
  $('#imgFile', el).onchange = (e) => takeFile(e.target.files[0]);
  const drop = $('#drop', el);
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add('over');
  };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    takeFile(e.dataTransfer.files[0]);
  };
  $('#imgUrlGo', el).onclick = () => importUrl([$('#imgUrl', el).value.trim()], '');
  if (query.trim()) search();
}

/* ---------- giáo viên giao học phần cho lớp ---------- */
async function openAssignModal(set) {
  const classes = (await api('/classes')).filter((c) => c.isTeacher);
  const m = openModal(`<h2>Giao “${esc(set.title)}” cho lớp</h2>
    ${
      classes.length
        ? `<p class="muted small">Học sinh trong lớp sẽ thấy học phần này trong mục “Được giao” và có thể học ngay.</p>
           <div class="settings-grid" style="margin-top:12px">${classes
             .map((c) => `<label class="line"><span><b>${esc(c.name)}</b> <span class="muted small">· ${c.students.length} học sinh</span></span>
               <span class="switch"><input type="checkbox" value="${c.id}" ${c.sets.some((x) => x.id === set.id) ? 'checked' : ''}><span class="tr"></span></span></label>`)
             .join('')}</div>`
        : '<p class="muted">Bạn chưa có lớp học nào. Hãy tạo lớp trước.</p>'
    }
    <div class="acts">${classes.length ? '' : '<a class="btn" href="#/classes" data-close>Tạo lớp học</a>'}<button class="btn btn-primary" id="asOk">${classes.length ? 'Lưu' : 'Đóng'}</button></div>`);
  $('#asOk', m.el).onclick = async () => {
    for (const c of classes) {
      const want = $(`input[value="${c.id}"]`, m.el).checked;
      const has = c.sets.some((x) => x.id === set.id);
      if (want === has) continue;
      const setIds = want ? [...c.sets.map((x) => x.id), set.id] : c.sets.map((x) => x.id).filter((x) => x !== set.id);
      await api('/classes/' + c.id, { method: 'PUT', body: { setIds } });
    }
    if (classes.length) toast('Đã cập nhật lớp được giao');
    m.close();
    if (classes.length) route();
  };
}

/* =====================================================================
   Trang học phần
   ===================================================================== */
const MODE_LIST = [
  ['flashcards', 'Thẻ ghi nhớ', I.cards],
  ['learn', 'Học', I.learn],
  ['test', 'Kiểm tra', I.test],
  ['match', 'Ghép thẻ', I.match],
  ['spell', 'Chính tả', I.spell],
];

async function toggleStar(set, t) {
  t.starred = !t.starred;
  await patchProg(set, { starred: set.terms.filter((x) => x.starred).map((x) => x.id) });
}

function faceHTML(t, side, label) {
  const isTerm = side === 'term';
  const text = isTerm ? t.term : t.definition;
  const ipa = isTerm ? ipaOf(t) : '';
  return `<div class="corner l">${esc(label)}</div>
    <div class="corner r">
      <button class="icon-btn" data-act="audio" data-side="${side}" title="Phát âm">${I.sound}</button>
      <button class="icon-btn ${t.starred ? 'on' : ''}" data-act="star" title="Gắn sao">${t.starred ? I.starFill : I.star}</button>
    </div>
    ${!isTerm ? imgTag(t, 'face-img') : ''}
    <div class="content ${text.length > 90 ? 'long' : ''} ${!isTerm && t.image ? 'with-img' : ''}">${esc(text)}</div>
    ${ipa ? `<div class="sub">${ipaLink(ipa, t.term)}</div>` : ''}
    ${!isTerm && t.example ? `<div class="sub small" style="font-style:italic;font-size:14px">“${esc(t.example)}”</div>` : ''}`;
}

function learnStats(set) {
  const prog = set._prog.learn;
  let mastered = 0;
  let familiar = 0;
  for (const t of set.terms) {
    const l = prog[t.id] || 0;
    if (l >= 2) mastered++;
    else if (l === 1) familiar++;
  }
  return { mastered, familiar, fresh: set.terms.length - mastered - familiar };
}

async function viewSet(id) {
  const set = await loadSet(id);
  let tab = 'all';
  let idx = 0;
  let flipped = false;

  app.innerHTML = `<div class="page">
    <div class="row between wrap"><div><h1>${esc(set.title)}</h1>
      ${set.description ? `<p class="muted" style="margin:0">${esc(set.description)}</p>` : ''}</div>
      <div class="row wrap">
        ${set.isOwner && me.role === 'teacher' ? `<button class="btn btn-sm btn-primary" id="assignBtn">${I.users} Giao cho lớp</button>` : ''}
        ${set.isOwner ? `<a class="btn btn-sm" href="#/edit/${id}">${I.edit} Sửa</a>` : `<button class="btn btn-sm" id="copyBtn">${I.copy} Lưu bản sao</button>`}
        <button class="btn btn-sm" id="exportBtn">📗 Xuất Excel</button>
        ${set.isOwner ? `<button class="btn btn-sm btn-danger" id="delBtn" title="Xóa học phần">${I.trash}</button>` : ''}
      </div></div>
    <div class="modes">${MODE_LIST.map(
      ([k, label, icon]) => `<a class="mode-btn" href="#/set/${id}/${k}"><span class="mi">${icon}</span>${label}</a>`
    ).join('')}</div>
    <div class="flash-wrap"><div class="flashcard" id="pv"><div class="face front"></div><div class="face back"></div></div></div>
    <div class="flash-controls">
      <button class="round-btn" id="pvPrev">${I.prev}</button>
      <span class="counter" id="pvCount"></span>
      <button class="round-btn" id="pvNext">${I.next}</button>
    </div>
    <div class="row wrap" style="margin-top:28px;gap:12px">${avatar(set.ownerName, 40)}
      <div><div class="small muted">Tạo bởi</div><b>${set.isOwner ? 'Bạn' : esc(set.ownerName)}</b></div>
      ${set.assignedVia?.length ? `<span class="pill green">Được giao qua lớp: ${esc(set.assignedVia.join(', '))}</span>` : ''}</div>
    <h2>Tiến độ học</h2>
    <div id="stats"></div>
    <div class="row between wrap"><h2>Thuật ngữ trong học phần này (${set.terms.length})</h2>
      <div class="tabs" id="tabs"><button data-tab="all" class="on">Tất cả</button><button data-tab="starred">Gắn sao</button></div></div>
    <div class="term-list" id="termList"></div>
    ${set.isOwner ? `<div class="row" style="justify-content:center;margin-top:24px"><a class="btn btn-primary btn-lg" href="#/edit/${id}">Thêm hoặc xóa thuật ngữ</a></div>` : ''}
  </div>`;

  const pv = $('#pv');
  const drawPreview = () => {
    const t = set.terms[idx];
    pv.classList.add('no-anim');
    pv.classList.toggle('flipped', flipped);
    $('.front', pv).innerHTML = faceHTML(t, 'term', 'Thuật ngữ');
    $('.back', pv).innerHTML = faceHTML(t, 'def', 'Định nghĩa');
    $('#pvCount').textContent = `${idx + 1} / ${set.terms.length}`;
    $('#pvPrev').disabled = idx === 0;
    $('#pvNext').disabled = idx === set.terms.length - 1;
    requestAnimationFrame(() => pv.classList.remove('no-anim'));
  };
  pv.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    const t = set.terms[idx];
    if (b?.dataset.act === 'audio') return b.dataset.side === 'term' ? playTerm(t) : playText(t.definition);
    if (b?.dataset.act === 'star') {
      await toggleStar(set, t);
      drawPreview();
      drawList();
      return;
    }
    flipped = !flipped;
    pv.classList.toggle('flipped', flipped);
  };
  const go = (d) => {
    const n = idx + d;
    if (n < 0 || n >= set.terms.length) return;
    idx = n;
    flipped = false;
    drawPreview();
  };
  $('#pvPrev').onclick = () => go(-1);
  $('#pvNext').onclick = () => go(1);

  const st = learnStats(set);
  $('#stats').innerHTML = `<div class="card" style="padding:18px 20px">
    <div class="progress-sum"><span class="pill gray">Chưa học: ${st.fresh}</span><span class="pill orange">Đang học: ${st.familiar}</span><span class="pill green">Đã thuộc: ${st.mastered}</span></div>
    <div class="seg-bar"><div class="s2" style="width:${(st.mastered / set.terms.length) * 100}%"></div><div class="s1" style="width:${(st.familiar / set.terms.length) * 100}%"></div></div>
  </div>`;

  const drawList = () => {
    const list = tab === 'starred' ? set.terms.filter((t) => t.starred) : set.terms;
    $('#tabs [data-tab=starred]').textContent = `Gắn sao (${set.terms.filter((t) => t.starred).length})`;
    $('#termList').innerHTML = list.length
      ? list
          .map(
            (t) => `<div class="term-item" data-id="${t.id}">
          <div class="t">${esc(t.term)}${ipaOf(t) ? `<span class="sub-ipa">${ipaLink(ipaOf(t), t.term)}${t.pos ? ` · <i>${esc(t.pos)}</i>` : ''}</span>` : ''}</div>
          <div class="d">${t.image ? `<img class="thumb" src="${esc(t.image)}" alt="" loading="lazy">` : ''}<span>${esc(t.definition)}</span></div>
          <div class="acts">
            <button class="icon-btn ${t.starred ? 'on' : ''}" data-act="star" title="Gắn sao">${t.starred ? I.starFill : I.star}</button>
            <button class="icon-btn" data-act="audio" title="Phát âm">${I.sound}</button>
            <button class="icon-btn" data-act="dict" title="Tra từ điển">${I.book}</button>
          </div></div>`
          )
          .join('')
      : `<div class="empty"><p class="muted">Chưa có thuật ngữ nào được gắn sao. Bấm ☆ để gắn sao những từ khó.</p></div>`;
  };
  $('#termList').onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const t = set.terms.find((x) => x.id === b.closest('.term-item').dataset.id);
    if (b.dataset.act === 'audio') playTerm(t);
    if (b.dataset.act === 'dict') openDictModal(t.term);
    if (b.dataset.act === 'star') {
      await toggleStar(set, t);
      drawList();
      drawPreview();
    }
  };
  $('#tabs').onclick = (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    drawList();
  };
  $('#delBtn')?.addEventListener('click', async () => {
    if (!(await confirmModal('Xóa học phần?', `“${set.title}” sẽ bị xóa vĩnh viễn (cả với học sinh được giao).`, 'Xóa', true))) return;
    await api('/sets/' + id, { method: 'DELETE' });
    toast('Đã xóa học phần');
    location.hash = '#/library';
  });
  $('#copyBtn')?.addEventListener('click', async () => {
    const s = await api(`/sets/${id}/copy`, { method: 'POST' });
    toast('Đã lưu bản sao vào thư viện của bạn');
    location.hash = '#/set/' + s.id;
  });
  $('#assignBtn')?.addEventListener('click', () => openAssignModal(set));
  $('#exportBtn').onclick = () => {
    const text = set.terms.map((t) => `${t.term}\t${t.definition.replace(/\n/g, ' ')}`).join('\n');
    const m = openModal(`<div class="dict-head"><h2>Xuất / chia sẻ</h2><button class="icon-btn" data-close>${I.close}</button></div>
      <div class="export-opts">
        <button class="export-opt" id="xXlsx"><span class="xi">📗</span><span><b>File Excel học phần (.xlsx)</b>
          <small>Gồm thuật ngữ, định nghĩa, phiên âm UK/US, từ loại, ví dụ và hình ảnh. Gửi file này qua Zalo/email, người nhận bấm “Nhập file Excel” là có ngay học phần. Có thể mở và sửa bằng Excel.</small></span></button>
        <button class="export-opt" id="xResult"><span class="xi">📊</span><span><b>Kết quả học của tôi (.xlsx)</b>
          <small>Số thẻ đã thuộc / đang học, điểm kiểm tra, từ gắn sao… Gửi cho giáo viên, mở bằng Excel là xem được.</small></span></button>
      </div>
      <details style="margin-top:14px"><summary class="small muted" style="cursor:pointer">Hoặc sao chép dạng văn bản (thuật ngữ [Tab] định nghĩa)</summary>
        <textarea readonly style="margin-top:8px">${esc(text)}</textarea>
        <div class="acts"><button class="btn btn-primary" id="cpy">Sao chép</button></div></details>`);
    const dl = async (btn, path, name) => {
      btn.classList.add('loading');
      try {
        toast('Đã tải xuống: ' + (await downloadFile(path, name)));
      } catch (err) {
        toast(err.message, true);
      }
      btn.classList.remove('loading');
    };
    $('#xXlsx', m.el).onclick = (e) => dl(e.currentTarget, `/sets/${id}/export`, set.title + '.xlsx');
    $('#xResult', m.el).onclick = (e) => dl(e.currentTarget, `/progress/${id}/export`, 'Ket qua.xlsx');
    $('#cpy', m.el).onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast('Đã sao chép');
      } catch {
        $('textarea', m.el).select();
        toast('Hãy nhấn Ctrl+C để sao chép', true);
      }
    };
  };

  const onKey = (e) => {
    if (e.target.closest('input, textarea, select') || $('.modal-bg')) return;
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === ' ') {
      e.preventDefault();
      flipped = !flipped;
      pv.classList.toggle('flipped', flipped);
    }
  };
  document.addEventListener('keydown', onKey);
  onLeave(() => document.removeEventListener('keydown', onKey));

  drawPreview();
  drawList();
}

function studyHeader(set, modeKey, extra = '') {
  const [, label, icon] = MODE_LIST.find((m) => m[0] === modeKey);
  return `<div class="study-top">
    <div class="row"><span class="mode-btn" style="padding:6px 12px;box-shadow:none;background:transparent"><span class="mi">${icon}</span>${label}</span>
      <span class="muted hide-sm">${esc(set.title)}</span></div>
    <div class="row">${extra}<a class="icon-btn" href="#/set/${set.id}" title="Đóng">${I.close}</a></div>
  </div>`;
}

/* =====================================================================
   Chế độ: Thẻ ghi nhớ
   ===================================================================== */
async function viewFlashcards(id) {
  const set = await studySet(id);
  const key = 'fc:' + id;
  const opts = { shuffle: false, starred: false, front: 'term', track: false, ...LS.get(key, {}) };
  let deck = [];
  let idx = 0;
  let flipped = false;
  let known = new Set();
  let learning = new Set();
  let auto = null;
  let finished = false;

  const build = (subset) => {
    let list = subset || (opts.starred ? set.terms.filter((t) => t.starred) : set.terms);
    if (!list.length) {
      list = set.terms;
      if (opts.starred) toast('Chưa có thẻ gắn sao — hiển thị tất cả', true);
    }
    deck = opts.shuffle ? shuffle(list) : [...list];
    idx = 0;
    flipped = false;
    finished = false;
    known = new Set();
    learning = new Set();
  };
  build();

  const stopAuto = () => {
    clearInterval(auto);
    auto = null;
  };
  onLeave(stopAuto);

  const render = () => {
    const frontSide = opts.front === 'term' ? 'term' : 'def';
    const backSide = frontSide === 'term' ? 'def' : 'term';
    const labels = { term: 'Thuật ngữ', def: 'Định nghĩa' };
    if (finished) {
      app.innerHTML = `<div class="page page-narrow">${studyHeader(set, 'flashcards')}
        <div class="q-card center-box">
          <div class="big" style="font-size:56px">🎉</div>
          <h1>${opts.track ? 'Làm tốt lắm!' : 'Bạn đã xem hết các thẻ!'}</h1>
          ${
            opts.track
              ? `<p class="muted">Đã biết <b style="color:var(--success)">${known.size}</b> · Đang học <b style="color:var(--warn)">${learning.size}</b></p>`
              : ''
          }
          <div class="row wrap" style="justify-content:center;margin-top:20px">
            ${opts.track && learning.size ? `<button class="btn btn-primary" id="again">Ôn tiếp ${learning.size} thẻ đang học</button>` : ''}
            <button class="btn ${opts.track && learning.size ? '' : 'btn-primary'}" id="restart">Bắt đầu lại</button>
            <a class="btn" href="#/set/${id}/learn">Chuyển sang chế độ Học</a>
          </div>
        </div></div>`;
      $('#restart').onclick = () => {
        build();
        render();
      };
      $('#again')?.addEventListener('click', () => {
        const subset = deck.filter((t) => learning.has(t.id));
        build(subset);
        render();
      });
      return;
    }
    const t = deck[idx];
    app.innerHTML = `<div class="page page-narrow">
      ${studyHeader(set, 'flashcards', `<button class="icon-btn" id="settingsBtn" title="Tùy chọn">${I.gear}</button>`)}
      ${
        opts.track
          ? `<div class="track-counts"><span class="l">Đang học: ${learning.size}</span><span class="k">Đã biết: ${known.size}</span></div>`
          : ''
      }
      <div class="bar" style="margin-bottom:16px"><div style="width:${((idx + (opts.track ? 0 : 1)) / deck.length) * 100}%"></div></div>
      <div class="flash-wrap"><div class="flashcard no-anim ${flipped ? 'flipped' : ''}" id="card">
        <div class="face front">${faceHTML(t, frontSide, labels[frontSide])}<div class="hint">Bấm vào thẻ để lật · Phím cách</div></div>
        <div class="face back">${faceHTML(t, backSide, labels[backSide])}</div>
      </div></div>
      <div class="flash-controls">
        ${
          opts.track
            ? `<button class="round-btn learning" id="btnLearning" title="Đang học (←)">${I.x}</button>
               <span class="counter">${idx + 1} / ${deck.length}</span>
               <button class="round-btn know" id="btnKnow" title="Đã biết (→)">${I.check}</button>`
            : `<button class="round-btn" id="btnPrev" ${idx === 0 ? 'disabled' : ''} title="Trước (←)">${I.prev}</button>
               <span class="counter">${idx + 1} / ${deck.length}</span>
               <button class="round-btn" id="btnNext" title="Tiếp (→)">${I.next}</button>`
        }
      </div>
      <div class="flash-options">
        <label class="switch"><input type="checkbox" id="optTrack" ${opts.track ? 'checked' : ''}><span class="tr"></span>Theo dõi tiến độ</label>
        <div class="row">
          <button class="icon-btn ${auto ? 'on' : ''}" id="btnAuto" title="Tự động phát">${auto ? I.pause : I.play}</button>
          <button class="icon-btn ${opts.shuffle ? 'on' : ''}" id="btnShuffle" title="Trộn thẻ" style="${opts.shuffle ? 'color:var(--primary)' : ''}">${I.shuffle}</button>
        </div>
      </div>
    </div>`;
    const card = $('#card');
    requestAnimationFrame(() => card.classList.remove('no-anim'));
    card.onclick = async (e) => {
      const b = e.target.closest('[data-act]');
      if (b?.dataset.act === 'audio') return b.dataset.side === 'term' ? playTerm(t) : playText(t.definition);
      if (b?.dataset.act === 'star') {
        await toggleStar(set, t);
        return render();
      }
      flip();
    };
    $('#btnPrev')?.addEventListener('click', () => go(-1));
    $('#btnNext')?.addEventListener('click', () => go(1));
    $('#btnKnow')?.addEventListener('click', () => mark(true));
    $('#btnLearning')?.addEventListener('click', () => mark(false));
    $('#optTrack').onchange = (e) => {
      opts.track = e.target.checked;
      LS.set(key, opts);
      build();
      render();
    };
    $('#btnShuffle').onclick = () => {
      opts.shuffle = !opts.shuffle;
      LS.set(key, opts);
      build();
      render();
      toast(opts.shuffle ? 'Đã trộn thẻ' : 'Đã tắt trộn thẻ');
    };
    $('#btnAuto').onclick = () => {
      if (auto) stopAuto();
      else {
        auto = setInterval(() => {
          if (!flipped) flip();
          else if (idx < deck.length - 1) go(1);
          else {
            stopAuto();
            render();
          }
        }, 3000);
        if (frontSide === 'term') playTerm(deck[idx]);
      }
      render();
    };
    $('#settingsBtn').onclick = () => {
      const m = openModal(`<h2>Tùy chọn</h2>
        <div class="settings-grid" style="margin-top:16px">
          <div class="line"><b>Mặt trước</b><select class="inp" id="sFront" style="width:auto">
            <option value="term">Thuật ngữ</option><option value="def">Định nghĩa</option></select></div>
          <div class="line"><b>Chỉ học thẻ gắn sao</b><label class="switch"><input type="checkbox" id="sStar" ${opts.starred ? 'checked' : ''}><span class="tr"></span></label></div>
          <div class="line"><b>Trộn thẻ</b><label class="switch"><input type="checkbox" id="sShuf" ${opts.shuffle ? 'checked' : ''}><span class="tr"></span></label></div>
        </div>
        <p class="small muted">Phím tắt: Space lật thẻ · ← → chuyển thẻ · S gắn sao · P phát âm</p>
        <div class="acts"><button class="btn btn-primary" id="sOk">Xong</button></div>`);
      $('#sFront', m.el).value = opts.front;
      $('#sOk', m.el).onclick = () => {
        opts.front = $('#sFront', m.el).value;
        opts.starred = $('#sStar', m.el).checked;
        opts.shuffle = $('#sShuf', m.el).checked;
        LS.set(key, opts);
        m.close();
        build();
        render();
      };
    };
  };

  const flip = () => {
    flipped = !flipped;
    $('#card')?.classList.toggle('flipped', flipped);
  };
  const go = (d) => {
    if (d > 0 && idx === deck.length - 1) {
      finished = true;
      stopAuto();
      return render();
    }
    const n = idx + d;
    if (n < 0) return;
    idx = n;
    flipped = false;
    render();
    if (auto && opts.front === 'term') playTerm(deck[idx]);
  };
  const mark = (didKnow) => {
    const t = deck[idx];
    (didKnow ? known : learning).add(t.id);
    (didKnow ? learning : known).delete(t.id);
    go(1);
  };

  const onKey = (e) => {
    if (e.target.closest('input, textarea, select') || $('.modal-bg') || finished) return;
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      flip();
    } else if (e.key === 'ArrowRight') opts.track ? mark(true) : go(1);
    else if (e.key === 'ArrowLeft') opts.track ? mark(false) : go(-1);
    else if (e.key.toLowerCase() === 's') toggleStar(set, deck[idx]).then(render);
    else if (e.key.toLowerCase() === 'p') playTerm(deck[idx]);
  };
  document.addEventListener('keydown', onKey);
  onLeave(() => document.removeEventListener('keydown', onKey));
  render();
}

/* =====================================================================
   Chế độ: Học (Learn) – trắc nghiệm rồi tự luận, theo vòng
   ===================================================================== */
function makeChoices(t, pool, answerWith, n = 4) {
  const field = answerWith === 'def' ? 'definition' : 'term';
  const correct = t[field];
  const others = shuffle(pool.filter((x) => x.id !== t.id && norm(x[field]) !== norm(correct))).map((x) => x[field]);
  const uniq = [...new Set(others)].slice(0, n - 1);
  return shuffle([correct, ...uniq]);
}

function promptBlock(t, answerWith) {
  // Trả lời bằng thuật ngữ → đề bài là định nghĩa; và ngược lại.
  if (answerWith === 'def')
    return `<div class="q-label">Thuật ngữ <button class="icon-btn sm" data-say>${I.sound}</button></div>
      <div class="q-prompt">${esc(t.term)} ${ipaLink(ipaOf(t), t.term)}</div>`;
  return `<div class="q-label">Định nghĩa</div><div class="q-prompt">${imgTag(t, 'q-img')}<span>${esc(t.definition)}</span></div>`;
}

async function viewLearn(id) {
  const set = await studySet(id);
  const sKey = 'learnSet:' + id;
  const settings = { answerWith: 'term', written: true, audio: true, ...LS.get(sKey, {}) };
  let prog = { ...set._prog.learn };
  const target = () => (settings.written ? 2 : 1);
  let roundNo = 0;
  let queue = [];
  let roundTerms = [];
  let roundRes = new Map();
  let current = null;
  let waiting = null; // hàm tiếp tục khi đang hiện phản hồi
  let timer = null;
  onLeave(() => clearTimeout(timer));

  const saveProg = () => patchProg(set, { learn: prog });
  const level = (t) => prog[t.id] || 0;
  const header = () => {
    const total = set.terms.length;
    const mastered = set.terms.filter((t) => level(t) >= target()).length;
    const familiar = set.terms.filter((t) => level(t) > 0 && level(t) < target()).length;
    return `${studyHeader(set, 'learn', `<button class="icon-btn" id="settingsBtn" title="Tùy chọn">${I.gear}</button>`)}
      <div class="learn-progress"><div class="seg-bar"><div class="s2" style="width:${(mastered / total) * 100}%"></div><div class="s1" style="width:${(familiar / total) * 100}%"></div></div>
      <span class="small muted" style="white-space:nowrap">${mastered}/${total} đã thuộc</span></div>`;
  };

  const startRound = () => {
    const remaining = set.terms.filter((t) => level(t) < target());
    if (!remaining.length) return renderDone();
    roundNo++;
    // Ưu tiên các từ đang học dở, sau đó tới từ mới
    roundTerms = [...shuffle(remaining.filter((t) => level(t) > 0)), ...shuffle(remaining.filter((t) => level(t) === 0))].slice(0, 7);
    queue = [...roundTerms];
    roundRes = new Map();
    next();
  };

  const next = () => {
    waiting = null;
    if (!queue.length) return renderRoundEnd();
    current = queue.shift();
    const type = level(current) >= 1 && settings.written ? 'written' : 'mc';
    type === 'mc' ? renderMC(current) : renderWritten(current);
  };

  const afterAnswer = (t, ok) => {
    if (!roundRes.has(t.id)) roundRes.set(t.id, ok);
    if (ok) prog[t.id] = Math.min(level(t) + 1, 2);
    else {
      prog[t.id] = level(t) >= 1 ? 1 : 0;
      queue.push(t);
      roundRes.set(t.id, false);
    }
    saveProg();
    if (ok && settings.audio) playTerm(t);
  };

  const bindCommon = (t) => {
    $('[data-say]')?.addEventListener('click', () => playTerm(t));
    $('#settingsBtn').onclick = openSettings;
  };

  function renderMC(t) {
    const choices = makeChoices(t, set.terms, settings.answerWith);
    app.innerHTML = `<div class="page page-narrow">${header()}
      <div class="q-card">${promptBlock(t, settings.answerWith)}
        <div class="q-label">Chọn đáp án đúng</div>
        <div class="choices" style="margin-top:10px">${choices
          .map((c, i) => `<button class="choice" data-i="${i}"><span class="k">${i + 1}</span><span>${esc(c)}</span></button>`)
          .join('')}</div>
        <div id="fb"></div>
        <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn btn-ghost btn-sm" id="dontKnow">Bạn không biết?</button></div>
      </div></div>`;
    bindCommon(t);
    const answer = settings.answerWith === 'def' ? t.definition : t.term;
    const choose = (i) => {
      if (waiting) return;
      const picked = i == null ? null : choices[i];
      const ok = picked != null && norm(picked) === norm(answer);
      $$('.choice').forEach((b, j) => {
        b.disabled = true;
        if (norm(choices[j]) === norm(answer)) b.classList.add('correct');
        else if (j === i) b.classList.add('wrong');
      });
      $('#dontKnow').remove();
      afterAnswer(t, ok);
      showFeedback(ok, answer, false, false, picked || '');
    };
    $$('.choice').forEach((b) => (b.onclick = () => choose(+b.dataset.i)));
    $('#dontKnow').onclick = () => choose(null);
    current._choose = choose;
    current._nChoices = choices.length;
  }

  function renderWritten(t) {
    app.innerHTML = `<div class="page page-narrow">${header()}
      <div class="q-card">${promptBlock(t, settings.answerWith)}
        <div class="q-label">Câu trả lời của bạn ${settings.answerWith === 'term' && ipaOf(t) ? `<span class="muted small" style="font-weight:400">· gợi ý phiên âm: ${ipaLink(ipaOf(t), t.term)}</span>` : ''}</div>
        <div class="write-row" style="margin-top:10px"><input id="ans" placeholder="Nhập ${settings.answerWith === 'term' ? 'thuật ngữ tiếng Anh' : 'định nghĩa'}" autocomplete="off" spellcheck="false" />
          <button class="btn btn-primary btn-lg" id="submit">Trả lời</button></div>
        <div id="fb"></div>
        <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn btn-ghost btn-sm" id="dontKnow">Bạn không biết?</button></div>
      </div></div>`;
    bindCommon(t);
    const answer = settings.answerWith === 'def' ? t.definition : t.term;
    const input = $('#ans');
    input.focus();
    const submit = (skip) => {
      if (waiting) return;
      const res = skip ? false : checkAnswer(input.value, answer);
      if (!skip && !input.value.trim()) return;
      input.disabled = true;
      $('#submit').disabled = true;
      $('#dontKnow').remove();
      afterAnswer(t, Boolean(res));
      showFeedback(Boolean(res), answer, !res && !skip, res === 'close', input.value);
    };
    $('#submit').onclick = () => submit(false);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        submit(false);
      }
    };
    $('#dontKnow').onclick = () => submit(true);
  }

  function showFeedback(ok, answer, canOverride, close = false, typed = '') {
    const fb = $('#fb');
    if (ok) {
      fb.innerHTML = `<div class="feedback ok">${close ? `Gần đúng! Đáp án chính xác: <b>${esc(answer)}</b>` : ['Tuyệt vời!', 'Chính xác!', 'Giỏi lắm!', 'Đúng rồi!'][Math.floor(Math.random() * 4)]}</div>`;
      waiting = next;
      timer = setTimeout(next, close ? 1800 : 900);
      return;
    }
    fb.innerHTML = `<div class="feedback bad">${typed ? 'Chưa đúng, hãy tiếp tục cố gắng!' : 'Không sao, bạn vẫn đang học!'}
      <div class="ans">Đáp án đúng: <b>${esc(answer)}</b></div>
      ${typed ? `<div class="ans muted">Bạn đã trả lời: ${esc(typed)}</div>` : ''}</div>
      <div class="row" style="justify-content:space-between;margin-top:12px">
        ${canOverride ? `<button class="btn btn-ghost btn-sm" id="override">Tôi đã trả lời đúng</button>` : '<span></span>'}
        <button class="btn btn-primary" id="cont">Tiếp tục <span class="small" style="opacity:.7">(Enter)</span></button></div>`;
    waiting = next;
    $('#cont').onclick = next;
    $('#override')?.addEventListener('click', () => {
      const t = current;
      queue.splice(queue.lastIndexOf(t), 1);
      prog[t.id] = Math.min(level(t) + 1, 2);
      roundRes.set(t.id, true);
      saveProg();
      next();
    });
    $('#cont').focus();
  }

  function renderRoundEnd() {
    app.innerHTML = `<div class="page page-narrow">${header()}
      <div class="q-card"><h1>Vòng ${roundNo} hoàn tất! 🎯</h1>
        <p class="muted">Bạn đang tiến bộ rất tốt. Đây là các thuật ngữ trong vòng này:</p>
        <div class="term-list" style="margin:16px 0">${roundTerms
          .map(
            (t) => `<div class="term-item" style="box-shadow:none;border:1px solid var(--border)">
            <div class="t">${esc(t.term)}<span class="sub-ipa">${ipaLink(ipaOf(t), t.term)}</span></div><div class="d">${esc(t.definition)}</div>
            <div>${roundRes.get(t.id) ? `<span class="pill green">Đúng</span>` : `<span class="pill orange">Đang học</span>`}</div></div>`
          )
          .join('')}</div>
        <div class="row" style="justify-content:flex-end"><button class="btn btn-primary btn-lg" id="cont">Tiếp tục vòng ${roundNo + 1}</button></div>
      </div></div>`;
    $('#settingsBtn').onclick = openSettings;
    waiting = startRound;
    $('#cont').onclick = startRound;
    $('#cont').focus();
  }

  function renderDone() {
    app.innerHTML = `<div class="page page-narrow">${header()}
      <div class="q-card center-box"><div style="font-size:56px">🏆</div>
        <h1>Chúc mừng! Bạn đã thuộc tất cả ${set.terms.length} thuật ngữ</h1>
        <p class="muted">Hãy thử sức với bài kiểm tra hoặc trò chơi ghép thẻ.</p>
        <div class="row wrap" style="justify-content:center;margin-top:16px">
          <a class="btn btn-primary" href="#/set/${id}/test">Làm bài kiểm tra</a>
          <a class="btn" href="#/set/${id}/match">Ghép thẻ</a>
          <button class="btn" id="reset">Học lại từ đầu</button></div></div></div>`;
    $('#settingsBtn').onclick = openSettings;
    $('#reset').onclick = () => {
      prog = {};
      saveProg();
      roundNo = 0;
      startRound();
    };
  }

  function openSettings() {
    const m = openModal(`<h2>Tùy chọn Học</h2>
      <div class="settings-grid" style="margin-top:16px">
        <div class="line"><b>Trả lời bằng</b><select class="inp" id="sAns" style="width:auto">
          <option value="term">Thuật ngữ (tiếng Anh)</option><option value="def">Định nghĩa</option></select></div>
        <div class="line"><b>Câu hỏi tự luận</b><label class="switch"><input type="checkbox" id="sWr" ${settings.written ? 'checked' : ''}><span class="tr"></span></label></div>
        <div class="line"><b>Phát âm khi trả lời đúng</b><label class="switch"><input type="checkbox" id="sAu" ${settings.audio ? 'checked' : ''}><span class="tr"></span></label></div>
        <div class="line"><b>Tiến độ</b><button class="btn btn-sm btn-danger" id="sReset">Đặt lại tiến độ</button></div>
      </div>
      <div class="acts"><button class="btn btn-primary" id="sOk">Lưu</button></div>`);
    $('#sAns', m.el).value = settings.answerWith;
    $('#sReset', m.el).onclick = () => {
      prog = {};
      saveProg();
      toast('Đã đặt lại tiến độ');
    };
    $('#sOk', m.el).onclick = () => {
      settings.answerWith = $('#sAns', m.el).value;
      settings.written = $('#sWr', m.el).checked;
      settings.audio = $('#sAu', m.el).checked;
      LS.set(sKey, settings);
      m.close();
      roundNo = Math.max(0, roundNo - 1);
      startRound();
    };
  }

  const onKey = (e) => {
    if ($('.modal-bg')) return;
    if (e.key === 'Enter' && waiting && !e.target.closest('input:not([disabled])')) {
      e.preventDefault();
      clearTimeout(timer);
      waiting();
      return;
    }
    if (!waiting && current?._choose && /^[1-9]$/.test(e.key) && !e.target.closest('input')) {
      const i = +e.key - 1;
      if (i < current._nChoices) current._choose(i);
    }
  };
  document.addEventListener('keydown', onKey);
  onLeave(() => document.removeEventListener('keydown', onKey));
  startRound();
}

/* =====================================================================
   Chế độ: Kiểm tra
   ===================================================================== */
async function viewTest(id) {
  const set = await studySet(id);
  const sKey = 'testSet:' + id;
  const cfg = { count: Math.min(20, set.terms.length), answerWith: 'term', tf: true, mc: true, written: true, match: true, ...LS.get(sKey, {}) };
  cfg.count = Math.min(cfg.count, set.terms.length);

  const renderSetup = () => {
    app.innerHTML = `<div class="page page-narrow">${studyHeader(set, 'test')}
      <div class="q-card"><h1>Thiết lập bài kiểm tra</h1>
        <div class="settings-grid" style="margin-top:20px">
          <div class="line"><b>Số câu hỏi (tối đa ${set.terms.length})</b><input type="number" class="num-input" id="cCount" min="1" max="${set.terms.length}" value="${cfg.count}"></div>
          <div class="line"><b>Trả lời bằng</b><select class="inp" id="cAns" style="width:auto">
            <option value="term">Thuật ngữ</option><option value="def">Định nghĩa</option><option value="both">Cả hai</option></select></div>
          <div class="line"><b>Đúng / Sai</b><label class="switch"><input type="checkbox" id="cTf" ${cfg.tf ? 'checked' : ''}><span class="tr"></span></label></div>
          <div class="line"><b>Trắc nghiệm</b><label class="switch"><input type="checkbox" id="cMc" ${cfg.mc ? 'checked' : ''}><span class="tr"></span></label></div>
          <div class="line"><b>Tự luận</b><label class="switch"><input type="checkbox" id="cWr" ${cfg.written ? 'checked' : ''}><span class="tr"></span></label></div>
          <div class="line"><b>Ghép nối</b><label class="switch"><input type="checkbox" id="cMa" ${cfg.match ? 'checked' : ''}><span class="tr"></span></label></div>
        </div>
        <div class="row" style="justify-content:flex-end;margin-top:24px"><button class="btn btn-primary btn-lg" id="start">Bắt đầu làm bài</button></div>
      </div></div>`;
    $('#cAns').value = cfg.answerWith;
    $('#start').onclick = () => {
      cfg.count = Math.max(1, Math.min(set.terms.length, +$('#cCount').value || 1));
      cfg.answerWith = $('#cAns').value;
      cfg.tf = $('#cTf').checked;
      cfg.mc = $('#cMc').checked;
      cfg.written = $('#cWr').checked;
      cfg.match = $('#cMa').checked;
      if (!cfg.tf && !cfg.mc && !cfg.written && !cfg.match) return toast('Hãy chọn ít nhất một dạng câu hỏi', true);
      LS.set(sKey, cfg);
      renderTest(generate());
    };
  };

  const generate = () => {
    const pool = sample(set.terms, cfg.count);
    const types = ['tf', 'mc', 'written', 'match'].filter((k) => cfg[k]);
    const groups = Object.fromEntries(types.map((k) => [k, []]));
    pool.forEach((t, i) => groups[types[i % types.length]].push(t));
    // Ghép nối cần ít nhất 2 thẻ
    if (groups.match && groups.match.length < 2 && types.length > 1) {
      const other = types.find((k) => k !== 'match');
      groups[other].push(...groups.match);
      groups.match = [];
    }
    const dir = () => (cfg.answerWith === 'both' ? (Math.random() < 0.5 ? 'term' : 'def') : cfg.answerWith);
    const questions = [];
    for (const t of groups.tf || []) {
      const d = dir();
      const field = d === 'def' ? 'definition' : 'term';
      const truth = Math.random() < 0.5 || set.terms.length < 2;
      const shown = truth ? t : sample(set.terms.filter((x) => x.id !== t.id && norm(x[field]) !== norm(t[field])), 1)[0] || t;
      questions.push({ type: 'tf', t, d, shown: shown[field], truth: shown === t || norm(shown[field]) === norm(t[field]), user: null });
    }
    for (const t of groups.mc || []) {
      const d = dir();
      questions.push({ type: 'mc', t, d, choices: makeChoices(t, set.terms, d), user: null });
    }
    for (const t of groups.written || []) questions.push({ type: 'written', t, d: dir(), user: '' });
    if (groups.match?.length) {
      const d = dir();
      const items = groups.match.slice(0, 8);
      groups.match.slice(8).forEach((t) => questions.push({ type: 'written', t, d, user: '' }));
      questions.push({ type: 'match', items, d, bank: shuffle(items), user: {} });
    }
    return questions;
  };

  const answerOf = (t, d) => (d === 'def' ? t.definition : t.term);
  const promptOf = (t, d) => (d === 'def' ? t.term : t.definition);

  const renderTest = (qs, submitted = false) => {
    let n = 0;
    const sections = { tf: 'Đúng / Sai', mc: 'Trắc nghiệm', written: 'Tự luận', match: 'Ghép nối' };
    let lastType = null;
    let score = 0;
    let total = 0;
    if (submitted) {
      for (const q of qs) {
        if (q.type === 'match') {
          for (const t of q.items) {
            total++;
            if (q.user[t.id] === t.id) score++;
          }
        } else {
          total++;
          if (q.ok) score++;
        }
      }
    }
    const pct = total ? Math.round((score / total) * 100) : 0;
    if (submitted && !qs.saved) {
      qs.saved = true;
      patchProg(set, { addTest: { score, total } });
    }
    const html = qs
      .map((q, qi) => {
        let head = '';
        if (q.type !== lastType) {
          head = `<h2>${sections[q.type]}</h2>`;
          lastType = q.type;
        }
        if (q.type === 'match') {
          const letters = 'ABCDEFGH';
          return `${head}<div class="q-card test-q" data-q="${qi}">
            <div class="q-label">Ghép mỗi mục với đáp án đúng</div>
            <div class="small muted" style="margin:10px 0">${q.bank.map((t, i) => `<b>${letters[i]}.</b> ${esc(answerOf(t, q.d))}`).join('<br>')}</div>
            <div class="match-sel">${q.items
              .map((t) => {
                n++;
                const ok = submitted && q.user[t.id] === t.id;
                return `<div class="match-line"><div><span class="num">${n}.</span> ${esc(promptOf(t, q.d))}</div>
                <div><select class="inp" data-mt="${t.id}" ${submitted ? 'disabled' : ''} style="${submitted ? `border-color:${ok ? 'var(--success)' : 'var(--error)'}` : ''}">
                  <option value="">— Chọn —</option>${q.bank.map((b, i) => `<option value="${b.id}" ${q.user[t.id] === b.id ? 'selected' : ''}>${letters[i]}. ${esc(answerOf(b, q.d).slice(0, 60))}</option>`).join('')}
                </select>${submitted && !ok ? `<div class="small" style="color:var(--success)">Đáp án: ${esc(answerOf(t, q.d))}</div>` : ''}</div></div>`;
              })
              .join('')}</div></div>`;
        }
        n++;
        const promptHtml = `<div class="q-prompt" style="font-size:20px;margin:8px 0 16px">${q.d !== 'def' ? imgTag(q.t, 'q-img') : ''}<span>${esc(promptOf(q.t, q.d))}</span>${
          q.d === 'def' ? ' ' + ipaLink(ipaOf(q.t), q.t.term) : ''
        }</div>`;
        const label = `<div class="row between"><span class="num">${n} / ${cfg.count}</span>${
          submitted ? (q.ok ? '<span class="pill green">Đúng</span>' : '<span class="pill orange">Sai</span>') : ''
        }</div>`;
        if (q.type === 'tf') {
          return `${head}<div class="q-card test-q" data-q="${qi}">${label}
            <div class="tf-row"><div>${promptHtml}</div><div class="sep"></div>
            <div class="q-prompt" style="font-size:20px">${esc(q.shown)}</div></div>
            <div class="choices">${['Đúng', 'Sai']
              .map((lab, i) => {
                const val = i === 0;
                let cls = q.user === val ? 'picked' : '';
                if (submitted) cls = val === q.truth ? 'correct' : q.user === val ? 'wrong' : '';
                return `<button class="choice ${cls}" data-tf="${val}" ${submitted ? 'disabled' : ''}>${lab}</button>`;
              })
              .join('')}</div></div>`;
        }
        if (q.type === 'mc') {
          const ans = answerOf(q.t, q.d);
          return `${head}<div class="q-card test-q" data-q="${qi}">${label}${promptHtml}
            <div class="choices">${q.choices
              .map((c, i) => {
                let cls = q.user === i ? 'picked' : '';
                if (submitted) cls = norm(c) === norm(ans) ? 'correct' : q.user === i ? 'wrong' : '';
                return `<button class="choice ${cls}" data-mc="${i}" ${submitted ? 'disabled' : ''}><span class="k">${'ABCD'[i]}</span><span>${esc(c)}</span></button>`;
              })
              .join('')}</div></div>`;
        }
        return `${head}<div class="q-card test-q" data-q="${qi}">${label}${promptHtml}
          <div class="write-row"><input data-wr placeholder="Nhập câu trả lời" value="${esc(q.user)}" ${submitted ? 'disabled' : ''} autocomplete="off" spellcheck="false"></div>
          ${submitted && !q.ok ? `<div class="feedback bad"><div class="ans">Đáp án đúng: <b>${esc(answerOf(q.t, q.d))}</b></div></div>` : ''}</div>`;
      })
      .join('');

    app.innerHTML = `<div class="page page-narrow">${studyHeader(set, 'test')}
      ${
        submitted
          ? `<div class="q-card result-hero" style="margin-bottom:12px"><div class="donut" style="--p:${pct}" data-label="${pct}%"></div>
              <div><h1>${pct >= 80 ? 'Xuất sắc! 🎉' : pct >= 50 ? 'Khá tốt! Cố gắng thêm nhé' : 'Hãy ôn tập thêm nhé!'}</h1>
              <p class="muted" style="margin:0">Đúng ${score} / ${total} câu</p>
              <div class="row wrap" style="margin-top:12px"><button class="btn btn-primary" id="newTest">Làm bài kiểm tra mới</button>
              <a class="btn" href="#/set/${id}/learn">Ôn với chế độ Học</a></div></div></div>`
          : ''
      }
      ${html}
      ${!submitted ? `<div class="center-box"><h2>Bạn đã sẵn sàng nộp bài?</h2><button class="btn btn-primary btn-lg" id="submitTest">Nộp bài</button></div>` : ''}
    </div>`;

    if (submitted) {
      $('#newTest').onclick = renderSetup;
      return;
    }
    $$('.test-q').forEach((card) => {
      const q = qs[+card.dataset.q];
      $$('[data-tf]', card).forEach(
        (b) =>
          (b.onclick = () => {
            q.user = b.dataset.tf === 'true';
            $$('[data-tf]', card).forEach((x) => x.classList.toggle('picked', x === b));
          })
      );
      $$('[data-mc]', card).forEach(
        (b) =>
          (b.onclick = () => {
            q.user = +b.dataset.mc;
            $$('[data-mc]', card).forEach((x) => x.classList.toggle('picked', x === b));
          })
      );
      const wr = $('[data-wr]', card);
      if (wr) wr.oninput = () => (q.user = wr.value);
      $$('[data-mt]', card).forEach((s) => (s.onchange = () => (q.user[s.dataset.mt] = s.value)));
    });
    $('#submitTest').onclick = async () => {
      const unanswered = qs.filter((q) => (q.type === 'match' ? Object.values(q.user).filter(Boolean).length < q.items.length : q.user === null || q.user === '')).length;
      if (unanswered && !(await confirmModal('Còn câu chưa trả lời', `Bạn còn ${unanswered} câu chưa trả lời. Vẫn nộp bài?`, 'Nộp bài'))) return;
      for (const q of qs) {
        if (q.type === 'tf') q.ok = q.user === q.truth;
        if (q.type === 'mc') q.ok = q.user != null && norm(q.choices[q.user]) === norm(answerOf(q.t, q.d));
        if (q.type === 'written') q.ok = Boolean(checkAnswer(q.user, answerOf(q.t, q.d)));
      }
      renderTest(qs, true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  };

  renderSetup();
}

/* =====================================================================
   Chế độ: Ghép thẻ
   ===================================================================== */
async function viewMatch(id) {
  const set = await studySet(id);
  let timerId = null;
  onLeave(() => clearInterval(timerId));

  const renderIntro = () => {
    const best = set._prog.matchBest;
    app.innerHTML = `<div class="page page-narrow">${studyHeader(set, 'match')}
      <div class="q-card center-box"><div style="font-size:56px">🧩</div>
        <h1>Bạn đã sẵn sàng?</h1>
        <p class="muted">Ghép tất cả các thuật ngữ với định nghĩa của chúng nhanh nhất có thể.<br>Tránh ghép sai — mỗi lần sai sẽ cộng thêm 1 giây.</p>
        ${best ? `<p><span class="pill">Kỷ lục: ${best.toFixed(1)} giây</span></p>` : ''}
        <button class="btn btn-primary btn-lg" id="go">Bắt đầu trò chơi</button></div></div>`;
    $('#go').onclick = play;
  };

  const play = () => {
    const picked = sample(set.terms, Math.min(6, set.terms.length));
    const tiles = shuffle(picked.flatMap((t) => [{ id: t.id, text: t.term, kind: 't' }, { id: t.id, text: t.definition, kind: 'd', image: t.image }]));
    let sel = null;
    let left = picked.length;
    let penalty = 0;
    const start = performance.now();
    app.innerHTML = `<div class="page">${studyHeader(set, 'match', `<span class="timer" id="timer">0.0</span>`)}
      <div class="match-grid">${tiles.map((x, i) => `<div class="tile" data-i="${i}">${x.image ? `<img src="${esc(x.image)}" alt="">` : ''}<span>${esc(x.text)}</span></div>`).join('')}</div></div>`;
    const elapsed = () => (performance.now() - start) / 1000 + penalty;
    timerId = setInterval(() => {
      const el = $('#timer');
      if (el) el.textContent = elapsed().toFixed(1);
    }, 100);
    $('.match-grid').onclick = (e) => {
      const el = e.target.closest('.tile');
      if (!el || el.classList.contains('gone')) return;
      const i = +el.dataset.i;
      if (sel === null) {
        sel = i;
        el.classList.add('sel');
        return;
      }
      if (sel === i) {
        el.classList.remove('sel');
        sel = null;
        return;
      }
      const a = tiles[sel];
      const b = tiles[i];
      const elA = $(`.tile[data-i="${sel}"]`);
      sel = null;
      elA.classList.remove('sel');
      if (a.id === b.id && a.kind !== b.kind) {
        [elA, el].forEach((x) => x.classList.add('good'));
        const t = set.terms.find((x) => x.id === a.id);
        if (LS.get('matchAudio', true)) playTerm(t);
        setTimeout(() => [elA, el].forEach((x) => x.classList.add('gone')), 250);
        if (--left === 0) {
          clearInterval(timerId);
          setTimeout(() => finish(elapsed()), 400);
        }
      } else {
        penalty += 1;
        [elA, el].forEach((x) => {
          x.classList.add('bad');
          setTimeout(() => x.classList.remove('bad'), 450);
        });
      }
    };
  };

  const finish = (time) => {
    const best = set._prog.matchBest;
    const record = !best || time < best;
    patchProg(set, { matchTime: time });
    app.innerHTML = `<div class="page page-narrow">${studyHeader(set, 'match')}
      <div class="q-card center-box"><div style="font-size:56px">${record ? '🏆' : '⏱️'}</div>
        <h1>${time.toFixed(1)} giây</h1>
        <p class="muted">${record ? 'Kỷ lục mới! Bạn có thể nhanh hơn nữa không?' : `Kỷ lục của bạn: ${best.toFixed(1)} giây`}</p>
        <button class="btn btn-primary btn-lg" id="again">Chơi lại</button></div></div>`;
    $('#again').onclick = play;
  };

  renderIntro();
}

/* =====================================================================
   Chế độ: Chính tả (nghe phát âm Cambridge rồi gõ lại từ)
   ===================================================================== */
async function viewSpell(id) {
  const set = await studySet(id);
  const words = shuffle(set.terms);
  let i = 0;
  let correct = 0;
  const wrong = [];
  let waiting = false;

  const diffHtml = (typed, answer) => {
    const a = answer;
    return [...a]
      .map((ch, k) => `<span style="color:${(typed[k] || '').toLowerCase() === ch.toLowerCase() ? 'var(--success)' : 'var(--error)'};font-weight:700">${esc(ch)}</span>`)
      .join('');
  };

  const render = () => {
    if (i >= words.length) return renderEnd();
    const t = words[i];
    waiting = false;
    app.innerHTML = `<div class="page page-narrow">${studyHeader(set, 'spell')}
      <div class="learn-progress"><div class="bar" style="flex:1"><div style="width:${(i / words.length) * 100}%"></div></div><span class="small muted">${i + 1}/${words.length}</span></div>
      <div class="q-card">
        <div class="q-label">Nghe và gõ lại từ</div>
        <div class="row" style="margin:16px 0;gap:16px">
          <button class="round-btn" id="say" style="width:72px;height:72px;border-color:var(--primary);color:var(--primary)" title="Nghe lại (Ctrl+Space)">${I.sound}</button>
          <div><div style="font-size:18px">${esc(t.definition)}</div>
          <button class="btn btn-ghost btn-sm" id="hint" style="padding:0;margin-top:4px">Hiện phiên âm</button><span class="muted hidden" id="ipa">${ipaLink(ipaOf(t), t.term) || '(chưa có phiên âm)'}</span></div>
        </div>
        <div class="write-row"><input id="ans" placeholder="Gõ từ bạn nghe được" autocomplete="off" spellcheck="false" />
          <button class="btn btn-primary btn-lg" id="check">Kiểm tra</button></div>
        <div id="fb"></div>
      </div></div>`;
    const input = $('#ans');
    input.focus();
    playTerm(t);
    $('#say').onclick = () => {
      playTerm(t);
      input.focus();
    };
    $('#hint').onclick = () => {
      $('#ipa').classList.remove('hidden');
      $('#hint').remove();
    };
    const check = () => {
      if (waiting) {
        i++;
        return render();
      }
      if (!input.value.trim()) return;
      waiting = true;
      input.disabled = true;
      const ok = norm(input.value) === norm(t.term);
      if (ok) correct++;
      else wrong.push(t);
      $('#check').textContent = 'Tiếp tục';
      $('#fb').innerHTML = ok
        ? `<div class="feedback ok">Chính xác! <span class="ipa">${esc(ipaOf(t))}</span></div>`
        : `<div class="feedback bad">Chưa đúng<div class="ans">Đáp án: <b style="font-size:20px;letter-spacing:1px">${diffHtml(input.value.trim(), t.term)}</b> <span class="ipa muted">${esc(ipaOf(t))}</span></div>
           <div class="ans muted">Bạn đã gõ: ${esc(input.value)}</div></div>`;
      $('#check').focus();
      if (ok) setTimeout(() => waiting && words[i] === t && (i++, render()), 1200);
    };
    $('#check').onclick = check;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        check();
      }
    };
  };

  const renderEnd = () => {
    patchProg(set, { spell: { correct, total: words.length } });
    app.innerHTML = `<div class="page page-narrow">${studyHeader(set, 'spell')}
      <div class="q-card center-box"><div style="font-size:56px">✍️</div>
        <h1>Đúng ${correct} / ${words.length} từ</h1>
        ${wrong.length ? `<p class="muted">Cần luyện thêm: ${wrong.map((t) => `<b>${esc(t.term)}</b> ${ipaLink(ipaOf(t), t.term)}`).join(', ')}</p>` : '<p class="muted">Hoàn hảo! Bạn viết đúng tất cả các từ.</p>'}
        <div class="row" style="justify-content:center;margin-top:16px"><button class="btn btn-primary" id="again">Luyện lại</button><a class="btn" href="#/set/${id}">Về học phần</a></div></div></div>`;
    $('#again').onclick = () => route();
  };

  const onKey = (e) => {
    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      if (words[i]) playTerm(words[i]);
    }
  };
  document.addEventListener('keydown', onKey);
  onLeave(() => document.removeEventListener('keydown', onKey));
  render();
}

const MODES = { flashcards: viewFlashcards, learn: viewLearn, test: viewTest, match: viewMatch, spell: viewSpell };

/* =====================================================================
   Đăng nhập / tài khoản
   ===================================================================== */
const ROLE_LABEL = { teacher: 'Giáo viên', student: 'Học sinh' };

function renderUserChip() {
  const box = $('#userChip');
  if (!box) return;
  if (!me) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<button class="user-chip" id="userBtn" title="Tài khoản">${avatar(me.name, 30)}<span class="hide-sm"><b>${esc(me.name)}</b><small>${ROLE_LABEL[me.role]}</small></span></button>`;
  $('#userBtn').onclick = () => {
    const m = openModal(`<div class="row" style="gap:14px">${avatar(me.name, 56)}<div><h2>${esc(me.name)}</h2><span class="pill ${me.role === 'teacher' ? '' : 'green'}">${ROLE_LABEL[me.role]}</span></div></div>
      <p class="muted small" style="margin-top:16px">${
        me.role === 'teacher'
          ? 'Bạn có thể tạo lớp học, giao học phần và xem tiến độ của học sinh trong mục Lớp học.'
          : 'Tham gia lớp của giáo viên bằng mã lớp để nhận học phần được giao.'
      }</p>
      <div class="acts" style="flex-wrap:wrap"><a class="btn" href="#/library" data-close>Thư viện</a><a class="btn" href="#/ipa" data-close>Bảng IPA</a><a class="btn" href="#/classes" data-close>${I.users} Lớp học</a><button class="btn btn-primary" id="logoutBtn" style="background:var(--error)">Đăng xuất</button></div>`);
    $('#logoutBtn', m.el).onclick = async () => {
      await api('/auth/logout', { method: 'POST' }).catch(() => {});
      LS.del('token');
      me = null;
      liveSource?.close();
      m.close();
      renderUserChip();
      location.hash = '#/login';
    };
  };
}

function finishLogin(r) {
  LS.set('token', r.token);
  me = r.user;
  // Bản nháp tạo trước khi có tài khoản thuộc về người đăng nhập đầu tiên
  const oldDraft = LS.get('draft:new', null);
  if (oldDraft && !LS.get('draft:new:' + me.id, null)) LS.set('draft:new:' + me.id, oldDraft);
  LS.del('draft:new');
  renderUserChip();
  startLive();
  toast(`Xin chào ${me.name}!`);
  location.hash = '#/';
}

async function viewLogin() {
  if (me) {
    location.hash = '#/';
    return;
  }
  const users = await api('/users').catch(() => []);
  let mode = users.length ? 'pick' : 'register';
  let picked = null;
  const draw = () => {
    app.innerHTML = `<div class="page" style="max-width:560px">
      <div class="q-card" style="margin-top:24px">
        <div class="row" style="gap:10px;margin-bottom:8px"><span class="logo-mark">Q</span><h1 style="margin:0">Quizzy</h1></div>
        <p class="muted" style="margin-top:0">Học từ vựng tiếng Anh với phiên âm Cambridge. Giáo viên tạo thẻ & giao bài — học sinh học và được theo dõi tiến độ.</p>
        ${
          mode === 'pick'
            ? `<h2 style="margin:20px 0 12px">Chọn tài khoản</h2>
               <div class="user-grid">${users
                 .map((u) => `<button class="user-pick" data-id="${u.id}">${avatar(u.name, 40)}<span><b>${esc(u.name)}</b><small>${ROLE_LABEL[u.role]}</small></span></button>`)
                 .join('')}</div>
               <button class="btn btn-ghost" id="toRegister" style="margin-top:16px">+ Tạo tài khoản mới</button>`
            : mode === 'pin'
            ? `<div class="row" style="gap:12px;margin:20px 0">${avatar(picked.name, 48)}<div><b style="font-size:18px">${esc(picked.name)}</b><div class="muted small">${ROLE_LABEL[picked.role]}</div></div></div>
               <div class="write-row"><input id="pin" type="password" inputmode="numeric" maxlength="8" placeholder="Nhập mã PIN" autocomplete="current-password"><button class="btn btn-primary btn-lg" id="loginBtn">Đăng nhập</button></div>
               <button class="btn btn-ghost" id="back" style="margin-top:12px">← Chọn tài khoản khác</button>`
            : `<h2 style="margin:20px 0 12px">Tạo tài khoản</h2>
               <div class="settings-grid">
                 <div class="field"><input id="rName" placeholder="Họ tên, ví dụ: Cô Lan / Minh Anh" maxlength="60"><label>Tên hiển thị</label></div>
                 <div><b class="small">Bạn là</b>
                   <div class="role-pick">
                     <label><input type="radio" name="role" value="student" checked><span><b>🎒 Học sinh</b><small>Học các học phần, tham gia lớp bằng mã</small></span></label>
                     <label><input type="radio" name="role" value="teacher"><span><b>👩‍🏫 Giáo viên</b><small>Tạo lớp, giao học phần, xem tiến độ học sinh</small></span></label>
                   </div></div>
                 <div class="field"><input id="rPin" type="password" inputmode="numeric" maxlength="8" placeholder="4–8 chữ số" autocomplete="new-password"><label>Mã PIN (dùng để đăng nhập)</label></div>
               </div>
               <div class="row between" style="margin-top:20px">${users.length ? '<button class="btn btn-ghost" id="back">← Đã có tài khoản</button>' : '<span></span>'}
               <button class="btn btn-primary btn-lg" id="regBtn">Tạo tài khoản</button></div>`
        }
      </div></div>`;
    $$('.user-pick').forEach(
      (b) =>
        (b.onclick = () => {
          picked = users.find((u) => u.id === b.dataset.id);
          mode = 'pin';
          draw();
        })
    );
    $('#toRegister')?.addEventListener('click', () => {
      mode = 'register';
      draw();
    });
    $('#back')?.addEventListener('click', () => {
      mode = 'pick';
      draw();
    });
    const pin = $('#pin');
    if (pin) {
      pin.focus();
      const login = async () => {
        try {
          finishLogin(await api('/auth/login', { method: 'POST', body: { userId: picked.id, pin: pin.value } }));
        } catch (err) {
          toast(err.message, true);
          pin.select();
        }
      };
      $('#loginBtn').onclick = login;
      pin.onkeydown = (e) => e.key === 'Enter' && login();
    }
    $('#regBtn')?.addEventListener('click', async () => {
      try {
        finishLogin(
          await api('/auth/register', {
            method: 'POST',
            body: { name: $('#rName').value, role: $('input[name=role]:checked').value, pin: $('#rPin').value },
          })
        );
      } catch (err) {
        toast(err.message, true);
      }
    });
  };
  draw();
}

/* =====================================================================
   Lớp học
   ===================================================================== */
async function viewClasses() {
  const isTeacher = me.role === 'teacher';
  const [classes, sets, info] = await Promise.all([api('/classes'), api('/sets'), api('/info').catch(() => ({ lanUrls: [] }))]);
  const mySets = sets.filter((s) => s.isOwner);
  const appUrl = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? info.lanUrls[0] || location.origin : location.origin;

  const teacherCard = (c) => `<div class="q-card class-card" data-id="${c.id}">
    <div class="row between wrap"><div><h2 style="margin:0">${esc(c.name)}</h2>
      <span class="muted small">${c.students.length} học sinh · ${c.sets.length} học phần</span></div>
      <div class="code-box" title="Học sinh nhập mã này để vào lớp"><small>Mã lớp</small><b>${esc(c.code)}</b>
        <button class="icon-btn sm" data-copy="${esc(c.code)}" title="Sao chép mã">${I.copy}</button></div></div>
    <div class="class-cols">
      <div><h3>Học sinh</h3>${
        c.students.length
          ? c.students
              .map((s) => `<div class="row between person">${avatar(s.name)}<span style="flex:1">${esc(s.name)}</span>
                <button class="icon-btn sm" data-kick="${s.id}" title="Xóa khỏi lớp">${I.x}</button></div>`)
              .join('')
          : `<p class="muted small">Chưa có học sinh. Gửi cho học sinh:<br>1. Địa chỉ ứng dụng: <b>${esc(appUrl)}</b><br>2. Mã lớp: <b>${esc(c.code)}</b></p>`
      }</div>
      <div><h3>Học phần được giao</h3>${
        mySets.length
          ? mySets
              .map((s) => `<label class="row person" style="cursor:pointer"><input type="checkbox" data-set="${s.id}" ${c.sets.some((x) => x.id === s.id) ? 'checked' : ''}>
                <span style="flex:1">${esc(s.title)}</span><span class="muted small">${s.termCount} thẻ</span></label>`)
              .join('')
          : '<p class="muted small">Bạn chưa có học phần nào.</p>'
      }
      <a class="btn btn-sm" href="#/create?class=${c.id}" style="margin-top:8px">+ Tạo học phần mới cho lớp này</a></div>
    </div>
    <div class="row wrap" style="margin-top:16px">
      <a class="btn btn-primary btn-sm" href="#/class/${c.id}">📊 Xem tiến độ học sinh</a>
      <button class="btn btn-sm" data-newcode>Đổi mã lớp</button>
      <button class="btn btn-sm btn-danger" data-delclass>Xóa lớp</button>
    </div></div>`;

  const studentCard = (c) => `<div class="q-card class-card" data-id="${c.id}">
    <div class="row between wrap"><div><h2 style="margin:0">${esc(c.name)}</h2>
      <span class="muted small">Giáo viên: <b>${esc(c.teacherName)}</b> · ${c.students.length} học sinh</span></div>
      <button class="btn btn-sm btn-ghost" data-leave>Rời lớp</button></div>
    <h3>Học phần được giao (${c.sets.length})</h3>
    ${
      c.sets.length
        ? `<div class="term-list">${c.sets
            .map((s) => `<a class="term-item" href="#/set/${s.id}" style="color:inherit;grid-template-columns:1fr auto"><div><b>${esc(s.title)}</b><div class="muted small">${s.termCount} thuật ngữ</div></div>
              <span class="btn btn-sm btn-primary">Học ngay</span></a>`)
            .join('')}</div>`
        : '<p class="muted small">Giáo viên chưa giao học phần nào.</p>'
    }</div>`;

  app.innerHTML = `<div class="page page-narrow">
    <h1>Lớp học</h1>
    ${
      isTeacher
        ? `<p class="muted">Tạo lớp → gửi <b>mã lớp</b> cho học sinh → giao học phần → theo dõi tiến độ.</p>
           <div class="q-card" style="margin-bottom:20px"><div class="write-row"><input id="newClass" placeholder="Tên lớp mới, ví dụ: Tiếng Anh 9A / Lớp IELTS tối thứ 3" maxlength="100"><button class="btn btn-primary btn-lg" id="createClass">Tạo lớp</button></div>
           ${info.lanUrls.length ? `<p class="small muted" style="margin-bottom:0">💡 Học sinh dùng chung mạng Wi-Fi có thể mở <b>${esc(appUrl)}</b> trên điện thoại/máy tính của họ.</p>` : ''}</div>`
        : `<p class="muted">Nhập mã lớp giáo viên gửi cho bạn để nhận học phần được giao.</p>
           <div class="q-card" style="margin-bottom:20px"><div class="write-row"><input id="joinCode" placeholder="Mã lớp (6 ký tự)" maxlength="6" style="text-transform:uppercase;letter-spacing:3px;font-weight:700"><button class="btn btn-primary btn-lg" id="joinBtn">Tham gia</button></div></div>`
    }
    ${
      classes.length
        ? classes.map((c) => (c.isTeacher ? teacherCard(c) : studentCard(c))).join('')
        : `<div class="empty"><div class="big">🏫</div><p class="muted">${isTeacher ? 'Bạn chưa tạo lớp nào.' : 'Bạn chưa tham gia lớp nào.'}</p></div>`
    }
  </div>`;

  $('#createClass')?.addEventListener('click', async () => {
    const name = $('#newClass').value.trim();
    if (!name) return toast('Hãy nhập tên lớp', true);
    const c = await api('/classes', { method: 'POST', body: { name } });
    toast(`Đã tạo lớp — mã lớp: ${c.code}`);
    route();
  });
  $('#newClass')?.addEventListener('keydown', (e) => e.key === 'Enter' && $('#createClass').click());
  const join = async () => {
    try {
      const c = await api('/classes/join', { method: 'POST', body: { code: $('#joinCode').value } });
      toast(`Đã vào lớp “${c.name}”`);
      route();
    } catch (err) {
      toast(err.message, true);
    }
  };
  $('#joinBtn')?.addEventListener('click', join);
  $('#joinCode')?.addEventListener('keydown', (e) => e.key === 'Enter' && join());

  $$('.class-card').forEach((card) => {
    const c = classes.find((x) => x.id === card.dataset.id);
    $$('[data-copy]', card).forEach(
      (b) =>
        (b.onclick = () =>
          navigator.clipboard?.writeText(b.dataset.copy).then(
            () => toast('Đã sao chép mã lớp'),
            () => toast('Không sao chép được', true)
          ))
    );
    $$('[data-kick]', card).forEach(
      (b) =>
        (b.onclick = async () => {
          if (!(await confirmModal('Xóa học sinh khỏi lớp?', 'Học sinh sẽ không còn thấy các học phần được giao qua lớp này.', 'Xóa', true))) return;
          await api(`/classes/${c.id}/students/${b.dataset.kick}`, { method: 'DELETE' });
          route();
        })
    );
    $$('[data-set]', card).forEach(
      (cb) =>
        (cb.onchange = async () => {
          const setIds = $$('[data-set]', card).filter((x) => x.checked).map((x) => x.dataset.set);
          await api('/classes/' + c.id, { method: 'PUT', body: { setIds } });
          toast(cb.checked ? 'Đã giao học phần cho lớp' : 'Đã bỏ giao học phần');
        })
    );
    $('[data-newcode]', card)?.addEventListener('click', async () => {
      if (!(await confirmModal('Đổi mã lớp?', 'Mã cũ sẽ không dùng được nữa. Học sinh đã trong lớp không bị ảnh hưởng.', 'Đổi mã'))) return;
      await api('/classes/' + c.id, { method: 'PUT', body: { newCode: true } });
      route();
    });
    $('[data-delclass]', card)?.addEventListener('click', async () => {
      if (!(await confirmModal('Xóa lớp?', `Lớp “${c.name}” sẽ bị xóa. Học phần của bạn vẫn được giữ lại.`, 'Xóa lớp', true))) return;
      await api('/classes/' + c.id, { method: 'DELETE' });
      route();
    });
    $('[data-leave]', card)?.addEventListener('click', async () => {
      if (!(await confirmModal('Rời lớp?', `Bạn sẽ không còn thấy các học phần của lớp “${c.name}”.`, 'Rời lớp', true))) return;
      await api(`/classes/${c.id}/students/${me.id}`, { method: 'DELETE' });
      route();
    });
  });
}

/* =====================================================================
   Tài liệu bài học (PDF): giáo viên chia phần, học sinh mở hoặc đồng bộ về máy
   ===================================================================== */
const fileSafe = (name) => String(name).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'tai-lieu';
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const partLabel = (p) => `${p.title} (trang ${p.from}${p.to !== p.from ? '–' + p.to : ''})`;
const partsToText = (d) => d.parts.map((p) => `${p.title} | ${p.from} | ${p.to}`).join('\n');
const textToParts = (text) =>
  text
    .split('\n')
    .map((line) => line.split('|').map((x) => x.trim()))
    .filter((c) => c[0])
    .map(([title, from, to]) => ({ title, from: Number(from) || 1, to: Number(to) || Number(from) || 1 }));

async function fetchDocFile(d) {
  const res = await fetch(`/api/docs/${d.id}/file`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Không tải được tài liệu');
  return res.blob();
}

async function openDocFile(d, page = 1) {
  const win = window.open('', '_blank'); // mở ngay trong cử chỉ bấm để không bị chặn pop-up
  if (!win) return toast('Trình duyệt đang chặn cửa sổ mới, hãy cho phép pop-up', true);
  try {
    win.location = URL.createObjectURL(await fetchDocFile(d)) + '#page=' + page;
  } catch (err) {
    win.close();
    toast(err.message, true);
  }
}

async function downloadDoc(d) {
  try {
    const url = URL.createObjectURL(await fetchDocFile(d));
    const a = Object.assign(document.createElement('a'), { href: url, download: fileSafe(d.title) + '.pdf' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    toast(err.message, true);
  }
}

/** Đồng bộ: mỗi tài liệu thành một thư mục con, có file PDF và muc-luc.txt. File đã đúng cỡ thì bỏ qua. */
async function syncDocs(docs) {
  if (!window.showDirectoryPicker)
    return toast('Đồng bộ vào thư mục cần Chrome hoặc Edge trên máy tính. Hãy dùng “⬇ Tải về” cho từng tài liệu.', true);
  let root;
  try {
    root = await showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    return; // người dùng đã hủy chọn thư mục
  }
  const write = async (dir, name, data) => {
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(data);
    await w.close();
  };
  try {
    for (const d of docs) {
      const base = fileSafe(d.title);
      const dir = await root.getDirectoryHandle(base, { create: true });
      let upToDate = false;
      try {
        upToDate = (await (await dir.getFileHandle(base + '.pdf')).getFile()).size === d.size;
      } catch {}
      if (!upToDate) await write(dir, base + '.pdf', await fetchDocFile(d));
      await write(dir, 'muc-luc.txt', d.parts.map((p, i) => `Phần ${i + 1}: ${partLabel(p)}`).join('\n') || 'Chưa chia phần');
    }
    toast(`Đã đồng bộ ${docs.length} tài liệu vào thư mục đã chọn`);
  } catch (err) {
    toast('Đồng bộ lỗi: ' + err.message, true);
  }
}

async function viewDocs() {
  const isTeacher = me.role === 'teacher';
  const [docs, classes] = await Promise.all([api('/docs'), api('/classes')]);
  const myClasses = classes.filter((c) => c.isTeacher);

  const teacherCard = (d) => `<div class="q-card doc-card" data-id="${d.id}">
    <div class="row between wrap"><div><h2 style="margin:0">${esc(d.title)}</h2>
      <span class="muted small">${d.parts.length} phần · ${fmtSize(d.size)}</span></div>
      <button class="btn btn-sm btn-danger" data-deldoc>Xóa</button></div>
    <label class="small" style="display:block;margin-top:12px">Chia phần, mỗi dòng: <b>Tên phần | từ trang | đến trang</b></label>
    <textarea data-parts rows="4" style="width:100%" placeholder="Bài 6.1 - Vocabulary | 1 | 5">${esc(partsToText(d))}</textarea>
    <h3>Giao cho lớp</h3>${
      myClasses.length
        ? myClasses
            .map((c) => `<label class="row person" style="cursor:pointer"><input type="checkbox" data-cls="${c.id}" ${d.classIds.includes(c.id) ? 'checked' : ''}>
              <span style="flex:1">${esc(c.name)}</span></label>`)
            .join('')
        : '<p class="muted small">Chưa có lớp nào. Tạo lớp ở mục Lớp học trước.</p>'
    }
    <div class="row wrap" style="margin-top:12px"><button class="btn btn-primary btn-sm" data-savedoc>Lưu</button></div></div>`;

  const studentCard = (d) => `<div class="q-card doc-card" data-id="${d.id}">
    <div class="row between wrap"><div><h2 style="margin:0">${esc(d.title)}</h2>
      <span class="muted small">Giáo viên: <b>${esc(d.ownerName)}</b> · ${fmtSize(d.size)}</span></div>
      <div class="row wrap"><button class="btn btn-sm btn-primary" data-open>Mở</button><button class="btn btn-sm" data-dl>⬇ Tải về</button></div></div>
    ${
      d.parts.length
        ? `<h3>Các phần bài học</h3><div class="row wrap">${d.parts
            .map((p) => `<button class="btn btn-sm" data-page="${p.from}">${esc(partLabel(p))}</button>`)
            .join('')}</div>`
        : ''
    }</div>`;

  app.innerHTML = `<div class="page page-narrow">
    <h1>Tài liệu</h1>
    ${
      isTeacher
        ? `<p class="muted">Tải PDF lên → chia thành các phần nhỏ → giao cho lớp. Học sinh sẽ thấy và đồng bộ về máy.</p>
           <div class="q-card" style="margin-bottom:20px"><div class="write-row"><input id="docTitle" placeholder="Tên tài liệu, ví dụ: Lesson 6 - Food" maxlength="200">
             <input type="file" id="docFile" accept="application/pdf"><button class="btn btn-primary btn-lg" id="docUpload">Tải lên</button></div>
             <p class="small muted" style="margin-bottom:0">PDF tối đa 100 MB.</p></div>`
        : '<p class="muted">Tài liệu giáo viên giao cho lớp của bạn. Bạn có thể mở trực tuyến hoặc đồng bộ về máy.</p>'
    }
    ${docs.length ? `<div class="row wrap" style="margin-bottom:16px"><button class="btn btn-primary" id="syncDocs">📁 Đồng bộ về máy</button></div>` : ''}
    ${
      docs.length
        ? docs.map((d) => (d.isOwner ? teacherCard(d) : studentCard(d))).join('')
        : `<div class="empty"><div class="big">📄</div><p class="muted">${isTeacher ? 'Chưa có tài liệu nào.' : 'Giáo viên chưa giao tài liệu nào.'}</p></div>`
    }
  </div>`;

  $('#syncDocs')?.addEventListener('click', () => syncDocs(docs));

  $('#docUpload')?.addEventListener('click', async () => {
    const f = $('#docFile').files[0];
    if (!f) return toast('Hãy chọn file PDF', true);
    const title = $('#docTitle').value.trim() || f.name.replace(/\.pdf$/i, '');
    $('#docUpload').disabled = true;
    try {
      const res = await fetch('/api/docs?title=' + encodeURIComponent(title), {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf', ...authHeaders() },
        body: f,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Tải lên thất bại');
      toast('Đã tải lên. Hãy chia phần và chọn lớp bên dưới.');
      route();
    } catch (err) {
      toast(err.message, true);
      $('#docUpload').disabled = false;
    }
  });

  $$('.doc-card').forEach((card) => {
    const d = docs.find((x) => x.id === card.dataset.id);
    $('[data-savedoc]', card)?.addEventListener('click', async () => {
      const body = {
        parts: textToParts($('[data-parts]', card).value),
        classIds: $$('[data-cls]:checked', card).map((x) => x.dataset.cls),
      };
      await api('/docs/' + d.id, { method: 'PUT', body });
      toast('Đã lưu tài liệu');
      route();
    });
    $('[data-deldoc]', card)?.addEventListener('click', async () => {
      if (!(await confirmModal('Xóa tài liệu?', `“${d.title}” sẽ bị xóa khỏi Quizzy. Học sinh đã tải về máy thì vẫn giữ file.`, 'Xóa', true))) return;
      await api('/docs/' + d.id, { method: 'DELETE' });
      route();
    });
    $('[data-open]', card)?.addEventListener('click', () => openDocFile(d));
    $('[data-dl]', card)?.addEventListener('click', () => downloadDoc(d));
    $$('[data-page]', card).forEach((b) => (b.onclick = () => openDocFile(d, b.dataset.page)));
  });
}

function timeAgo(iso) {
  if (!iso) return 'chưa học';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}

async function viewClassReport(id) {
  const r = await api(`/classes/${id}/report`);
  const sets = r.class.sets;
  app.innerHTML = `<div class="page">
    <a href="#/classes" class="small">← Lớp học</a>
    <div class="row between wrap"><h1>Tiến độ lớp ${esc(r.class.name)}</h1><span class="pill">Mã lớp: ${esc(r.class.code)}</span></div>
    ${
      !r.rows.length
        ? `<div class="empty"><p class="muted">Lớp chưa có học sinh nào. Gửi mã lớp <b>${esc(r.class.code)}</b> cho học sinh để họ tham gia.</p></div>`
        : !sets.length
        ? `<div class="empty"><p class="muted">Chưa giao học phần nào cho lớp này.</p><a class="btn btn-primary" href="#/classes">Giao học phần</a></div>`
        : `<p class="muted small">Mỗi ô: số thẻ <b style="color:var(--success)">đã thuộc</b> (chế độ Học), điểm kiểm tra gần nhất, kỷ lục ghép thẻ và lần học gần nhất. Di chuột vào ô để xem các từ học sinh còn gặp khó.</p>
           <div class="table-wrap"><table class="report">
             <thead><tr><th>Học sinh</th>${sets.map((s) => `<th><a href="#/set/${s.id}">${esc(s.title)}</a><div class="muted small">${s.termCount} thẻ</div></th>`).join('')}</tr></thead>
             <tbody>${r.rows
               .map(
                 (row) => `<tr><td><div class="row" style="gap:8px">${avatar(row.student.name)}<b>${esc(row.student.name)}</b></div></td>${row.sets
                   .map((c) => {
                     const pct = c.total ? Math.round((c.mastered / c.total) * 100) : 0;
                     const fam = c.total ? Math.round((c.familiar / c.total) * 100) : 0;
                     return `<td title="${c.hardTerms.length ? 'Cần ôn: ' + esc(c.hardTerms.join(', ')) : ''}">
                       <div class="seg-bar" style="height:6px"><div class="s2" style="width:${pct}%"></div><div class="s1" style="width:${fam}%"></div></div>
                       <div class="small"><b>${c.mastered}/${c.total}</b> đã thuộc</div>
                       <div class="small muted">${c.lastTest ? `Kiểm tra: <b>${Math.round((c.lastTest.score / c.lastTest.total) * 100)}%</b>` : 'Chưa kiểm tra'}${c.matchBest ? ` · Ghép: ${c.matchBest.toFixed(1)}s` : ''}</div>
                       <div class="small muted">${timeAgo(c.lastStudied)}</div>
                       ${c.hardTerms.length ? `<div class="small" style="color:var(--warn)">Cần ôn: ${esc(c.hardTerms.slice(0, 3).join(', '))}${c.hardTerms.length > 3 ? '…' : ''}</div>` : ''}
                     </td>`;
                   })
                   .join('')}</tr>`
               )
               .join('')}</tbody></table></div>`
    }
  </div>`;
}

/* =====================================================================
   Bảng IPA & phân tích phiên âm
   ===================================================================== */
const highlightWord = (w, h) => {
  const i = w.toLowerCase().indexOf(h.toLowerCase());
  return i < 0 ? esc(w) : `${esc(w.slice(0, i))}<b class="hl">${esc(w.slice(i, i + h.length))}</b>${esc(w.slice(i + h.length))}`;
};

function ipaBreakdownHTML(ipa) {
  const toks = IPA.tokenize(ipa);
  let stressNext = false;
  const chips = toks
    .map((t) => {
      if (t.mark) {
        if (t.s === 'ˈ' || t.s === 'ˌ') stressNext = t.s;
        if (t.s === '.' || t.s === ' ') return '<span class="ipa-sep">·</span>';
        return t.s === '(r)' ? '<span class="ipa-tok mark" title="r chỉ đọc khi từ sau bắt đầu bằng nguyên âm (giọng Anh)">(r)</span>' : '';
      }
      const info = t.info;
      const stress = stressNext;
      stressNext = false;
      const kind = !info ? 'unk' : IPA.isVowel(info) ? 'vowel' : info.group === 'us' ? 'vowel' : 'cons';
      return `<button class="ipa-tok ${kind} ${stress ? 'stress' : ''}" ${info ? `data-ex="${esc(info.w)}"` : ''} title="${esc(info ? info.tip : 'Ký hiệu khác')}">
        ${stress ? `<i>${stress === 'ˈ' ? 'nhấn' : 'nhấn phụ'}</i>` : ''}<span class="ipa">${esc(t.s)}</span>${info ? `<small>${highlightWord(info.w, info.h)}</small>` : ''}</button>`;
    })
    .join('');
  const seen = new Set();
  const rows = toks
    .filter((t) => t.info && !seen.has(t.info.s) && seen.add(t.info.s))
    .map(
      (t) => `<div class="ipa-row"><span class="ipa sym ${IPA.isVowel(t.info) || t.info.group === 'us' ? 'vowel' : 'cons'}">${esc(t.info.s)}</span>
        <div><div><button class="btn btn-sm btn-ghost" data-ex="${esc(t.info.w)}" style="padding:0 6px">${I.sound}<span>${highlightWord(t.info.w, t.info.h)}</span></button> <span class="ipa muted">${esc(t.info.ipa)}</span></div>
        <div class="small">${esc(t.info.tip)}</div></div></div>`
    )
    .join('');
  return `<div class="ipa-chips">${chips}</div><div class="ipa-rows">${rows}</div>`;
}

function bindExampleButtons(root) {
  $$('[data-ex]', root).forEach(
    (b) =>
      (b.onclick = (e) => {
        e.stopPropagation();
        playTerm({ term: b.dataset.ex });
      })
  );
}

function openIpaModal(ipa, word) {
  const m = openModal(`<div class="dict-head"><div><h2>${esc(word || 'Phiên âm')} <span class="ipa" style="color:var(--primary)">${esc(ipa)}</span></h2>
      <p class="muted small" style="margin:4px 0 0">Màu xanh = nguyên âm, màu cam = phụ âm. Bấm vào từng âm để nghe từ ví dụ.</p></div>
      <button class="icon-btn" data-close>${I.close}</button></div>
    ${word ? `<div class="row" style="margin:12px 0"><button class="btn btn-sm" id="sayUk">${I.sound} Nghe UK</button><button class="btn btn-sm" id="sayUs">${I.sound} Nghe US</button></div>` : ''}
    ${ipaBreakdownHTML(ipa)}
    <div class="acts"><a class="btn" href="#/ipa" data-close>Xem bảng IPA đầy đủ</a><button class="btn btn-primary" data-close>Đóng</button></div>`);
  $$('[data-close]', m.el).forEach((b) => (b.onclick = m.close));
  bindExampleButtons(m.el);
  $('#sayUk', m.el)?.addEventListener('click', () => playTerm({ term: word }, 'uk'));
  $('#sayUs', m.el)?.addEventListener('click', () => playTerm({ term: word }, 'us'));
}

// Bấm vào phiên âm ở bất kỳ đâu để xem phân tích
document.addEventListener(
  'click',
  (e) => {
    const el = e.target.closest('.ipa-link');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    openIpaModal(el.dataset.ipa, el.dataset.word);
  },
  true
);

async function viewIpa() {
  app.innerHTML = `<div class="page">
    <h1>Bảng phiên âm IPA</h1>
    <p class="muted">Cách đọc các ký hiệu phiên âm Cambridge Dictionary. Bấm vào ô để nghe từ ví dụ (giọng ${accent === 'uk' ? 'Anh – Anh' : 'Anh – Mỹ'}, đổi ở nút ${accent.toUpperCase()} trên thanh trên cùng).</p>
    <div class="q-card" style="margin-bottom:24px">
      <b>Phân tích phiên âm của một từ</b>
      <div class="write-row" style="margin-top:10px"><div style="position:relative;flex:1;display:flex"><input id="ipaWord" placeholder="Nhập từ tiếng Anh, ví dụ: comfortable" autocomplete="off" spellcheck="false" style="flex:1"></div>
        <button class="btn btn-primary btn-lg" id="ipaGo">Phân tích</button></div>
      <div id="ipaOut" style="margin-top:12px"></div>
    </div>
    ${IPA.groups
      .map(
        (g) => `<h2>${esc(g.title)}</h2><p class="muted small" style="margin-top:-8px">${esc(g.desc)}</p>
        <div class="ipa-grid">${g.items
          .map(
            (x) => `<button class="ipa-cell ${g.key === 'cons' ? 'cons' : 'vowel'}" data-ex="${esc(x.w)}">
              <span class="ipa sym">${esc(x.s)}</span>
              <span class="ex">${highlightWord(x.w, x.h)} <span class="ipa muted">${esc(x.ipa)}</span></span>
              <span class="tip">${esc(x.tip)}</span></button>`
          )
          .join('')}</div>`
      )
      .join('')}
    <h2>Ký hiệu khác</h2>
    <div class="ipa-grid">${IPA.marks
      .map((x) => `<div class="ipa-cell" style="cursor:default"><span class="ipa sym">${esc(x.s)}</span><span class="tip">${esc(x.tip)}</span></div>`)
      .join('')}</div>
  </div>`;
  bindExampleButtons(app);
  const input = $('#ipaWord');
  const analyze = async (word) => {
    word = (word || input.value).trim();
    if (!word) return;
    const out = $('#ipaOut');
    out.innerHTML = '<p class="muted loading-dots">Đang tra phiên âm</p>';
    try {
      const r = await define(word);
      const show = (acc) => (r[acc].ipa ? `<div style="margin-top:12px"><span class="pill ${acc === 'uk' ? '' : 'green'}">${acc.toUpperCase()}</span> <span class="ipa" style="font-size:20px">${esc(r[acc].ipa)}</span>
        <button class="icon-btn sm" data-say="${acc}">${I.sound}</button>${ipaBreakdownHTML(r[acc].ipa)}</div>` : '');
      out.innerHTML = r.uk.ipa || r.us.ipa ? `<h3 style="margin:0">${esc(r.word)} ${sourceBadge(r.source)}</h3>${show('uk')}${r.us.ipa !== r.uk.ipa ? show('us') : ''}` : '<p class="muted">Không tìm thấy phiên âm.</p>';
      bindExampleButtons(out);
      $$('[data-say]', out).forEach((b) => (b.onclick = () => playTerm({ term: r.word, audioUk: r.uk.audio, audioUs: r.us.audio }, b.dataset.say)));
    } catch (err) {
      out.innerHTML = `<p class="muted">Không tìm thấy “${esc(word)}”.</p>`;
    }
  };
  attachAutocomplete(input, { onPick: (x) => analyze(x.word), onEnter: (q) => analyze(q) });
  $('#ipaGo').onclick = () => analyze();
}

/* =====================================================================
   Tự cập nhật khi người khác thay đổi dữ liệu
   ===================================================================== */
let liveSource = null;
let pendingRefresh = false;
function startLive() {
  liveSource?.close();
  liveSource = null;
  const tk = LS.get('token', null);
  if (!me || !tk || !('EventSource' in window)) return;
  liveSource = new EventSource('/api/events?token=' + encodeURIComponent(tk));
  liveSource.onmessage = (e) => {
    let ev;
    try {
      ev = JSON.parse(e.data);
    } catch {
      return;
    }
    if (ev.by === me.id) return;
    handleLive(ev);
  };
}

/** Có thể vẽ lại màn hình hiện tại mà không làm mất thao tác của người dùng? */
function safeToRefresh() {
  const h = location.hash || '#/';
  const quietPage = /^(#\/?)?$|^#\/library$|^#\/classes$|^#\/docs$|^#\/class\/[\w-]+$|^#\/set\/[\w-]+$/.test(h);
  const typing = document.activeElement?.matches?.('input, textarea, select');
  return quietPage && !typing && !openModals.size;
}

const refreshSoon = debounce(() => {
  if (safeToRefresh()) {
    pendingRefresh = false;
    const y = window.scrollY;
    route().then(() => window.scrollTo(0, y));
  } else pendingRefresh = true;
}, 400);

function handleLive(ev) {
  const h = location.hash;
  const who = esc(ev.byName || 'Ai đó');
  if (ev.type === 'set') {
    const studying = h.startsWith('#/set/' + ev.setId + '/');
    if (ev.action === 'delete' && h.includes(ev.setId)) {
      toast(`${who} đã xóa học phần “${ev.title}”`, true);
      location.hash = '#/';
      return;
    }
    if (ev.action === 'filled') toast(`✨ Đã tự điền phiên âm/nghĩa cho ${ev.count} thẻ trong “${ev.title}”`);
    else if (studying) toast(`${who} vừa cập nhật học phần này — thay đổi sẽ có ở lượt học sau`);
    else if (ev.action === 'create') toast(`📌 ${who} vừa giao học phần mới: “${ev.title}”`);
    else toast(`${who} vừa cập nhật “${ev.title}”`);
  } else if (ev.type === 'class') {
    if (ev.action === 'join') toast(`${who} vừa vào lớp`);
    else if (ev.action === 'delete') toast(`${who} đã xóa một lớp học`);
  }
  // Tiến độ học sinh: chỉ cần vẽ lại, không báo
  refreshSoon();
}
// Khi người dùng gõ xong / đóng hộp thoại thì làm mới phần còn dang dở
document.addEventListener('focusout', () => pendingRefresh && refreshSoon());
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && me && refreshSoon());

/* =====================================================================
   Khởi động
   ===================================================================== */
async function init() {
  if (LS.get('token', null)) {
    try {
      me = await api('/auth/me');
    } catch {
      me = null;
    }
  }
  renderUserChip();
  startLive();
  route();
}
init();
