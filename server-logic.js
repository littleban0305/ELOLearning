const { GEMINI_API_KEY } = require('./key');

const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-2.5-flash,gemini-2.5-flash-lite')
  .split(',').map((x) => x.trim()).filter(Boolean);

function buildPrompt({ mode, topic }) {
  const common = `你是台灣國中國文老師。使用繁體中文。學習情境：國中一年級 康軒國文。請先思考內容是否正確，必要時用 Google Search 找可靠資料。`;
  if (mode === 'quiz') return `${common}\n請針對「${topic}」出 5 題四選一選擇題，最後附答案與詳解。`;
  return `${common}\n請整理「${topic}」：至少 5 個重點、3 個名詞解釋、3 題快速複習題，最後附參考資料。`;
}

async function call(model, prompt) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!response.ok) throw new Error(data?.error?.message || text || `HTTP ${response.status}`);
  const output = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n').trim();
  if (!output) throw new Error('Gemini 回傳內容為空');
  return { text: output, model };
}

async function generateForCli({ mode, topic }) {
  if (!GEMINI_API_KEY) throw new Error('請先設定 GEMINI_API_KEY（環境變數或 key.local.js）');
  const models = [PRIMARY_MODEL, ...FALLBACK_MODELS.filter((m) => m !== PRIMARY_MODEL)];
  let lastError;
  for (const model of models) {
    try { return await call(model, buildPrompt({ mode, topic })); }
    catch (error) { lastError = error; }
  }
  throw lastError || new Error('Gemini 呼叫失敗');
}

module.exports = { generateForCli };
