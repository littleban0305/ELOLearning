const { GEMINI_API_KEY } = require("./key");

const mode = (process.argv[2] || "summary").toLowerCase();
const topic = process.argv[3] || "國文課文重點";
const primaryModel = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const fallbackModel = "gemini-2.5-flash";

if (!["summary", "quiz"].includes(mode)) {
  console.error("mode 只能是 summary 或 quiz");
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error("請先設定 GEMINI_API_KEY（環境變數或 key.local.js）");
  process.exit(1);
}

const formatInstruction =
  mode === "summary"
    ? `請嚴格使用以下格式輸出：
[任務] 重點整理
[年級版本] 國中一年級 康軒國文
[主題] ${topic}
[重點整理]
- 至少 5 點
[名詞解釋]
- 至少 3 個
[快速複習題]
1.
2.
3.
[參考資料]
- 列出你查到的網路來源名稱或網址（若可得）`
    : `請嚴格使用以下格式輸出：
[任務] 題目複習
[年級版本] 國中一年級 康軒國文
[主題] ${topic}
[選擇題]
1. 題目（A/B/C/D）
2. 題目（A/B/C/D）
3. 題目（A/B/C/D）
4. 題目（A/B/C/D）
5. 題目（A/B/C/D）
[答案]
1.
2.
3.
4.
5.
[詳解]
1.
2.
3.
4.
5.
[參考資料]
- 列出你查到的網路來源名稱或網址（若可得）`;

const prompt = `你是台灣國中國文老師。請先搜尋網路資料，再根據資料產生內容。
限制：
1) 僅針對「國中一年級 康軒國文」難度與脈絡
2) 使用繁體中文
3) 內容要正確、清楚、可直接給學生使用

${formatInstruction}`;

async function run() {
  async function generateWithModel(model) {
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
    });
  }

  let response = await generateWithModel(primaryModel);

  if (!response.ok && primaryModel !== fallbackModel) {
    const errText = await response.text();
    const mayBeModelIssue =
      response.status === 400 ||
      response.status === 404 ||
      /model|not found|unsupported/i.test(errText);

    if (mayBeModelIssue) {
      response = await generateWithModel(fallbackModel);
    } else {
      throw new Error(`Gemini API 呼叫失敗 (${response.status}): ${errText}`);
    }
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API 呼叫失敗 (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || "")
      .join("\n")
      .trim() || "";

  if (!text) {
    throw new Error("Gemini 回傳內容為空");
  }

  console.log(text);
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
