const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const dict = require('./dictionary');
const images = require('./images');
const excel = require('./excel');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.QUIZZY_DATA || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const LEGACY_SETS_FILE = path.join(DATA_DIR, 'sets.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
dict.setCacheFile(path.join(DATA_DIR, 'dict-cache.json'));

/* =====================================================================
   Lưu trữ: một file JSON duy nhất
   ===================================================================== */
function loadDb() {
  let db;
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    db = {};
  }
  db.users ||= [];
  db.sessions ||= {};
  db.classes ||= [];
  db.sets ||= [];
  db.docs ||= [];
  db.progress ||= {};
  // Chuyển dữ liệu từ phiên bản cũ (chưa có tài khoản)
  if (!db.sets.length && fs.existsSync(LEGACY_SETS_FILE)) {
    try {
      db.sets = JSON.parse(fs.readFileSync(LEGACY_SETS_FILE, 'utf8')).map((s) => ({ ...s, ownerId: null }));
    } catch {}
  }
  return db;
}
const db = loadDb();
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DB_FILE);
  }, 150);
}

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const userById = (id) => db.users.find((u) => u.id === id);
const publicUser = (u) => u && { id: u.id, name: u.name, role: u.role };

/* =====================================================================
   Tài khoản (tên + mã PIN)
   ===================================================================== */
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');

function newSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { userId: user.id, createdAt: now() };
  save();
  return token;
}

function auth(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const s = token && db.sessions[token];
  req.user = s ? userById(s.userId) : null;
  req.token = token;
  next();
}
function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });
  next();
}
function requireTeacher(req, res, next) {
  if (req.user?.role !== 'teacher') return res.status(403).json({ error: 'Chỉ giáo viên mới làm được việc này' });
  next();
}

/* =====================================================================
   Quyền truy cập học phần
   ===================================================================== */
const classesOf = (user) =>
  db.classes.filter((c) => c.teacherId === user.id || c.studentIds.includes(user.id));

function canView(set, user) {
  if (!set) return false;
  if (set.ownerId === user.id) return true;
  return classesOf(user).some((c) => c.setIds.includes(set.id));
}
const canEdit = (set, user) => set && set.ownerId === user.id;

function setSummary(set, user) {
  const { terms, ...rest } = set;
  const viaClasses = classesOf(user).filter((c) => c.setIds.includes(set.id) && set.ownerId !== user.id);
  return {
    ...rest,
    termCount: terms.length,
    preview: terms.slice(0, 3).map((t) => ({ term: t.term })),
    isOwner: set.ownerId === user.id,
    ownerName: userById(set.ownerId)?.name || 'Không rõ',
    assignedVia: viaClasses.map((c) => c.name),
  };
}

function sanitizeTerms(list) {
  const str = (v, max = 4000) => String(v ?? '').trim().slice(0, max);
  return (Array.isArray(list) ? list : [])
    .map((t) => ({
      id: typeof t.id === 'string' && t.id ? t.id : uid(),
      term: str(t.term, 1000),
      definition: str(t.definition),
      ipaUk: str(t.ipaUk, 120),
      ipaUs: str(t.ipaUs, 120),
      audioUk: str(t.audioUk, 600),
      audioUs: str(t.audioUs, 600),
      pos: str(t.pos, 60),
      example: str(t.example, 600),
      image: str(t.image, 1000),
      imageCredit: str(t.imageCredit, 300),
    }))
    .filter((t) => t.term || t.definition);
}

/* =====================================================================
   Đồng bộ thời gian thực (Server-Sent Events)
   ===================================================================== */
const streams = new Map(); // userId -> Set<res>

/** Những người cần biết khi học phần thay đổi: chủ học phần + mọi thành viên lớp được giao */
function audienceOfSet(setId, ownerId) {
  const ids = new Set(ownerId ? [ownerId] : []);
  for (const c of db.classes)
    if (c.setIds.includes(setId)) {
      ids.add(c.teacherId);
      c.studentIds.forEach((id) => ids.add(id));
    }
  return ids;
}
const audienceOfClass = (c) => new Set([c.teacherId, ...c.studentIds]);

function notify(userIds, event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const id of userIds) for (const res of streams.get(id) || []) res.write(data);
}

/* =====================================================================
   Ứng dụng
   ===================================================================== */
const app = express();
// Khi chạy sau proxy của dịch vụ hosting (Render, Railway, Fly…) để lấy đúng IP người dùng
app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));
app.use('/api', auth);

// ---------- tài khoản ----------
app.get('/api/users', (req, res) => {
  res.json(db.users.map(publicUser));
});

app.post('/api/auth/register', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const role = req.body.role === 'teacher' ? 'teacher' : 'student';
  const pin = String(req.body.pin || '');
  if (name.length < 2) return res.status(400).json({ error: 'Tên cần ít nhất 2 ký tự' });
  if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: 'Mã PIN gồm 4–8 chữ số' });
  if (db.users.some((u) => u.name.toLowerCase() === name.toLowerCase()))
    return res.status(409).json({ error: 'Tên này đã có người dùng' });
  const salt = crypto.randomBytes(16).toString('hex');
  const user = { id: uid(), name, role, salt, pinHash: hashPin(pin, salt), createdAt: now() };
  db.users.push(user);
  // Học phần từ phiên bản cũ (chưa có chủ) thuộc về tài khoản đầu tiên
  for (const s of db.sets) if (!s.ownerId) s.ownerId = user.id;
  save();
  res.status(201).json({ token: newSession(user), user: publicUser(user) });
});

// Chống dò mã PIN: sai 5 lần thì khóa tài khoản 10 phút (theo từng tài khoản và từng IP)
const failures = new Map();
const LOCK_AFTER = 5;
const LOCK_MS = 10 * 60 * 1000;
function lockedFor(key) {
  const f = failures.get(key);
  return f && f.count >= LOCK_AFTER && Date.now() - f.last < LOCK_MS ? Math.ceil((LOCK_MS - (Date.now() - f.last)) / 60000) : 0;
}
function recordFailure(key) {
  const f = failures.get(key);
  const fresh = !f || Date.now() - f.last > LOCK_MS;
  failures.set(key, { count: fresh ? 1 : f.count + 1, last: Date.now() });
}

app.post('/api/auth/login', (req, res) => {
  const user = db.users.find((u) => u.id === req.body.userId || u.name.toLowerCase() === String(req.body.name || '').toLowerCase());
  if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
  const keys = ['u:' + user.id, 'ip:' + req.ip];
  const wait = Math.max(...keys.map(lockedFor));
  if (wait) return res.status(429).json({ error: `Nhập sai quá nhiều lần. Thử lại sau ${wait} phút.` });
  const a = Buffer.from(hashPin(req.body.pin || '', user.salt), 'hex');
  const b = Buffer.from(user.pinHash, 'hex');
  if (!crypto.timingSafeEqual(a, b)) {
    keys.forEach(recordFailure);
    return res.status(401).json({ error: 'Sai mã PIN' });
  }
  keys.forEach((k) => failures.delete(k));
  res.json({ token: newSession(user), user: publicUser(user) });
});

// EventSource không gửi được header nên token đi qua query string
app.get('/api/events', (req, res) => {
  const s = db.sessions[String(req.query.token || '')];
  const user = s && userById(s.userId);
  if (!user) return res.status(401).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  if (!streams.has(user.id)) streams.set(user.id, new Set());
  streams.get(user.id).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    streams.get(user.id)?.delete(res);
  });
});

app.get('/api/auth/me', requireUser, (req, res) => res.json(publicUser(req.user)));

app.post('/api/auth/logout', (req, res) => {
  if (req.token) delete db.sessions[req.token];
  save();
  res.status(204).end();
});

// ---------- học phần ----------
app.get('/api/sets', requireUser, (req, res) => {
  const list = db.sets.filter((s) => canView(s, req.user));
  list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  res.json(list.map((s) => setSummary(s, req.user)));
});

app.get('/api/sets/:id', requireUser, (req, res) => {
  const set = db.sets.find((s) => s.id === req.params.id);
  if (!canView(set, req.user)) return res.status(404).json({ error: 'Không tìm thấy học phần' });
  res.json({ ...set, ...setSummary(set, req.user), terms: set.terms });
});

app.post('/api/sets', requireUser, (req, res) => {
  const set = {
    id: uid(),
    ownerId: req.user.id,
    title: String(req.body.title || '').trim().slice(0, 200) || 'Học phần chưa đặt tên',
    description: String(req.body.description || '').trim().slice(0, 2000),
    terms: sanitizeTerms(req.body.terms),
    createdAt: now(),
    updatedAt: now(),
  };
  db.sets.unshift(set);
  // Giáo viên có thể giao ngay cho các lớp khi tạo
  assignToClasses(set.id, req.body.classIds, req.user);
  save();
  notify(audienceOfSet(set.id, set.ownerId), { type: 'set', setId: set.id, by: req.user.id, byName: req.user.name, action: 'create', title: set.title });
  res.status(201).json(set);
});

app.put('/api/sets/:id', requireUser, (req, res) => {
  const set = db.sets.find((s) => s.id === req.params.id);
  if (!canEdit(set, req.user)) return res.status(403).json({ error: 'Bạn không có quyền sửa học phần này' });
  set.title = String(req.body.title || '').trim().slice(0, 200) || set.title;
  set.description = String(req.body.description || '').trim().slice(0, 2000);
  set.terms = sanitizeTerms(req.body.terms);
  set.updatedAt = now();
  const before = audienceOfSet(set.id, set.ownerId);
  if (Array.isArray(req.body.classIds)) assignToClasses(set.id, req.body.classIds, req.user, true);
  save();
  notify(new Set([...before, ...audienceOfSet(set.id, set.ownerId)]), { type: 'set', setId: set.id, by: req.user.id, byName: req.user.name, action: 'update', title: set.title });
  res.json(set);
});

// Thêm một thẻ (dùng khi tra từ điển rồi bấm "Thêm vào học phần")
app.post('/api/sets/:id/terms', requireUser, (req, res) => {
  const set = db.sets.find((s) => s.id === req.params.id);
  if (!canEdit(set, req.user)) return res.status(403).json({ error: 'Bạn không có quyền sửa học phần này' });
  const [term] = sanitizeTerms([req.body]);
  if (!term) return res.status(400).json({ error: 'Thẻ trống' });
  set.terms.push(term);
  set.updatedAt = now();
  save();
  notify(audienceOfSet(set.id, set.ownerId), { type: 'set', setId: set.id, by: req.user.id, byName: req.user.name, action: 'update', title: set.title });
  res.status(201).json(term);
});

app.post('/api/sets/:id/copy', requireUser, (req, res) => {
  const src = db.sets.find((s) => s.id === req.params.id);
  if (!canView(src, req.user)) return res.status(404).json({ error: 'Không tìm thấy học phần' });
  const set = {
    ...JSON.parse(JSON.stringify(src)),
    id: uid(),
    ownerId: req.user.id,
    title: `${src.title} (bản sao)`,
    createdAt: now(),
    updatedAt: now(),
  };
  set.terms.forEach((t) => (t.id = uid()));
  db.sets.unshift(set);
  save();
  res.status(201).json(set);
});

app.delete('/api/sets/:id', requireUser, (req, res) => {
  const set = db.sets.find((s) => s.id === req.params.id);
  if (!canEdit(set, req.user)) return res.status(403).json({ error: 'Bạn không có quyền xóa học phần này' });
  const audience = audienceOfSet(set.id, set.ownerId);
  db.sets = db.sets.filter((s) => s !== set);
  for (const c of db.classes) c.setIds = c.setIds.filter((id) => id !== set.id);
  for (const k of Object.keys(db.progress)) if (k.endsWith(':' + set.id)) delete db.progress[k];
  save();
  notify(audience, { type: 'set', setId: set.id, by: req.user.id, byName: req.user.name, action: 'delete', title: set.title });
  res.status(204).end();
});

// ---------- tiến độ học (theo từng người) ----------
const progressKey = (userId, setId) => `${userId}:${setId}`;
function getProgress(userId, setId) {
  return {
    learn: {},
    starred: [],
    tests: [],
    matchBest: null,
    spell: null,
    lastStudied: null,
    ...(db.progress[progressKey(userId, setId)] || {}),
  };
}

app.get('/api/progress/:setId', requireUser, (req, res) => {
  const set = db.sets.find((s) => s.id === req.params.setId);
  if (!canView(set, req.user)) return res.status(404).json({ error: 'Không tìm thấy học phần' });
  res.json(getProgress(req.user.id, set.id));
});

app.patch('/api/progress/:setId', requireUser, (req, res) => {
  const set = db.sets.find((s) => s.id === req.params.setId);
  if (!canView(set, req.user)) return res.status(404).json({ error: 'Không tìm thấy học phần' });
  const p = getProgress(req.user.id, set.id);
  const b = req.body || {};
  const termIds = new Set(set.terms.map((t) => t.id));
  if (b.learn && typeof b.learn === 'object')
    p.learn = Object.fromEntries(Object.entries(b.learn).filter(([k, v]) => termIds.has(k) && [0, 1, 2].includes(v)));
  if (Array.isArray(b.starred)) p.starred = b.starred.filter((id) => termIds.has(id));
  if (b.addTest && Number.isFinite(b.addTest.score) && Number.isFinite(b.addTest.total))
    p.tests = [...p.tests, { score: b.addTest.score, total: b.addTest.total, at: now() }].slice(-20);
  if (Number.isFinite(b.matchTime) && b.matchTime > 0) p.matchBest = p.matchBest ? Math.min(p.matchBest, b.matchTime) : b.matchTime;
  if (b.spell && Number.isFinite(b.spell.correct)) p.spell = { correct: b.spell.correct, total: b.spell.total, at: now() };
  if (b.studied) p.lastStudied = now();
  db.progress[progressKey(req.user.id, set.id)] = p;
  save();
  const teachers = new Set(db.classes.filter((c) => c.setIds.includes(set.id) && c.studentIds.includes(req.user.id)).map((c) => c.teacherId));
  teachers.delete(req.user.id);
  notify(teachers, { type: 'progress', setId: set.id, by: req.user.id, byName: req.user.name });
  res.json(p);
});

// ---------- lớp học ----------
function newClassCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do code = Array.from({ length: 6 }, () => chars[crypto.randomInt(chars.length)]).join('');
  while (db.classes.some((c) => c.code === code));
  return code;
}

function assignToClasses(setId, classIds, user, replace = false) {
  if (!Array.isArray(classIds) || user.role !== 'teacher') return;
  for (const c of db.classes.filter((x) => x.teacherId === user.id)) {
    const want = classIds.includes(c.id);
    const has = c.setIds.includes(setId);
    if (want && !has) c.setIds.push(setId);
    if (!want && has && replace) c.setIds = c.setIds.filter((id) => id !== setId);
  }
}

function classView(c, user) {
  const isTeacher = c.teacherId === user.id;
  return {
    id: c.id,
    name: c.name,
    code: isTeacher ? c.code : undefined,
    isTeacher,
    teacherName: userById(c.teacherId)?.name || 'Không rõ',
    students: c.studentIds.map((id) => publicUser(userById(id))).filter(Boolean),
    sets: c.setIds
      .map((id) => db.sets.find((s) => s.id === id))
      .filter(Boolean)
      .map((s) => ({ id: s.id, title: s.title, termCount: s.terms.length })),
    createdAt: c.createdAt,
  };
}

app.get('/api/classes', requireUser, (req, res) => {
  res.json(classesOf(req.user).map((c) => classView(c, req.user)));
});

app.post('/api/classes', requireUser, requireTeacher, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ error: 'Hãy nhập tên lớp' });
  const c = { id: uid(), name, code: newClassCode(), teacherId: req.user.id, studentIds: [], setIds: [], createdAt: now() };
  db.classes.push(c);
  save();
  res.status(201).json(classView(c, req.user));
});

app.post('/api/classes/join', requireUser, (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const c = db.classes.find((x) => x.code === code);
  if (!c) return res.status(404).json({ error: 'Mã lớp không đúng' });
  if (c.teacherId === req.user.id) return res.status(400).json({ error: 'Bạn là giáo viên của lớp này' });
  if (!c.studentIds.includes(req.user.id)) c.studentIds.push(req.user.id);
  save();
  notify(audienceOfClass(c), { type: 'class', classId: c.id, by: req.user.id, byName: req.user.name, action: 'join' });
  res.json(classView(c, req.user));
});

app.put('/api/classes/:id', requireUser, requireTeacher, (req, res) => {
  const c = db.classes.find((x) => x.id === req.params.id && x.teacherId === req.user.id);
  if (!c) return res.status(404).json({ error: 'Không tìm thấy lớp' });
  if (req.body.name) c.name = String(req.body.name).trim().slice(0, 100);
  if (Array.isArray(req.body.setIds))
    c.setIds = req.body.setIds.filter((id) => db.sets.some((s) => s.id === id && s.ownerId === req.user.id));
  if (req.body.newCode) c.code = newClassCode();
  save();
  notify(audienceOfClass(c), { type: 'class', classId: c.id, by: req.user.id, byName: req.user.name, action: 'update' });
  res.json(classView(c, req.user));
});

app.delete('/api/classes/:id/students/:userId', requireUser, (req, res) => {
  const c = db.classes.find((x) => x.id === req.params.id);
  const self = req.params.userId === req.user.id;
  if (!c || (c.teacherId !== req.user.id && !self)) return res.status(404).json({ error: 'Không tìm thấy lớp' });
  const audience = audienceOfClass(c);
  c.studentIds = c.studentIds.filter((id) => id !== req.params.userId);
  save();
  notify(audience, { type: 'class', classId: c.id, by: req.user.id, byName: req.user.name, action: 'leave' });
  res.status(204).end();
});

app.delete('/api/classes/:id', requireUser, requireTeacher, (req, res) => {
  const gone = db.classes.find((x) => x.id === req.params.id && x.teacherId === req.user.id);
  if (!gone) return res.status(404).json({ error: 'Không tìm thấy lớp' });
  db.classes = db.classes.filter((x) => x !== gone);
  save();
  notify(audienceOfClass(gone), { type: 'class', classId: gone.id, by: req.user.id, byName: req.user.name, action: 'delete' });
  res.status(204).end();
});

// Báo cáo tiến độ của học sinh cho giáo viên
app.get('/api/classes/:id/report', requireUser, requireTeacher, (req, res) => {
  const c = db.classes.find((x) => x.id === req.params.id && x.teacherId === req.user.id);
  if (!c) return res.status(404).json({ error: 'Không tìm thấy lớp' });
  const sets = c.setIds.map((id) => db.sets.find((s) => s.id === id)).filter(Boolean);
  res.json({
    class: classView(c, req.user),
    rows: c.studentIds.map((sid) => ({
      student: publicUser(userById(sid)),
      sets: sets.map((s) => {
        const p = getProgress(sid, s.id);
        const levels = s.terms.map((t) => p.learn[t.id] || 0);
        const lastTest = p.tests[p.tests.length - 1] || null;
        return {
          setId: s.id,
          total: s.terms.length,
          mastered: levels.filter((l) => l >= 2).length,
          familiar: levels.filter((l) => l === 1).length,
          lastTest,
          bestTest: p.tests.reduce((m, t) => (!m || t.score / t.total > m.score / m.total ? t : m), null),
          matchBest: p.matchBest,
          spell: p.spell,
          lastStudied: p.lastStudied,
          // Những thẻ học sinh còn sai / gắn sao để giáo viên biết cần ôn gì
          hardTerms: s.terms.filter((t) => p.starred.includes(t.id) || (p.learn[t.id] ?? -1) === 0).map((t) => t.term).slice(0, 8),
        };
      }),
    })),
  });
});

// ---------- tài liệu bài học (PDF) ----------
// Giáo viên tải PDF lên, chia bài thành các phần (dải trang) và giao cho lớp.
// Các phần là dải trang trên cùng một file PDF, không tách thành file riêng.
const DOC_DIR = path.join(DATA_DIR, 'docs');
fs.mkdirSync(DOC_DIR, { recursive: true });
const docPath = (d) => path.join(DOC_DIR, d.id + '.pdf');
const canViewDoc = (d, user) => !!d && (d.ownerId === user.id || classesOf(user).some((c) => d.classIds.includes(c.id)));
const ownDoc = (req) => db.docs.find((d) => d.id === req.params.id && d.ownerId === req.user.id);

function sanitizeParts(list) {
  return (Array.isArray(list) ? list : [])
    .map((p) => {
      const from = Math.max(1, parseInt(p.from, 10) || 1);
      return {
        id: typeof p.id === 'string' && p.id ? p.id : uid(),
        title: String(p.title ?? '').trim().slice(0, 200),
        from,
        to: Math.max(from, parseInt(p.to, 10) || from),
      };
    })
    .filter((p) => p.title);
}

function docView(d, user) {
  const isOwner = d.ownerId === user.id;
  return {
    id: d.id,
    title: d.title,
    parts: d.parts,
    size: d.size,
    updatedAt: d.updatedAt,
    isOwner,
    ownerName: userById(d.ownerId)?.name || 'Không rõ',
    classIds: isOwner ? d.classIds : undefined,
  };
}

app.get('/api/docs', requireUser, (req, res) => {
  res.json(db.docs.filter((d) => canViewDoc(d, req.user)).map((d) => docView(d, req.user)));
});

app.post('/api/docs', requireUser, requireTeacher, express.raw({ type: 'application/pdf', limit: '100mb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.subarray(0, 4).toString() !== '%PDF')
    return res.status(400).json({ error: 'Chỉ nhận file PDF' });
  const title = String(req.query.title || '').trim().slice(0, 200) || 'Tài liệu';
  const d = { id: uid(), title, ownerId: req.user.id, classIds: [], parts: [], size: req.body.length, createdAt: now(), updatedAt: now() };
  fs.writeFileSync(docPath(d), req.body);
  db.docs.push(d);
  save();
  res.status(201).json(docView(d, req.user));
});

app.put('/api/docs/:id', requireUser, requireTeacher, (req, res) => {
  const d = ownDoc(req);
  if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
  if (req.body.title) d.title = String(req.body.title).trim().slice(0, 200);
  if (Array.isArray(req.body.parts)) d.parts = sanitizeParts(req.body.parts);
  if (Array.isArray(req.body.classIds))
    d.classIds = req.body.classIds.filter((id) => db.classes.some((c) => c.id === id && c.teacherId === req.user.id));
  d.updatedAt = now();
  save();
  res.json(docView(d, req.user));
});

app.delete('/api/docs/:id', requireUser, requireTeacher, (req, res) => {
  const d = ownDoc(req);
  if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
  db.docs = db.docs.filter((x) => x !== d);
  fs.rm(docPath(d), { force: true }, () => {});
  save();
  res.status(204).end();
});

app.get('/api/docs/:id/file', requireUser, (req, res) => {
  const d = db.docs.find((x) => x.id === req.params.id);
  if (!canViewDoc(d, req.user)) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
  res.type('application/pdf').sendFile(docPath(d));
});

// ---------- hình ảnh ----------
app.get('/api/images/search', requireUser, async (req, res) => {
  try {
    res.json(await images.search(String(req.query.q || '')));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/images/import', requireUser, async (req, res) => {
  try {
    const { buffer, ext } = await images.download(String(req.body.url || ''));
    res.status(201).json({ url: saveUpload(buffer, ext) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/upload', requireUser, express.raw({ type: 'image/*', limit: '6mb' }), (req, res) => {
  const ext = images.extFor(req.get('content-type'));
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Chỉ nhận ảnh JPG, PNG, GIF, WEBP' });
  res.status(201).json({ url: saveUpload(req.body, ext) });
});

function saveUpload(buffer, ext) {
  const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return `/uploads/${name}`;
}

// ---------- xuất / nhập file Excel ----------
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function sendXlsx(res, buffer, name) {
  const safe = String(name).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'quizzy';
  res
    .set('Content-Type', XLSX_TYPE)
    .set('Content-Disposition', `attachment; filename="quizzy.xlsx"; filename*=UTF-8''${encodeURIComponent(safe)}.xlsx`)
    .send(Buffer.from(buffer));
}
const ownerNameOf = (set) => userById(set.ownerId)?.name || '';

app.get('/api/sets/:id/export', requireUser, async (req, res) => {
  const set = db.sets.find((s) => s.id === req.params.id);
  if (!canView(set, req.user)) return res.status(404).json({ error: 'Không tìm thấy học phần' });
  sendXlsx(res, await excel.buildSetsWorkbook([set], { uploadDir: UPLOAD_DIR, ownerName: ownerNameOf }), set.title);
});

// Xuất nhiều học phần trong một file (mỗi học phần một trang tính)
app.get('/api/export', requireUser, async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean);
  const list = (ids.length ? ids.map((id) => db.sets.find((s) => s.id === id)) : db.sets.filter((s) => s.ownerId === req.user.id))
    .filter((s) => canView(s, req.user));
  sendXlsx(res, await excel.buildSetsWorkbook(list, { uploadDir: UPLOAD_DIR, ownerName: ownerNameOf }), `Quizzy - ${list.length} hoc phan`);
});

// File mẫu để giáo viên soạn thẻ ngay trong Excel
app.get('/api/template', async (req, res) => {
  const sample = {
    title: 'Tên học phần (sửa ở đây)',
    description: 'Mỗi dòng một thẻ. Chỉ cần cột Thuật ngữ — để trống Định nghĩa/Phiên âm thì Quizzy sẽ tự tra. Có thể chèn ảnh vào cột Hình ảnh.',
    terms: [
      { term: 'environment', definition: 'môi trường', ipaUk: '/ɪnˈvaɪ.rən.mənt/', ipaUs: '/ɪnˈvaɪ.rən.mənt/', pos: 'noun', example: 'We must protect the environment.' },
      { term: 'pollution', definition: 'sự ô nhiễm', ipaUk: '', ipaUs: '', pos: '', example: '' },
      { term: 'recycle', definition: '', ipaUk: '', ipaUs: '', pos: '', example: '' },
    ],
  };
  sendXlsx(res, await excel.buildSetsWorkbook([sample], { uploadDir: UPLOAD_DIR, ownerName: () => '' }), 'Mau soan the Quizzy');
});

app.get('/api/progress/:setId/export', requireUser, async (req, res) => {
  const set = db.sets.find((s) => s.id === req.params.setId);
  if (!canView(set, req.user)) return res.status(404).json({ error: 'Không tìm thấy học phần' });
  const buf = await excel.buildProgressWorkbook({ student: req.user, set, progress: getProgress(req.user.id, set.id) });
  sendXlsx(res, buf, `Ket qua - ${req.user.name} - ${set.title}`);
});

app.post('/api/import', requireUser, express.raw({ type: () => true, limit: '40mb' }), async (req, res) => {
  const fileName = String(req.query.name || 'Học phần nhập');
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'File trống' });
  let parsed;
  try {
    const isZip = req.body[0] === 0x50 && req.body[1] === 0x4b; // .xlsx là file nén ZIP
    if (isZip) parsed = await excel.parseWorkbook(req.body, fileName);
    else if (/\.(csv|txt|tsv)$/i.test(fileName)) parsed = excel.parseCsv(req.body.toString('utf8'), fileName);
    else return res.status(400).json({ error: 'Chỉ hỗ trợ file Excel .xlsx hoặc .csv' });
  } catch (err) {
    return res.status(400).json({ error: 'Không đọc được file: ' + err.message });
  }
  if (!parsed.length) return res.status(400).json({ error: 'Không tìm thấy thẻ nào trong file' });

  const created = [];
  for (const p of parsed) {
    for (const t of p.terms) {
      if (t.imageData) {
        try {
          t.image = saveUpload(t.imageData.buffer, ['jpg', 'png', 'gif', 'webp'].includes(t.imageData.ext) ? t.imageData.ext : 'png');
        } catch {}
      }
      delete t.imageData;
    }
    const set = {
      id: uid(),
      ownerId: req.user.id,
      title: p.title.slice(0, 200) || 'Học phần nhập',
      description: p.description.slice(0, 2000),
      terms: sanitizeTerms(p.terms),
      createdAt: now(),
      updatedAt: now(),
    };
    db.sets.unshift(set);
    created.push(set);
  }
  save();
  res.status(201).json(created.map((s) => setSummary(s, req.user)));
  for (const s of created) fillMissing(s.id).catch((err) => console.warn('[fill]', err.message));
});

/** Sau khi nhập: tự tra phiên âm, audio (và nghĩa tiếng Việt nếu bỏ trống) cho các thẻ còn thiếu */
async function fillMissing(setId) {
  const set = db.sets.find((s) => s.id === setId);
  if (!set) return;
  const todo = set.terms.filter((t) => /^[a-z][a-z' .-]{0,50}$/i.test(t.term) && (!(t.ipaUk || t.ipaUs) || !t.definition));
  if (!todo.length) return;
  let changed = 0;
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const t = todo[i++];
      try {
        const r = await dict.lookup(t.term);
        if (!r.found) continue;
        t.ipaUk ||= r.uk.ipa || '';
        t.ipaUs ||= r.us.ipa || '';
        t.audioUk ||= r.uk.audio || '';
        t.audioUs ||= r.us.audio || '';
        t.pos ||= r.entries[0]?.pos || '';
        t.example ||= r.entries[0]?.senses[0]?.examples?.[0] || '';
        t.definition ||= r.vi || r.entries[0]?.senses[0]?.def || '';
        changed++;
      } catch {}
    }
  };
  await Promise.all([worker(), worker()]);
  if (!changed || !db.sets.includes(set)) return;
  set.updatedAt = now();
  save();
  notify(audienceOfSet(set.id, set.ownerId), { type: 'set', setId: set.id, by: 'system', byName: 'Quizzy', action: 'filled', count: changed, title: set.title });
}

// ---------- từ điển ----------
const proxied = (url) => (url ? `/api/audio?u=${encodeURIComponent(url)}` : null);

app.get('/api/dict/suggest', async (req, res) => {
  try {
    res.json(await dict.suggest(String(req.query.q || '')));
  } catch (err) {
    res.status(502).json({ error: err.message, items: [] });
  }
});

app.get('/api/dict/define', async (req, res) => {
  try {
    const r = await dict.lookup(String(req.query.word || ''));
    res.json({ ...r, uk: { ...r.uk, audio: proxied(r.uk.audio) }, us: { ...r.us, audio: proxied(r.us.audio) } });
  } catch (err) {
    res.status(err instanceof dict.NotFoundError ? 404 : 502).json({ error: err.message });
  }
});

app.get('/api/dict/status', (req, res) => res.json(dict.status()));

app.get('/api/audio', async (req, res) => {
  try {
    const { type, buffer } = await dict.fetchAudio(String(req.query.u || ''));
    res.set('Content-Type', type).set('Cache-Control', 'public, max-age=604800').send(buffer);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/info', (req, res) => res.json({ lanUrls: lanUrls() }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy' }));
app.get(/^\/(?!api\/|uploads\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function lanUrls() {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${PORT}`);
  return urls;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Quizzy đang chạy:`);
  console.log(`  • Trên máy này:      http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`  • Trong mạng LAN:    ${u}`);
});
