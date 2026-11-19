// Tra từ điển: Cambridge Dictionary là nguồn chính.
// Nếu Cambridge không truy cập được (Cloudflare chặn, lỗi mạng...), tự động chuyển sang
// Wiktionary (phiên âm UK/US + audio + định nghĩa), Datamuse (gợi ý từ) và Google Dịch (nghĩa tiếng Việt).

const cheerio = require('cheerio');

const CAMBRIDGE = 'https://dictionary.cambridge.org';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const BOT_UA = 'Quizzy/1.0 (vocabulary flashcards app)';
const TIMEOUT_MS = 8000;
// Sau khi bị Cambridge chặn, bỏ qua Cambridge trong khoảng này để phản hồi nhanh.
const CAMBRIDGE_COOLDOWN_MS = 10 * 60 * 1000;

let cambridgeBlockedUntil = 0;
let cambridgeLastError = null;

// ---------- cache đơn giản trong bộ nhớ ----------
const cache = new Map();
const CACHE_MAX = 5000;

// Lưu kết quả tra từ ra ổ đĩa để lần sau không phải tra lại (và đỡ bị giới hạn lượt tra)
let diskFile = null;
let diskTimer = null;
function setCacheFile(file) {
  diskFile = file;
  try {
    const obj = JSON.parse(require('fs').readFileSync(file, 'utf8'));
    for (const [k, v] of Object.entries(obj)) if (v.expires > Date.now()) cache.set(k, v);
  } catch {}
}
function persist() {
  if (!diskFile) return;
  clearTimeout(diskTimer);
  diskTimer = setTimeout(() => {
    const obj = {};
    for (const [k, v] of cache) if (k.startsWith('def:') && !v.value?.transient) obj[k] = v;
    require('fs').writeFile(diskFile, JSON.stringify(obj), () => {});
  }, 2000);
}
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  // Kết quả tạm thời (nguồn bị lỗi/giới hạn tốc độ) chỉ giữ 1 phút để còn thử lại.
  if (value && value.noCache) return value;
  const ttl = value && value.transient ? 60 * 1000 : ttlMs;
  cache.set(key, { value, expires: Date.now() + ttl });
  if (key.startsWith('def:') && !value?.transient) persist();
  return value;
}

class BlockedError extends Error {}
class NotFoundError extends Error {}

async function fetchRaw(url, { ua = BOT_UA, accept = '*/*' } = {}) {
  return fetch(url, {
    headers: { 'User-Agent': ua, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
}

async function fetchJson(url, opts) {
  const res = await fetchRaw(url, { accept: 'application/json', ...opts });
  if (res.status === 404) throw new NotFoundError(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const uniq = (arr) => [...new Set(arr.filter(Boolean))];

// =====================================================================
// CAMBRIDGE
// =====================================================================

function cambridgeAvailable() {
  return Date.now() >= cambridgeBlockedUntil;
}

function markCambridgeBlocked(reason) {
  cambridgeBlockedUntil = Date.now() + CAMBRIDGE_COOLDOWN_MS;
  cambridgeLastError = reason;
}

async function fetchCambridge(path, accept = 'text/html') {
  if (!cambridgeAvailable()) throw new BlockedError(cambridgeLastError || 'cooldown');
  let res;
  try {
    res = await fetchRaw(CAMBRIDGE + path, { ua: BROWSER_UA, accept });
  } catch (err) {
    markCambridgeBlocked(`network: ${err.message}`);
    throw new BlockedError(err.message);
  }
  const body = await res.text();
  if (res.status === 403 || res.status === 503 || /<title>Just a moment/i.test(body)) {
    markCambridgeBlocked(`HTTP ${res.status} (Cloudflare)`);
    throw new BlockedError(`HTTP ${res.status}`);
  }
  if (res.status === 404) throw new NotFoundError(path);
  if (!res.ok) throw new Error(`Cambridge HTTP ${res.status}`);
  cambridgeLastError = null;
  return { body, url: res.url };
}

async function cambridgeSuggest(q) {
  const { body } = await fetchCambridge(
    `/autocomplete/amp?dataset=english&q=${encodeURIComponent(q)}`,
    'application/json'
  );
  const list = JSON.parse(body);
  return list.map((x) => (typeof x === 'string' ? x : x.word)).filter(Boolean);
}

function cambridgeAudio(src) {
  if (!src) return null;
  return src.startsWith('http') ? src : CAMBRIDGE + src;
}

// Phân tích trang từ điển Cambridge (dùng được cho cả english và english-vietnamese).
function parseCambridgePage(html) {
  const $ = cheerio.load(html);
  const entries = [];
  let blocks = $('.pr.entry-body__el');
  if (!blocks.length) blocks = $('.entry-body__el, .pr.dictionary .di-body');
  blocks.each((_, el) => {
    const e = $(el);
    const pron = (cls) => {
      const p = e.find(`.${cls}.dpron-i, span.${cls}`).first();
      const ipa = clean(p.find('.ipa').first().text());
      const audio = cambridgeAudio(p.find('source[type="audio/mpeg"]').first().attr('src'));
      return { ipa: ipa ? `/${ipa}/` : null, audio };
    };
    let uk = pron('uk');
    let us = pron('us');
    if (!uk.ipa && !us.ipa) {
      const ipa = clean(e.find('.ipa').first().text());
      if (ipa) uk = us = { ipa: `/${ipa}/`, audio: null };
    }
    const senses = [];
    e.find('.def-block, .ddef_block').each((__, b) => {
      const blk = $(b);
      const def = clean(blk.find('.def, .ddef_d').first().text()).replace(/:$/, '');
      const vi = uniq(blk.find('.trans, .dtrans').map((___, t) => clean($(t).text())).get());
      const examples = uniq(blk.find('.examp .eg, .dexamp .deg').map((___, t) => clean($(t).text())).get()).slice(0, 2);
      const level = clean(blk.find('.epp-xref, .dxref').first().text()) || null;
      if (def || vi.length) senses.push({ def, vi: vi.join(', '), examples, level });
    });
    const headword = clean(e.find('.headword, .hw').first().text());
    const pos = clean(e.find('.posgram .pos, .pos-header .pos, .pos').first().text());
    if (senses.length || uk.ipa || us.ipa) entries.push({ headword, pos, uk, us, senses });
  });
  return entries;
}

async function cambridgeLookup(word) {
  const slug = encodeURIComponent(word.toLowerCase().replace(/\s+/g, '-'));
  const [en, vi] = await Promise.allSettled([
    fetchCambridge(`/dictionary/english/${slug}`),
    fetchCambridge(`/dictionary/english-vietnamese/${slug}`),
  ]);
  if (en.status === 'rejected' && vi.status === 'rejected') throw en.reason;

  const enEntries = en.status === 'fulfilled' ? parseCambridgePage(en.value.body) : [];
  const viEntries = vi.status === 'fulfilled' ? parseCambridgePage(vi.value.body) : [];
  // Cambridge chuyển hướng về trang chủ khi không có từ.
  if (!enEntries.length && !viEntries.length) throw new NotFoundError(word);

  const entries = enEntries.length ? enEntries : viEntries;
  const first = entries.find((x) => x.uk.ipa || x.us.ipa) || entries[0] || {};
  const viTrans = uniq(viEntries.flatMap((x) => x.senses.map((s) => s.vi))).slice(0, 6);

  return {
    word: first.headword || word,
    source: 'cambridge',
    sourceUrl: `${CAMBRIDGE}/dictionary/english/${slug}`,
    uk: first.uk || { ipa: null, audio: null },
    us: first.us || { ipa: null, audio: null },
    vi: viTrans.join('; '),
    entries: entries.slice(0, 6).map((x) => ({
      pos: x.pos,
      ipaUk: x.uk.ipa,
      ipaUs: x.us.ipa,
      senses: x.senses.slice(0, 6),
    })),
  };
}

// =====================================================================
// NGUỒN DỰ PHÒNG: Wiktionary + Datamuse + Google Dịch
// =====================================================================

function englishSection(wikitext) {
  const start = wikitext.indexOf('==English==');
  if (start < 0) return '';
  const rest = wikitext.slice(start + 11);
  const next = rest.search(/\n==[^=]/);
  return next < 0 ? rest : rest.slice(0, next);
}

// Trả về danh sách giọng ('uk'/'us') được nêu; [] = không ghi giọng; null = giọng khác (Úc, Scotland...).
function accentsOf(qualifier) {
  if (!clean(qualifier)) return [];
  const acc = [];
  if (/\b(US|GA|GenAm|General American|American|Canada|CA|cot-caught|non-cot-caught)\b/.test(qualifier)) acc.push('us');
  if (/\b(UK|RP|Received Pronunciation|SSB|British)\b/.test(qualifier)) acc.push('uk');
  return acc.length ? acc : null;
}

function parseWiktionaryPron(wikitext) {
  const en = englishSection(wikitext);
  const out = { uk: { ipa: null, audio: null }, us: { ipa: null, audio: null } };
  const generic = { ipa: null, audio: null };
  const assign = (field, acc, value) => {
    if (acc === null) return;
    if (!acc.length) { if (!generic[field]) generic[field] = value; return; }
    for (const k of acc) if (!out[k][field]) out[k][field] = value;
  };

  for (const line of en.split('\n')) {
    // Giọng có thể ghi ở {{a|UK}} hoặc tham số a=UK của mẫu khác trên cùng dòng (vd. {{enPR|…|a=UK}})
    const lineQual = [
      ...[...line.matchAll(/\{\{(?:a|accent)\|([^}]*)\}\}/g)].map((m) => m[1]),
      ...[...line.matchAll(/\|a=([^|}]*)/g)].map((m) => m[1]),
    ].join(',');
    for (const m of line.matchAll(/\{\{IPA\|en\|([^}]*)\}\}/g)) {
      const parts = m[1].split('|').map((p) => p.trim());
      const prons = parts.filter((p) => !p.includes('=') && p.startsWith('/'));
      if (!prons.length) continue;
      const named = parts.filter((p) => /^(a|q|qq)\d*=/.test(p)).map((p) => p.split('=')[1]).join(',');
      assign('ipa', accentsOf(`${named},${lineQual}`.replace(/\|/g, ',')), prons[0]);
    }
    for (const m of line.matchAll(/\{\{audio\|en\|([^|}]+)([^}]*)\}\}/g)) {
      const file = m[1].trim();
      let acc = accentsOf(`${m[2].replace(/\|/g, ',')},${lineQual}`.replace(/^,|,$/g, ''));
      if (acc && !acc.length) acc = /^en-uk/i.test(file) ? ['uk'] : /^en-us/i.test(file) ? ['us'] : /^en-(au|ca|nz)/i.test(file) ? null : [];
      assign('audio', acc, `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}`);
    }
  }
  for (const k of ['uk', 'us']) {
    if (!out[k].ipa) out[k].ipa = generic.ipa;
    if (!out[k].audio) out[k].audio = generic.audio;
    // Wiktionary dùng dấu chấm tách âm tiết và ký hiệu ɹ – chuẩn hoá cho giống Cambridge.
    if (out[k].ipa) out[k].ipa = out[k].ipa.replace(/\./g, '').replace(/ɹ/g, 'r').replace(/ɛ/g, 'e').replace(/d͡ʒ/g, 'dʒ').replace(/t͡ʃ/g, 'tʃ');
  }
  return out;
}

function htmlToText(html) {
  const $ = cheerio.load(`<div>${html || ''}</div>`);
  $('style, sup, .reference').remove();
  return clean($('div').first().text());
}

async function wiktionaryLookup(word) {
  const title = encodeURIComponent(word.replace(/ /g, '_'));
  const [wt, defs] = await Promise.allSettled([
    fetchJson(`https://en.wiktionary.org/w/api.php?action=parse&page=${title}&prop=wikitext&format=json&formatversion=2&redirects=1`),
    fetchJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${title}`),
  ]);
  const pron = wt.status === 'fulfilled' && wt.value.parse ? parseWiktionaryPron(wt.value.parse.wikitext) : null;
  const enDefs = defs.status === 'fulfilled' ? defs.value.en || [] : [];
  if (!pron && !enDefs.length) {
    const failed = [wt, defs].find((x) => x.status === 'rejected' && !(x.reason instanceof NotFoundError));
    if (failed) throw failed.reason;
    throw new NotFoundError(word);
  }

  const entries = enDefs.filter((d) => !/^(symbol|letter|number)$/i.test(d.partOfSpeech)).slice(0, 6).map((d) => ({
    pos: (d.partOfSpeech || '').toLowerCase(),
    ipaUk: pron?.uk.ipa || null,
    ipaUs: pron?.us.ipa || null,
    senses: (d.definitions || [])
      .map((s) => ({
        def: htmlToText(s.definition),
        vi: '',
        examples: (s.examples || []).slice(0, 2).map(htmlToText).filter(Boolean),
        level: null,
      }))
      .filter((s) => s.def)
      .slice(0, 6),
  })).filter((e) => e.senses.length);

  return {
    word,
    source: 'wiktionary',
    sourceUrl: `https://en.wiktionary.org/wiki/${title}`,
    uk: pron?.uk || { ipa: null, audio: null },
    us: pron?.us || { ipa: null, audio: null },
    vi: '',
    entries,
  };
}

const POS_VI = {
  noun: 'danh từ', verb: 'động từ', adjective: 'tính từ', adverb: 'trạng từ',
  pronoun: 'đại từ', preposition: 'giới từ', conjunction: 'liên từ', interjection: 'thán từ',
  exclamation: 'thán từ', determiner: 'từ hạn định', article: 'mạo từ', abbreviation: 'viết tắt',
};

// Nghĩa tiếng Việt từ Google Dịch: trả về { short, byPos: { verb: ['chạy', ...] } }
async function googleVietnamese(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&dt=bd&q=${encodeURIComponent(text)}`;
  const data = await fetchJson(url);
  const short = clean((data[0] || []).map((x) => x[0]).join(''));
  const byPos = {};
  for (const grp of data[1] || []) {
    const pos = grp[0];
    const scored = (grp[2] || []).map((x) => ({ w: x[0], s: x[3] || 0 }));
    scored.sort((a, b) => b.s - a.s);
    byPos[pos] = uniq([short, ...scored.map((x) => x.w)].filter((w) => w && w.toLowerCase() !== text.toLowerCase())).slice(0, 4);
  }
  return { short, byPos };
}

// ---------- ARPAbet (Datamuse) -> IPA kiểu Mỹ, dùng khi chưa có phiên âm chuẩn ----------
const ARPA = {
  AA: 'ɑː', AE: 'æ', AH: 'ʌ', AO: 'ɔː', AW: 'aʊ', AY: 'aɪ', EH: 'e', ER: 'ɝː', EY: 'eɪ', IH: 'ɪ',
  IY: 'iː', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'uː', B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f',
  G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'r', S: 's',
  SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};
const ONSET2 = /^(S[PTKMNLW]|[PBKGF][LR]|[TD][RW]|TH[R]|SH[R]|[PBTDKGMFVHN]Y|[KG]W)$/;

function arpabetToIpa(pron) {
  const ph = pron.trim().split(/\s+/).filter(Boolean);
  const isVowel = (p) => /\d$/.test(p);
  const out = ph.map((p) => {
    const base = p.replace(/\d$/, '');
    const stress = p.match(/\d$/)?.[0];
    if (base === 'AH' && stress === '0') return 'ə';
    if (base === 'ER' && stress === '0') return 'ɚ';
    if (base === 'IH' && stress === '0') return 'ɪ';
    return ARPA[base] || '';
  });
  // Đặt dấu nhấn trước phụ âm đầu của âm tiết.
  const marks = [];
  ph.forEach((p, i) => {
    if (!isVowel(p)) return;
    const st = p.slice(-1);
    if (st !== '1' && st !== '2') return;
    let j = i;
    const cons = [];
    while (j > 0 && !isVowel(ph[j - 1])) { cons.unshift(ph[j - 1].replace(/\d$/, '')); j--; }
    let take = 0;
    if (j === 0) take = cons.length;
    else if (cons.length === 1) take = 1;
    else if (cons.length >= 2) take = ONSET2.test(cons.slice(-2).join('')) ? 2 : 1;
    marks.push({ at: i - take, mark: st === '1' ? 'ˈ' : 'ˌ' });
  });
  for (const m of marks.sort((a, b) => b.at - a.at)) out[m.at] = m.mark + out[m.at];
  const ipa = out.join('');
  return ipa && marks.length + ph.length > 1 ? `/${ipa.replace(/^ˈ(?=[^ˈ]*$)/, ph.filter(isVowel).length === 1 ? '' : 'ˈ')}/` : null;
}

async function datamuseSuggest(q, max = 8) {
  const enc = encodeURIComponent(q);
  // /sug cho thứ tự gợi ý tốt nhất, /words cho từ loại, định nghĩa và phát âm
  const [sug, words] = await Promise.allSettled([
    fetchJson(`https://api.datamuse.com/sug?s=${enc}&max=${max}`),
    fetchJson(`https://api.datamuse.com/words?sp=${enc}*&md=dpr&max=40`),
  ]);
  if (words.status === 'rejected' && sug.status === 'rejected') throw words.reason;
  const meta = new Map((words.status === 'fulfilled' ? words.value : []).map((x) => [x.word, x]));
  const order = sug.status === 'fulfilled' && sug.value.length ? sug.value.map((x) => x.word) : [...meta.keys()];
  const list = order.slice(0, max).map((w) => meta.get(w) || { word: w });
  return list.map((x) => {
    const tags = x.tags || [];
    const pron = tags.find((t) => t.startsWith('pron:'));
    const posTag = tags.find((t) => ['n', 'v', 'adj', 'adv'].includes(t));
    const def = (x.defs || [])[0];
    return {
      word: x.word,
      pos: { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb' }[posTag] || '',
      ipa: pron ? arpabetToIpa(pron.slice(5)) : null,
      def: def ? clean(def.split('\t')[1]) : '',
      approx: true,
    };
  });
}

// =====================================================================
// API công khai
// =====================================================================

async function suggest(q) {
  q = clean(q).toLowerCase();
  if (!q) return { source: null, items: [] };
  return cached(`sug:${q}`, 60 * 60 * 1000, async () => {
    const dm = datamuseSuggest(q).catch((err) => {
      console.warn('[datamuse]', err.message, err.cause?.code || '');
      return null;
    });
    if (cambridgeAvailable()) {
      try {
        const words = (await cambridgeSuggest(q)).slice(0, 10);
        const meta = new Map(((await dm) || []).map((x) => [x.word, x]));
        return {
          source: 'cambridge',
          items: words.map((w) => ({ word: w, pos: '', ipa: null, def: '', ...meta.get(w), word: w })),
        };
      } catch (err) {
        if (!(err instanceof BlockedError)) console.warn('[cambridge suggest]', err.message);
      }
    }
    const items = await dm;
    if (!items) return { source: 'datamuse', items: [], noCache: true };
    // Ưu tiên từ bắt đầu đúng bằng chuỗi gõ vào.
    items.sort((a, b) => (b.word === q) - (a.word === q));
    return { source: 'datamuse', items };
  });
}

async function lookup(word) {
  word = clean(word);
  if (!word) throw new NotFoundError('empty');
  return cached(`def:${word.toLowerCase()}`, 30 * 24 * 60 * 60 * 1000, async () => {
    let result = null;
    let transient = false;
    // Dịch tiếng Việt chạy song song với tra từ điển
    const viPromise = googleVietnamese(word).catch((err) => {
      console.warn('[translate]', err.message);
      return null;
    });
    // Tra Wiktionary song song để không phải chờ khi Cambridge bị chặn
    let wikiP = null;
    const wiki = () => (wikiP ||= wiktionaryLookup(word));
    if (cambridgeAvailable()) {
      wiki().catch(() => {});
      try {
        result = await cambridgeLookup(word);
      } catch (err) {
        if (!(err instanceof BlockedError) && !(err instanceof NotFoundError)) console.warn('[cambridge]', err.message);
      }
    }
    if (!result) {
      try {
        result = await wiki();
      } catch (err) {
        if (!(err instanceof NotFoundError)) {
          transient = true;
          console.warn('[wiktionary]', err.message);
        }
      }
    }
    if (result && !result.uk.ipa && !result.us.ipa) {
      const dm = (await datamuseSuggest(word).catch(() => [])).find((x) => x.word.toLowerCase() === word.toLowerCase());
      if (dm?.ipa) {
        result.uk.ipa = result.us.ipa = dm.ipa;
        result.ipaApprox = true;
      }
    }
    if (!result) {
      // Vẫn thử lấy phiên âm gần đúng từ Datamuse.
      const dm = (await datamuseSuggest(word).catch(() => [])).find((x) => x.word.toLowerCase() === word.toLowerCase());
      result = {
        word, source: dm ? 'datamuse' : 'none', sourceUrl: null,
        uk: { ipa: dm?.ipa || null, audio: null }, us: { ipa: dm?.ipa || null, audio: null },
        vi: '', entries: dm?.def ? [{ pos: dm.pos, ipaUk: dm.ipa, ipaUs: dm.ipa, senses: [{ def: dm.def, vi: '', examples: [] }] }] : [],
      };
    }

    // Bổ sung nghĩa tiếng Việt nếu Cambridge (bản Anh–Việt) không có.
    if (!result.vi) {
      const g = await viPromise;
      if (g) {
        result.vi = g.short;
        result.viByPos = Object.fromEntries(
          Object.entries(g.byPos).map(([pos, list]) => [POS_VI[pos] || pos, list])
        );
        result.viSource = 'google';
        for (const e of result.entries) {
          const list = g.byPos[e.pos];
          if (list?.length && e.senses[0] && !e.senses[0].vi) e.senses[0].vi = list.slice(0, 3).join(', ');
        }
      }
    } else {
      result.viSource = 'cambridge';
    }
    if (transient) result.transient = true;
    result.found = Boolean(result.uk.ipa || result.us.ipa || result.entries.length || result.vi);
    return result;
  });
}

function status() {
  return {
    cambridgeAvailable: cambridgeAvailable(),
    cambridgeLastError,
    retryInSeconds: Math.max(0, Math.round((cambridgeBlockedUntil - Date.now()) / 1000)),
  };
}

const AUDIO_HOSTS = ['dictionary.cambridge.org', 'commons.wikimedia.org', 'upload.wikimedia.org'];

async function fetchAudio(url) {
  const u = new URL(url);
  if (!AUDIO_HOSTS.includes(u.hostname)) throw new Error('host not allowed');
  const res = await fetchRaw(url, {
    ua: u.hostname.endsWith('cambridge.org') ? BROWSER_UA : BOT_UA,
    accept: 'audio/*',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!/^(audio|application\/ogg|video\/ogg)/.test(type)) throw new Error(`not audio: ${type}`);
  return { type, buffer: Buffer.from(await res.arrayBuffer()) };
}

module.exports = { setCacheFile, suggest, lookup, status, fetchAudio, arpabetToIpa, parseCambridgePage, parseWiktionaryPron, NotFoundError };
