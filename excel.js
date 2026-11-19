// Xuất / nhập học phần bằng file Excel (.xlsx), kèm hình ảnh và phiên âm.
const ExcelJS = require('exceljs');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const PRIMARY = 'FF4255FF';
const HEADERS = ['STT', 'Thuật ngữ', 'Định nghĩa', 'Phiên âm UK', 'Phiên âm US', 'Từ loại', 'Ví dụ', 'Hình ảnh'];
const IMG_W = 110;
const IMG_H = 80;

const cellText = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if (v.text != null) return cellText(v.text);
    if (v.result != null) return String(v.result);
    if (v instanceof Date) return v.toLocaleDateString('vi-VN');
    if (v.error) return '';
  }
  return String(v);
};
const clean = (s) => cellText(s).replace(/\r\n/g, '\n').trim();

function safeSheetName(name, used) {
  let base = String(name || 'Học phần').replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 28) || 'Học phần';
  let n = base;
  for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base.slice(0, 26)} ${i}`;
  used.add(n.toLowerCase());
  return n;
}

async function imageForExcel(src, uploadDir) {
  if (!src || !src.startsWith('/uploads/')) return null;
  const file = path.join(uploadDir, path.basename(src));
  if (!fs.existsSync(file)) return null;
  try {
    const img = sharp(file, { animated: false }).rotate().resize(IMG_W * 3, IMG_H * 3, { fit: 'inside', withoutEnlargement: true });
    const { data, info } = await img.jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const scale = Math.min(IMG_W / info.width, IMG_H / info.height, 1);
    return { buffer: data, width: Math.round(info.width * scale), height: Math.round(info.height * scale) };
  } catch {
    return null;
  }
}

/** Mỗi học phần là một trang tính */
async function buildSetsWorkbook(sets, { uploadDir, ownerName }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Quizzy';
  wb.created = new Date();
  const used = new Set();
  for (const set of sets) {
    const ws = wb.addWorksheet(safeSheetName(set.title, used), { views: [{ state: 'frozen', ySplit: 5 }] });
    ws.columns = [
      { width: 6 }, { width: 24 }, { width: 40 }, { width: 18 }, { width: 18 }, { width: 13 }, { width: 42 }, { width: 18 },
    ];
    ws.getCell('A1').value = 'Học phần';
    ws.getCell('B1').value = set.title;
    ws.getCell('A2').value = 'Mô tả';
    ws.getCell('B2').value = set.description || '';
    ws.getCell('A3').value = 'Tạo bởi';
    ws.getCell('B3').value = ownerName(set) || '';
    ws.getCell('D3').value = `Xuất từ Quizzy · ${new Date().toLocaleDateString('vi-VN')}`;
    for (const c of ['A1', 'A2', 'A3']) ws.getCell(c).font = { bold: true, color: { argb: 'FF586380' } };
    ws.getCell('B1').font = { bold: true, size: 15, color: { argb: PRIMARY } };
    ws.getCell('D3').font = { italic: true, color: { argb: 'FF8A93AD' } };
    ws.mergeCells('B1:H1');
    ws.mergeCells('B2:H2');
    ws.getCell('B2').alignment = { wrapText: true, vertical: 'top' };

    const header = ws.getRow(5);
    header.values = HEADERS;
    header.height = 22;
    header.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRIMARY } };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    for (let i = 0; i < set.terms.length; i++) {
      const t = set.terms[i];
      const r = ws.getRow(6 + i);
      r.values = [i + 1, t.term, t.definition, t.ipaUk, t.ipaUs, t.pos, t.example, ''];
      r.alignment = { vertical: 'middle', wrapText: true };
      r.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
      r.getCell(2).font = { bold: true };
      for (const col of [4, 5]) r.getCell(col).font = { name: 'Segoe UI', color: { argb: 'FF586380' } };
      if (i % 2) r.eachCell({ includeEmpty: true }, (c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F7FB' } }));
      const img = await imageForExcel(t.image, uploadDir);
      if (img) {
        r.height = Math.max(r.height || 0, IMG_H * 0.75 + 8);
        const id = wb.addImage({ buffer: img.buffer, extension: 'jpeg' });
        ws.addImage(id, { tl: { col: 7.05, row: 5 + i + 0.05 }, ext: { width: img.width, height: img.height }, editAs: 'oneCell' });
      }
    }
  }
  if (!sets.length) wb.addWorksheet('Trống');
  return wb.xlsx.writeBuffer();
}

/* ---------- đọc file Excel ---------- */
const H = {
  term: /^(thuật ngữ|thuat ngu|term|terms|từ|từ vựng|tu vung|word|words|vocabulary|english|tiếng anh)$/i,
  definition: /^(định nghĩa|dinh nghia|nghĩa|nghia|definition|definitions|meaning|nghĩa tiếng việt|tiếng việt|vietnamese)$/i,
  ipaUk: /^(phiên âm uk|ipa uk|uk|phiên âm|phien am|ipa|pronunciation|phát âm)$/i,
  ipaUs: /^(phiên âm us|ipa us|us)$/i,
  pos: /^(từ loại|tu loai|pos|part of speech|loại từ|type)$/i,
  example: /^(ví dụ|vi du|example|examples|câu ví dụ)$/i,
  image: /^(hình ảnh|hinh anh|ảnh|image|picture|hình)$/i,
};

function parseSheet(ws, wb, fallbackTitle) {
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    rows[n] = row.values.map(clean); // row.values bắt đầu từ chỉ số 1
  });

  let headerRow = 0;
  const cols = {};
  for (let n = 1; n <= Math.min(15, rows.length - 1); n++) {
    const vals = rows[n];
    if (!vals) continue;
    const found = {};
    vals.forEach((v, c) => {
      for (const [k, re] of Object.entries(H)) if (!found[k] && re.test(v)) found[k] = c;
    });
    if (found.term && (found.definition || found.ipaUk)) {
      headerRow = n;
      Object.assign(cols, found);
      break;
    }
  }
  if (!headerRow) {
    // Không có tiêu đề cột: cột A = thuật ngữ, cột B = định nghĩa (giống file xuất của Quizlet)
    cols.term = 1;
    cols.definition = 2;
  }

  let title = '';
  let description = '';
  for (let n = 1; n < (headerRow || 1); n++) {
    const vals = rows[n] || [];
    const label = (vals[1] || '').toLowerCase();
    if (/^(học phần|tiêu đề|title|tên học phần)$/.test(label)) title = vals[2] || title;
    if (/^(mô tả|description)$/.test(label)) description = vals[2] || description;
  }
  if (!title) title = /^(sheet|trang tính)\s*\d*$/i.test(ws.name) ? fallbackTitle : ws.name;

  const images = new Map();
  for (const im of ws.getImages()) {
    const row = Math.floor(im.range.tl.nativeRow ?? im.range.tl.row) + 1;
    const media = wb.getImage(Number(im.imageId));
    if (media?.buffer && !images.has(row)) images.set(row, media);
  }

  const terms = [];
  for (let n = (headerRow || 0) + 1; n < rows.length; n++) {
    const v = rows[n];
    if (!v) continue;
    const get = (k) => (cols[k] ? v[cols[k]] || '' : '');
    const term = get('term');
    const definition = get('definition');
    if (!term && !definition) continue;
    let ipaUk = get('ipaUk');
    let ipaUs = get('ipaUs');
    if (ipaUk && !ipaUs && cols.ipaUs == null) ipaUs = ipaUk;
    const media = images.get(n);
    terms.push({
      term,
      definition,
      ipaUk,
      ipaUs,
      pos: get('pos'),
      example: get('example'),
      imageData: media ? { buffer: Buffer.from(media.buffer), ext: media.extension === 'jpeg' ? 'jpg' : media.extension } : null,
    });
  }
  return { title, description, terms };
}

async function parseWorkbook(buffer, fileName = 'Học phần nhập') {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const fallback = String(fileName).replace(/\.[^.]+$/, '') || 'Học phần nhập';
  return wb.worksheets.map((ws) => parseSheet(ws, wb, fallback)).filter((s) => s.terms.length);
}

/** Đọc CSV / văn bản: mỗi dòng "thuật ngữ<Tab hoặc , hoặc ;>định nghĩa" */
function parseCsv(text, fileName) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = ['\t', ';', ','].find((s) => lines.slice(0, 5).every((l) => l.includes(s))) || '\t';
  const split = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
      } else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };
  let rows = lines.map(split);
  if (rows[0] && H.term.test(rows[0][0])) rows = rows.slice(1);
  const terms = rows.map((r) => ({ term: r[0] || '', definition: r[1] || '', ipaUk: r[2] || '', ipaUs: r[3] || r[2] || '', pos: '', example: '' }))
    .filter((t) => t.term || t.definition);
  return terms.length ? [{ title: String(fileName).replace(/\.[^.]+$/, ''), description: '', terms }] : [];
}

/* ---------- kết quả học của học sinh ---------- */
const STATUS = [
  { label: 'Chưa học', argb: 'FFE9EBF2' },
  { label: 'Đang học', argb: 'FFFFE7CC' },
  { label: 'Đã thuộc', argb: 'FFD3F4E6' },
];

async function buildProgressWorkbook({ student, set, progress }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Quizzy';
  const ws = wb.addWorksheet('Kết quả học', { views: [{ state: 'frozen', ySplit: 12 }] });
  ws.columns = [{ width: 6 }, { width: 24 }, { width: 20 }, { width: 40 }, { width: 14 }, { width: 10 }];
  const levels = set.terms.map((t) => progress.learn[t.id] || 0);
  const count = (l) => levels.filter((x) => x === l).length;
  const pct = set.terms.length ? Math.round((count(2) / set.terms.length) * 100) : 0;
  const lastTest = progress.tests[progress.tests.length - 1];
  const info = [
    ['Học sinh', student.name],
    ['Học phần', set.title],
    ['Ngày xuất', new Date().toLocaleString('vi-VN')],
    ['Đã thuộc', `${count(2)} / ${set.terms.length} thẻ (${pct}%)`],
    ['Đang học', `${count(1)} thẻ`],
    ['Chưa học', `${count(0)} thẻ`],
    ['Kiểm tra gần nhất', lastTest ? `${lastTest.score}/${lastTest.total} (${Math.round((lastTest.score / lastTest.total) * 100)}%) – ${new Date(lastTest.at).toLocaleString('vi-VN')}` : 'Chưa làm'],
    ['Ghép thẻ nhanh nhất', progress.matchBest ? `${progress.matchBest.toFixed(1)} giây` : '—'],
    ['Chính tả', progress.spell ? `${progress.spell.correct}/${progress.spell.total} từ đúng` : '—'],
    ['Học lần cuối', progress.lastStudied ? new Date(progress.lastStudied).toLocaleString('vi-VN') : '—'],
  ];
  info.forEach(([k, v], i) => {
    const r = ws.getRow(1 + i);
    r.getCell(1).value = k;
    r.getCell(3).value = v;
    ws.mergeCells(1 + i, 1, 1 + i, 2);
    ws.mergeCells(1 + i, 3, 1 + i, 6);
    r.getCell(1).font = { bold: true, color: { argb: 'FF586380' } };
  });
  ws.getCell('C1').font = { bold: true, size: 14, color: { argb: PRIMARY } };

  const header = ws.getRow(12);
  header.values = ['STT', 'Thuật ngữ', 'Phiên âm', 'Định nghĩa', 'Trạng thái', 'Gắn sao'];
  header.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRIMARY } };
    c.alignment = { horizontal: 'center' };
  });
  set.terms.forEach((t, i) => {
    const st = STATUS[levels[i]];
    const r = ws.getRow(13 + i);
    r.values = [i + 1, t.term, t.ipaUk || t.ipaUs, t.definition, st.label, progress.starred.includes(t.id) ? '★' : ''];
    r.alignment = { vertical: 'middle', wrapText: true };
    r.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.argb } };
    r.getCell(6).font = { color: { argb: 'FFFFB800' }, size: 13 };
    r.getCell(6).alignment = { horizontal: 'center' };
  });

  if (progress.tests.length) {
    const t = wb.addWorksheet('Lịch sử kiểm tra');
    t.columns = [{ header: 'Lần', width: 6 }, { header: 'Thời gian', width: 24 }, { header: 'Đúng', width: 10 }, { header: 'Tổng', width: 10 }, { header: 'Điểm (%)', width: 10 }];
    t.getRow(1).font = { bold: true };
    progress.tests.forEach((x, i) =>
      t.addRow([i + 1, new Date(x.at).toLocaleString('vi-VN'), x.score, x.total, Math.round((x.score / x.total) * 100)])
    );
  }
  return wb.xlsx.writeBuffer();
}

module.exports = { buildSetsWorkbook, parseWorkbook, parseCsv, buildProgressWorkbook };
