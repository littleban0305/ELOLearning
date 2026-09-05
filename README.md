# ELOLearning

ELOLearning 現在正式加入帳號系統：

**註冊／登入 → 每個帳號獨立保存 → 問 AI → 自動保存重點 → 編輯重點 → AI 根據你的重點出題 → 題目保存到「我的題目」**

## 這版新增

- Email + 密碼註冊／登入
- 使用 Node.js 伺服器端 Session Cookie
- 密碼使用 Node.js `scrypt` 雜湊，不保存明文密碼
- 每個使用者只能讀寫自己的筆記與題目
- 筆記雲端（伺服器端）保存
- 「我的重點」可編輯、Word / PDF 匯出
- 「我的題目」保存每次 AI 產生的題目
- 可以重新打開舊題目作答
- 交卷後保存上次分數
- 第一次登入可把舊版瀏覽器 localStorage 筆記搬到帳號
- AI 出題只會使用目前帳號擁有的筆記

## 啟動

需要 Node.js 20 以上。

```bash
npm install
```

複製 `.env.example` 成 `.env`，填入自己的 Gemini API Key：

```env
GEMINI_API_KEY=你的_Gemini_API_Key
GEMINI_MODEL=gemini-3.6-flash
PORT=3000
HOST=127.0.0.1
```

再：

```bash
npm start
```

開啟：

```text
http://127.0.0.1:3000
```

不要用 Live Server 直接開 `index.html`。

## 資料庫

本專案為了保持簡單，使用伺服器端 JSON 資料庫：

```text
data/elolearning.json
```

這個檔案包含：

- users
- sessions
- notes
- questions

`data/` 已經加入 `.gitignore`。

這代表「資料不再只存在瀏覽器」，而是由後端依帳號保存。把這個 Node.js 專案部署到有持久磁碟的伺服器後，就可以作為雲端儲存使用。

正式多人服務環境建議下一階段換成 PostgreSQL / Supabase / Cloud SQL，並把 Session 換成集中式儲存。

## 安全

- 真實 `.env` 不要提交 Git
- 不要把 Gemini API Key 寫進前端
- Session Token 不直接存入資料庫，只保存 SHA-256 雜湊
- 密碼使用 `scrypt` 雜湊 + 每個帳號獨立 salt
- Cookie 使用 `HttpOnly` + `SameSite=Lax`
- 使用者查詢筆記／題目時一律附帶自己的 userId

## API

認證：

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

資料：

- `GET /api/data`
- `POST /api/notes`
- `PUT /api/notes/:id`
- `DELETE /api/notes/:id`
- `DELETE /api/notes`
- `POST /api/notes/import`

AI：

- `POST /api/ask`
- `POST /api/quiz`

題目：

- `DELETE /api/questions/:id`
- `POST /api/questions/:id/score`


## 本版前端事件系統
網站採用事件委派處理導覽、動態筆記卡片、我的題目與富文字工具列。
因此即使重新渲染筆記或題目清單，按鈕也不會因為 DOM 被替換而失效。
編輯器工具列會保存文字選取範圍，不再用 `mousedown.preventDefault()` 阻止原生按鈕行為。
