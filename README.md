# ELOLearning

ELOLearning 是一個以 Gemini 為核心的 AI 學習助手，包含：

- 帳號註冊、登入與登出
- 我的重點：富文字編輯、表格、Word / PDF 匯出
- 我的題目：依照已保存重點產生並保存練習
- 設定：個人資料、頭像、顯示名稱、密碼與 AI 老師偏好
- 純 HTML / CSS / JS 動畫，不依賴 Lottie

## 啟動

```bash
npm install
npm start
```

建立 `.env`：

```env
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.6-flash
```

正式部署時，請把環境變數放在 Railway / 主機設定，不要提交 `.env`。

## 注意

目前使用 `data/elolearning.json` 做伺服器端持久化。正式多人環境建議之後升級至 PostgreSQL。
