# ELOLearning

ELOLearning 是一個以 Gemini 為核心的 AI 學習助手 MVP，現在包含：

- 重點學習：整理核心概念、關鍵句、易錯點與自我檢查
- 快速測驗：產生 5 題四選一並附答案與詳解
- AI 老師：用對話式方式回答學生的疑問
- Google Search grounding：在需要時由 Gemini 使用網路資料並回傳來源
- 前端與後端分離責任：API Key 只留在 Node.js 後端，不直接送到瀏覽器
- 響應式介面：桌面與手機都能使用

## 啟動

需要 Node.js 20 以上。

1. 複製 `.env.example` 成 `.env`
2. 在 `.env` 填入 `GEMINI_API_KEY`
3. 執行：

```bash
npm start
```

4. 開啟 `http://127.0.0.1:3000`

## CLI

舊版 CLI 也保留：

```bash
npm run start:summary -- 岳陽樓記
npm run start:quiz -- 岳陽樓記
```

## API

`POST /api/learn`

```json
{
  "mode": "summary",
  "topic": "岳陽樓記",
  "message": "我想知道中心思想",
  "grade": "國中一年級",
  "subject": "國文"
}
```

`GET /api/health` 可檢查後端是否有讀到 API Key。

## 安全提醒

真正的 `.env` 已被 `.gitignore` 排除。不要把 API Key 放進 `index.html`、`main.js` 或 Git repository。
