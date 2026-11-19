// Tìm ảnh minh họa miễn phí (Openverse, dự phòng Wikimedia Commons) và tải ảnh về máy chủ.
const dns = require('dns').promises;
const net = require('net');

const UA = 'Quizzy/1.0 (vocabulary flashcards app)';
const MAX_BYTES = 6 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

const extFor = (contentType) => TYPES[String(contentType || '').split(';')[0].trim().toLowerCase()] || null;

const cache = new Map();

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function openverse(q) {
  const j = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=20&mature=false`);
  return (j.results || []).map((r) => ({
    thumb: r.thumbnail || r.url,
    url: r.url,
    title: r.title || '',
    credit: [r.creator, r.license ? `CC ${r.license.toUpperCase()}` : '', r.source].filter(Boolean).join(' · '),
  }));
}

async function commons(q) {
  const j = await getJson(
    `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&gsrnamespace=6&gsrlimit=20&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=400&format=json&formatversion=2`
  );
  return (j.query?.pages || [])
    .filter((p) => p.imageinfo?.[0]?.thumburl)
    .map((p) => {
      const ii = p.imageinfo[0];
      const artist = (ii.extmetadata?.Artist?.value || '').replace(/<[^>]+>/g, '').trim();
      return {
        thumb: ii.thumburl,
        url: ii.thumburl,
        title: p.title.replace(/^File:/, ''),
        credit: [artist, ii.extmetadata?.LicenseShortName?.value, 'Wikimedia Commons'].filter(Boolean).join(' · '),
      };
    });
}

async function search(q) {
  q = q.trim().slice(0, 100);
  if (!q) return { items: [] };
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  let items = [];
  let source = 'openverse';
  try {
    items = await openverse(q);
  } catch (err) {
    console.warn('[openverse]', err.message);
  }
  if (!items.length) {
    source = 'commons';
    items = await commons(q).catch((err) => {
      console.warn('[commons]', err.message);
      return [];
    });
  }
  const value = { source, items };
  if (items.length) cache.set(key, { value, expires: Date.now() + 6 * 3600 * 1000 });
  return value;
}

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) return /^(::1|fc|fd|fe80|::ffff:(127|10|192\.168|169\.254)\.)/i.test(ip) || ip === '::';
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// Tải ảnh từ Internet về để ảnh không bị mất khi trang gốc thay đổi.
async function download(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error('Đường dẫn ảnh không hợp lệ');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Chỉ hỗ trợ đường dẫn http/https');
  const { address } = await dns.lookup(u.hostname);
  if (isPrivateIp(address)) throw new Error('Không được tải ảnh từ mạng nội bộ');
  const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.5' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Không tải được ảnh (HTTP ${res.status})`);
  const ext = extFor(res.headers.get('content-type'));
  if (!ext) throw new Error('Đường dẫn không phải là ảnh JPG/PNG/GIF/WEBP');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('Ảnh quá lớn (tối đa 6 MB)');
  return { buffer: buf, ext };
}

module.exports = { search, download, extFor };
