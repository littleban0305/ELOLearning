# ELOLearning

最小可執行版本（Node.js CLI）：

- 程式會先使用主要模型做搜尋生成；若 API 回覆該模型不可用，會自動退回備援模型
- 使用 Gemini 的 Google Search 工具做網路資料搜尋
- 支援兩種輸出模式：
  - `summary`：重點整理
  - `quiz`：題目複習
- 固定年級版本為「國中一年級康軒國文」，主題可用命令列參數指定

## 1) 設定 API Key

請先設定環境變數（推薦）：

```bash
export GEMINI_API_KEY="貼上你的 Gemini API Key"
```

或建立本機檔案 `key.local.js`（不會進版控）：

```js
module.exports = {
  GEMINI_API_KEY: "貼上你的 Gemini API Key",
};
```

## 2) 執行

```bash
node index.js summary 岳陽樓記
node index.js quiz 論語選
```

主題可選填；如果沒有提供主題，預設會用「國文課文重點」。
