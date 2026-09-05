const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { GEMINI_API_KEY } = require('./key');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-2.5-flash,gemini-2.5-flash-lite')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);

const ROOT = __dirname;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

const apiKey = process.env.GEMINI_API_KEY || GEMINI_API_KEY;

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(payload));
}

function getGroundingSources(data) {
  const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources = [];
  for (const chunk of chunks) {
    const web = chunk?.web;
    if (!web?.uri) continue;
    if (sources.some((source) => source.uri === web.uri)) continue;
    sources.push({ title: web.title || web.uri, uri: web.uri });
  }
  return sources.slice(0, 8);
}

function buildPrompt({ mode, topic, message, grade, subject }) {
  const context = `台灣 ${grade} ${subject} 學習情境`;
  const common = `
你是一位友善、耐心、講解清楚的台灣國中老師。
學習情境：${context}
使用繁體中文，不要突然改用英文。
內容要符合學生程度；遇到不確定的事實請不要裝懂。
若需要最新或具體資料，可以使用 Google Search grounding，並讓回答附有可靠來源。
避免要求學生直接抄答案；優先解釋「為什麼」。
`;

  if (mode === 'quiz') {
    return `${common}
請針對「${topic}」出 5 題四選一選擇題。
${message ? `額外需求：${message}\n` : ''}
每題都要有 A、B、C、D 四個選項，答案需唯一且合理。
最後提供答案與簡潔詳解。
請用下列純文字格式，方便網站解析：
[題目]
1. 題目\nA. 選項\nB. 選項\nC. 選項\nD. 選項
（重複到第 5 題）
[答案]
1. A
2. B
3. C
4. D
5. A
[詳解]
1. ...
2. ...
3. ...
4. ...
5. ...`;
  }

  if (mode === 'tutor') {
    return `${common}
你現在是「AI 老師」模式。
學生主題：「${topic}」
學生問題：「${message || '請先用簡單方式介紹這個主題。'}」
請回答：先用一句話抓重點，再用 2～5 個小段落解釋，最後給一個小問題讓學生自己想想。
不要只貼標準答案；要讓學生真的理解。`;
  }

  return `${common}
請教學生「${topic}」。
${message ? `學生補充需求：「${message}」\n` : ''}
請依序輸出：
## 一分鐘重點
用 4～6 點說明核心概念。

## 名詞／關鍵句
列出 3～5 個最值得記的詞語或句子，附白話解釋。

## 容易搞混
列出 2～3 個常見誤解並指出正確理解。

## 快速自我檢查
給 3 題簡短問題，不要在這裡直接公布答案。

文字要適合學生閱讀，段落不要太長。`;
}

function isModelFallbackError(status, message) {
  if (![400, 404, 429].includes(status)) return false;
  return /(model|not found|not available|unsupported|quota|resource exhausted|rate limit|failed_precondition)/i.test(message);
}

async function callGemini(model, prompt) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.55,
        maxOutputTokens: 2200,
      },
    }),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error?.message || text || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const output = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || '')
    .join('\n')
    .trim();

  if (!output) throw new Error('Gemini 回傳內容為空。');
  return { text: output, sources: getGroundingSources(data), model };
}

async function generate({ mode, topic, message, grade, subject }) {
  if (!apiKey) {
    const error = new Error('尚未設定 GEMINI_API_KEY。請在 .env 填入你的 Gemini API Key。');
    error.status = 503;
    throw error;
  }

  const prompt = buildPrompt({ mode, topic, message, grade, subject });
  const models = [PRIMARY_MODEL, ...FALLBACK_MODELS.filter((m) => m !== PRIMARY_MODEL)];
  let lastError;

  for (let i = 0; i < models.length; i += 1) {
    try {
      return await callGemini(models[i], prompt);
    } catch (error) {
      lastError = error;
      if (!isModelFallbackError(error.status || 500, error.message) || i === models.length - 1) break;
    }
  }
  throw lastError || new Error('Gemini 呼叫失敗。');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(Object.assign(new Error('Request 太大。'), { status: 413 }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error('JSON 格式錯誤。'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname);
  } catch {
    return json(res, 400, { error: '網址格式錯誤。' });
  }

  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(ROOT, requested));
  if (!filePath.startsWith(ROOT)) return json(res, 403, { error: '禁止存取。' });

  fs.readFile(filePath, (err, data) => {
    if (err) return json(res, 404, { error: '找不到頁面。' });
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});

  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      return json(res, 200, {
        ok: true,
        configured: Boolean(apiKey),
        model: PRIMARY_MODEL,
      });
    }

    if (req.method === 'POST' && req.url === '/api/learn') {
      const body = await readJsonBody(req);
      const mode = ['summary', 'quiz', 'tutor'].includes(body.mode) ? body.mode : 'summary';
      const topic = String(body.topic || '').trim().slice(0, 300);
      const message = String(body.message || '').trim().slice(0, 2000);
      const grade = String(body.grade || '國中一年級').trim().slice(0, 60);
      const subject = String(body.subject || '國文').trim().slice(0, 60);
      if (!topic) return json(res, 400, { error: '請先輸入學習主題。' });

      const result = await generate({ mode, topic, message, grade, subject });
      return json(res, 200, { ok: true, ...result });
    }

    if (req.method === 'GET') return serveStatic(req, res);
    return json(res, 405, { error: 'Method Not Allowed' });
  } catch (error) {
    console.error('[ELOLearning]', error);
    const status = Number(error.status) || 500;
    return json(res, Math.min(Math.max(status, 400), 599), {
      error: error.message || '伺服器發生未知錯誤。',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ELOLearning 已啟動：http://${HOST}:${PORT}`);
  console.log(`Gemini：${apiKey ? '已設定' : '未設定'}`);
});
