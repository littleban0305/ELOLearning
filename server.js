const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { GoogleGenAI } = require('@google/genai');

function loadDotEnv() {
  const file = path.join(__dirname, '.env');
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      let value = m[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[m[1]] = value;
    }
  } catch {}
}

loadDotEnv();

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = String(process.env.GEMINI_API_KEY || '').trim();
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const MAX_BODY = 1_000_000;

const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'elolearning.json');
let writeQueue = Promise.resolve();

async function ensureDb() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(DATA_FILE);
  } catch {
    await fsp.writeFile(DATA_FILE, JSON.stringify({ users: [], sessions: [], notes: [], questions: [] }, null, 2));
  }
}
async function loadDb() {
  await ensureDb();
  const raw = await fsp.readFile(DATA_FILE, 'utf8');
  const db = JSON.parse(raw);
  return {
    users: Array.isArray(db.users) ? db.users : [],
    sessions: Array.isArray(db.sessions) ? db.sessions : [],
    notes: Array.isArray(db.notes) ? db.notes : [],
    questions: Array.isArray(db.questions) ? db.questions : [],
  };
}
function saveDb(db) {
  writeQueue = writeQueue.then(async () => {
    const tmp = `${DATA_FILE}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
    await fsp.rename(tmp, DATA_FILE);
  });
  return writeQueue;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(payload));
}
function clean(v, max = 3000) {
  return String(v ?? '').trim().slice(0, max);
}
function randomId() {
  return crypto.randomUUID();
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function timingSafeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
  catch { return false; }
}
function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived.toString('hex'));
    });
  });
}
async function makePasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashPassword(password, salt);
  return { salt, hash };
}
async function verifyPassword(password, user) {
  const candidate = await hashPassword(password, user.salt);
  return timingSafeEqualHex(candidate, user.passwordHash);
}
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sessionCookie(token, maxAge = 60 * 60 * 24 * 30) {
  return `elolearning_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
async function getAuth(req, db) {
  const cookies = parseCookies(req);
  const raw = cookies.elolearning_session;
  if (!raw) return null;
  const digest = sha256(raw);
  const session = db.sessions.find((s) => timingSafeEqualHex(s.tokenHash, digest));
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    db.sessions = db.sessions.filter((s) => s.id !== session.id);
    await saveDb(db);
    return null;
  }
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) return null;
  return { user, session };
}
function requireAuth(auth, res) {
  if (!auth) {
    sendJson(res, 401, { error: '請先登入 ELOLearning。' });
    return false;
  }
  return true;
}
async function readJson(req) {
  let total = 0;
  let raw = '';
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY) throw Object.assign(new Error('請求內容太大。'), { status: 413 });
    raw += chunk;
  }
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error('JSON 格式錯誤。'), { status: 400 }); }
}
function safeNoteHtml(html = '') {
  const allowed = new Set(['H1','H2','H3','H4','P','STRONG','EM','U','S','DEL','UL','OL','LI','BLOCKQUOTE','PRE','CODE','BR','HR','TABLE','THEAD','TBODY','TR','TH','TD']);
  const input = String(html);
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
    .replace(/\s(?:href|src)\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
    .replace(/<\/?([a-z0-9]+)(?:\s[^>]*)?>/gi, (tag, name) => {
      const upper = name.toUpperCase();
      if (!allowed.has(upper)) return '';
      return tag.startsWith('</') ? `</${name.toLowerCase()}>` : `<${name.toLowerCase()}>`;
    })
    .slice(0, 300000);
}
function escapeHtmlServer(value = '') {
  return String(value).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}
function markdownToHtml(text = '') {
  const lines = String(text).replace(/^```(?:html|markdown)?\s*/i, '').replace(/\s*```$/i, '').split(/\r?\n/);
  const out = [];
  let listType = null;
  const close = () => { if (listType) out.push(`</${listType}>`); listType = null; };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { close(); continue; }
    const ul = line.match(/^[-•]\s+(.+)$/);
    const ol = line.match(/^\d+[.)]\s+(.+)$/);
    if (ul || ol) {
      const type = ul ? 'ul' : 'ol';
      if (listType !== type) { close(); out.push(`<${type}>`); listType = type; }
      let item = escapeHtmlServer((ul || ol)[1]);
      item = item.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
      out.push(`<li>${item}</li>`);
      continue;
    }
    close();
    if (/^###\s+/.test(line)) out.push(`<h4>${escapeHtmlServer(line.replace(/^###\s+/, ''))}</h4>`);
    else if (/^##\s+/.test(line)) out.push(`<h3>${escapeHtmlServer(line.replace(/^##\s+/, ''))}</h3>`);
    else if (/^#\s+/.test(line)) out.push(`<h2>${escapeHtmlServer(line.replace(/^#\s+/, ''))}</h2>`);
    else {
      let p = escapeHtmlServer(line);
      p = p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
      out.push(`<p>${p}</p>`);
    }
  }
  close();
  return out.join('');
}
function normalizeRichAnswer(raw) {
  const value = String(raw || '').trim().replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  if (/<(?:h2|h3|h4|p|strong|em|u|ul|ol|li|blockquote|pre|code|table|thead|tbody|tr|th|td|br|hr)\b/i.test(value)) return safeNoteHtml(value);
  return markdownToHtml(value);
}

const genai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

function normalizeAiError(error) {
  const message = String(error?.message || error || 'Gemini 請求失敗。');
  if (/401|unauthenticated|invalid authentication|api key|permission denied/i.test(message)) {
    return Object.assign(new Error('Gemini API Key 認證失敗。請確認 .env 的 GEMINI_API_KEY 有效，並重新啟動 npm start。'), { status: 502 });
  }
  return Object.assign(new Error(message), { status: 502 });
}

async function askGemini(prompt, jsonMode = false) {
  if (!genai) throw Object.assign(new Error('尚未設定 GEMINI_API_KEY。請在 .env 填入 Gemini API Key。'), { status: 503 });
  try {
    const response = await genai.models.generateContent({
      model: MODEL,
      contents: prompt,
      ...(jsonMode ? { config: { responseMimeType: 'application/json' } } : {}),
    });
    const text = String(response?.text || '').trim();
    if (!text) throw new Error('Gemini 回傳內容為空。');
    return text;
  } catch (error) {
    throw normalizeAiError(error);
  }
}

function buildAskPrompt({ topic, question, grade, subject }) {
  return `你是 ELOLearning 的 AI 老師。請用繁體中文教學，對象是台灣${grade}學生，科目是${subject}。

學習主題：${topic}
學生問題：${question || '請先用簡單方式介紹這個主題。'}

你要直接產生「可編輯學習筆記」。
只輸出語意化 HTML，不要 Markdown，不要 code fence，不要 HTML 外的說明。

允許標籤：<h2> <h3> <h4> <p> <strong> <em> <u> <s> <ul> <ol> <li> <blockquote> <pre> <code> <table> <thead> <tbody> <tr> <th> <td> <br> <hr>

要求：
- 開頭用 <h2> 當作筆記小標題。
- 重要概念可使用 <strong>；補充可用 <em>。
- 適合比較、分類、整理時，真的使用完整 HTML <table>，不要用純文字假裝表格。
- 適合條列時使用 <ul> 或 <ol>。
- 最後一定有 <h3>重點整理</h3>，並用 <ul> 列出 4～8 個真正值得之後複習與出題的重點。
- 再有 <h3>容易搞混</h3>，列出 1～3 個提醒。
- 如果學生指定「表格／粗體／斜體／條列」等格式，必須優先照做。
- 不要亂猜不確定的資訊。`;
}

function buildQuizPrompt({ notes, count, difficulty, subject }) {
  return `你是 ELOLearning 的出題老師。

科目：${subject}
題數：${count}
難度：${difficulty}

只能根據「學生已儲存的學習重點」出題，不要引入完全沒有出現在筆記中的新知識。

【學生筆記】
${notes}

只輸出 JSON：
{"questions":[{"question":"題目","options":["A","B","C","D"],"answer":0,"explanation":"答案解析"}]}

規則：
- 每題四選一，answer 必須是 0、1、2、3。
- 每題只能有一個正確答案。
- 題目盡量涵蓋不同筆記。
- 選項不要明顯洩漏答案。
- 解析簡短清楚。
- 不要超過要求題數。`;
}

function parseQuiz(raw) {
  const text = String(raw || '').trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch {
    const a = text.indexOf('{'); const b = text.lastIndexOf('}');
    if (a < 0 || b <= a) throw Object.assign(new Error('AI 出題格式不正確，請再試一次。'), { status: 502 });
    parsed = JSON.parse(text.slice(a, b + 1));
  }
  if (!Array.isArray(parsed.questions)) throw Object.assign(new Error('AI 沒有產生有效題目。'), { status: 502 });
  parsed.questions = parsed.questions.map((q) => ({
    question: clean(q.question, 1000),
    options: Array.isArray(q.options) ? q.options.slice(0,4).map((x)=>clean(x,500)) : [],
    answer: Number(q.answer),
    explanation: clean(q.explanation, 1200),
  })).filter((q)=>q.question && q.options.length===4 && q.options.every(Boolean) && [0,1,2,3].includes(q.answer));
  if (!parsed.questions.length) throw Object.assign(new Error('AI 沒有產生有效的四選一題目。'), { status: 502 });
  return parsed;
}

function plainNotes(notes) {
  return notes.map((n, i) => `【第${i+1}筆｜${n.title}｜${n.subject}｜${n.grade}】\n${String(n.html).replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim()}`).join('\n\n');
}

async function handleApi(req, res, db, auth) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, { ok:true, authenticated:Boolean(auth), configured:Boolean(API_KEY), model:MODEL });
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    return sendJson(res, 200, auth ? { authenticated:true, user:{ id:auth.user.id, email:auth.user.email, name:auth.user.name } } : { authenticated:false });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    const body = await readJson(req);
    const name = clean(body.name, 60);
    const email = clean(body.email, 200).toLowerCase();
    const password = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res,400,{error:'請輸入有效的 Email。'});
    if (password.length < 8) return sendJson(res,400,{error:'密碼至少需要 8 個字元。'});
    if (db.users.some((u)=>u.email===email)) return sendJson(res,409,{error:'這個 Email 已經註冊過了。'});
    const {salt, hash} = await makePasswordHash(password);
    const user = { id:randomId(), email, name:name || email.split('@')[0], passwordHash:hash, salt, createdAt:new Date().toISOString() };
    db.users.push(user);
    const token = crypto.randomBytes(32).toString('base64url');
    db.sessions.push({id:randomId(), userId:user.id, tokenHash:sha256(token), expiresAt:Date.now()+SESSION_TTL_MS});
    await saveDb(db);
    return sendJson(res,201,{ok:true,user:{id:user.id,email:user.email,name:user.name}},{'Set-Cookie':sessionCookie(token)});
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readJson(req);
    const email = clean(body.email,200).toLowerCase();
    const password = String(body.password || '');
    const user = db.users.find((u)=>u.email===email);
    if (!user || !(await verifyPassword(password,user))) return sendJson(res,401,{error:'Email 或密碼不正確。'});
    const token = crypto.randomBytes(32).toString('base64url');
    db.sessions = db.sessions.filter((s)=>s.userId!==user.id || s.expiresAt>Date.now());
    db.sessions.push({id:randomId(),userId:user.id,tokenHash:sha256(token),expiresAt:Date.now()+SESSION_TTL_MS});
    await saveDb(db);
    return sendJson(res,200,{ok:true,user:{id:user.id,email:user.email,name:user.name}},{'Set-Cookie':sessionCookie(token)});
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    if (auth) {
      db.sessions = db.sessions.filter((s)=>s.id!==auth.session.id);
      await saveDb(db);
    }
    return sendJson(res,200,{ok:true},{'Set-Cookie':sessionCookie('',0)});
  }

  if (!auth) return sendJson(res,401,{error:'請先登入 ELOLearning。'});

  if (req.method === 'GET' && url.pathname === '/api/data') {
    const notes = db.notes.filter((n)=>n.userId===auth.user.id).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
    const questions = db.questions.filter((q)=>q.userId===auth.user.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    return sendJson(res,200,{ok:true,notes,questions});
  }

  if (req.method === 'POST' && url.pathname === '/api/notes') {
    const body = await readJson(req);
    const now = new Date().toISOString();
    const note = {
      id: randomId(), userId:auth.user.id, title:clean(body.title || body.topic || '未命名筆記',200),
      topic:clean(body.topic || body.title || '未命名筆記',300), question:clean(body.question,3000),
      grade:clean(body.grade || '國中一年級',50), subject:clean(body.subject || '其他',50),
      html:safeNoteHtml(body.html || '<p></p>'), createdAt:now, updatedAt:now
    };
    db.notes.push(note);
    await saveDb(db);
    return sendJson(res,201,{ok:true,note});
  }

  if (req.method === 'PUT' && url.pathname.startsWith('/api/notes/')) {
    const id = url.pathname.split('/').pop();
    const note = db.notes.find((n)=>n.id===id && n.userId===auth.user.id);
    if (!note) return sendJson(res,404,{error:'找不到這份筆記。'});
    const body = await readJson(req);
    if (body.title !== undefined) note.title = clean(body.title,200) || '未命名筆記';
    if (body.html !== undefined) note.html = safeNoteHtml(body.html);
    if (body.topic !== undefined) note.topic = clean(body.topic,300);
    if (body.question !== undefined) note.question = clean(body.question,3000);
    note.updatedAt = new Date().toISOString();
    await saveDb(db);
    return sendJson(res,200,{ok:true,note});
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/notes/')) {
    const id = url.pathname.split('/').pop();
    const before = db.notes.length;
    db.notes = db.notes.filter((n)=>!(n.id===id && n.userId===auth.user.id));
    if (db.notes.length===before) return sendJson(res,404,{error:'找不到這份筆記。'});
    await saveDb(db);
    return sendJson(res,200,{ok:true});
  }

  if (req.method === 'DELETE' && url.pathname === '/api/notes') {
    db.notes = db.notes.filter((n)=>n.userId!==auth.user.id);
    await saveDb(db);
    return sendJson(res,200,{ok:true});
  }

  if (req.method === 'POST' && url.pathname === '/api/notes/import') {
    const body = await readJson(req);
    if (!Array.isArray(body.notes)) return sendJson(res,400,{error:'沒有可匯入的筆記。'});
    const existing = new Set(db.notes.filter((n)=>n.userId===auth.user.id).map((n)=>n.id));
    let added=0;
    for (const source of body.notes.slice(0,100)) {
      const now = new Date().toISOString();
      db.notes.push({
        id:randomId(),userId:auth.user.id,title:clean(source.title||source.topic||'匯入筆記',200),
        topic:clean(source.topic||source.title||'匯入筆記',300),question:clean(source.question,3000),
        grade:clean(source.grade||'國中一年級',50),subject:clean(source.subject||'其他',50),
        html:safeNoteHtml(source.html||'<p></p>'),createdAt:source.createdAt||now,updatedAt:source.updatedAt||now
      });
      added++;
    }
    await saveDb(db);
    return sendJson(res,200,{ok:true,added});
  }

  if (req.method === 'POST' && url.pathname === '/api/ask') {
    const body = await readJson(req);
    const topic = clean(body.topic,300);
    if (!topic) return sendJson(res,400,{error:'請先輸入學習主題。'});
    const raw = await askGemini(buildAskPrompt({
      topic, question:clean(body.question||body.message,3000),
      grade:clean(body.grade||'國中一年級',50), subject:clean(body.subject||'國文',50)
    }));
    return sendJson(res,200,{ok:true,text:raw,html:normalizeRichAnswer(raw),model:MODEL});
  }

  if (req.method === 'POST' && url.pathname === '/api/quiz') {
    const body = await readJson(req);
    const noteIds = Array.isArray(body.noteIds) ? body.noteIds.slice(0,100) : [];
    const ownedNotes = db.notes.filter((n)=>n.userId===auth.user.id && (noteIds.length ? noteIds.includes(n.id) : true));
    if (!ownedNotes.length) return sendJson(res,400,{error:'目前沒有學習重點，先問 AI 學一個主題吧。'});
    const count = Math.min(Math.max(Number(body.count)||5,3),10);
    const difficulty = clean(body.difficulty||'普通',20);
    const subject = clean(body.subject||'綜合',50);
    const raw = await askGemini(buildQuizPrompt({notes:plainNotes(ownedNotes),count,difficulty,subject}),true);
    const quiz = parseQuiz(raw);
    const quizSet = {
      id:randomId(),userId:auth.user.id,title:clean(body.title||`AI 練習｜${new Date().toLocaleDateString('zh-TW')}`,200),
      subject,difficulty,count:quiz.questions.length,questions:quiz.questions,createdAt:new Date().toISOString(),
      lastScore:null,lastAnsweredAt:null
    };
    db.questions.push(quizSet);
    await saveDb(db);
    return sendJson(res,200,{ok:true,quiz,questionSet:quizSet});
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/questions/')) {
    const id=url.pathname.split('/').pop();
    const before=db.questions.length;
    db.questions=db.questions.filter((q)=>!(q.id===id && q.userId===auth.user.id));
    if (db.questions.length===before) return sendJson(res,404,{error:'找不到這份題目。'});
    await saveDb(db);
    return sendJson(res,200,{ok:true});
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/questions/') && url.pathname.endsWith('/score')) {
    const id=url.pathname.split('/').filter(Boolean).slice(-2)[0];
    const qs=db.questions.find((q)=>q.id===id && q.userId===auth.user.id);
    if (!qs) return sendJson(res,404,{error:'找不到這份題目。'});
    const body=await readJson(req);
    const score=Math.max(0,Math.min(Number(body.score)||0,qs.questions.length));
    qs.lastScore=score; qs.lastAnsweredAt=new Date().toISOString();
    await saveDb(db);
    return sendJson(res,200,{ok:true,score});
  }

  return sendJson(res,404,{error:'找不到 API。'});
}

async function serveStatic(req,res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const requested = pathname === '/' ? '/index.html' : pathname;
  const full = path.normalize(path.join(ROOT, requested));
  if (!full.startsWith(ROOT)) return sendJson(res,403,{error:'禁止存取。'});
  try {
    const data=await fsp.readFile(full);
    res.writeHead(200,{'Content-Type':MIME[path.extname(full).toLowerCase()]||'application/octet-stream','Cache-Control':'no-cache'});
    res.end(data);
  } catch { sendJson(res,404,{error:'找不到頁面。'}); }
}

(async()=>{
  await ensureDb();
  const server=http.createServer(async(req,res)=>{
    try {
      const db=await loadDb();
      const auth=await getAuth(req,db);
      if (req.method==='OPTIONS') return sendJson(res,204,{});
      const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
      if (url.pathname.startsWith('/api/')) return handleApi(req,res,db,auth);
      if (req.method==='GET') return serveStatic(req,res);
      return sendJson(res,405,{error:'Method Not Allowed'});
    } catch(error) {
      console.error('[ELOLearning]',error);
      sendJson(res,Math.min(Math.max(Number(error.status)||500,400),599),{error:error.message||'伺服器發生錯誤。'});
    }
  });
  server.listen(PORT,HOST,()=> {
    console.log(`ELOLearning：http://${HOST}:${PORT}`);
    console.log(`Gemini API Key：${API_KEY ? '已設定' : '未設定'}`);
    console.log(`帳號資料庫：${DATA_FILE}`);
  });
})();

process.on('SIGINT',()=>process.exit(0));
