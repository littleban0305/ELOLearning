const promptInput = document.getElementById('promptInput');
const sendBtn = document.getElementById('sendBtn');
const result = document.getElementById('result');

sendBtn.addEventListener('click', async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    result.textContent = '請先輸入內容。';
    return;
  }

  // 目前先做前端骨架互動；真正呼叫 Gemini 建議走後端 API
  // 並從 process.env.GEMINI_API_KEY 讀取金鑰，避免前端暴露。
  result.textContent = `你輸入的是：\n${prompt}\n\n下一步：把後端 API 接上 Gemini。`;
});
