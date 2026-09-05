const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = { mode: 'summary', busy: false };
const els = {
  topic: $('#topicInput'),
  message: $('#messageInput'),
  grade: $('#gradeSelect'),
  subject: $('#subjectSelect'),
  send: $('#sendBtn'),
  resultSection: $('#resultSection'),
  result: $('#result'),
  resultTitle: $('#resultTitle'),
  modelBadge: $('#modelBadge'),
  loading: $('#loading'),
  sources: $('#sources'),
  welcome: $('#welcomeCard'),
  toast: $('#toast'),
  charCount: $('#charCount'),
  modeTitle: $('#modeTitle'),
  messageLabel: $('#messageLabel'),
  statusDot: $('#statusDot'),
  statusText: $('#statusText'),
};

const modeConfig = {
  summary: { title: '今天想學什麼？', resultTitle: '你的學習地圖', button: '開始整理', placeholder: '例如：岳陽樓記、一次函數、細胞構造…', message: '想補充什麼？' },
  quiz: { title: '來測一下你會多少？', resultTitle: '你的練習題', button: '開始出題', placeholder: '例如：岳陽樓記、論語選、古詩詞閱讀…', message: '想要特別練什麼？' },
  tutor: { title: '把問題丟給 AI 老師。', resultTitle: 'AI 老師回答', button: '開始提問', placeholder: '例如：我不懂「先天下之憂而憂」…', message: '你卡在哪裡？' },
};

function showToast(message, type = 'info') {
  els.toast.textContent = message;
  els.toast.dataset.type = type;
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2800);
}

function setMode(mode) {
  state.mode = mode;
  $$('.mode-card').forEach((button) => button.classList.toggle('selected', button.dataset.mode === mode));
  const config = modeConfig[mode];
  els.modeTitle.textContent = config.title;
  els.resultTitle.textContent = config.resultTitle;
  els.send.querySelector('span').textContent = config.button;
  els.topic.placeholder = config.placeholder;
  els.messageLabel.firstChild.textContent = config.message;
  els.message.placeholder = mode === 'quiz'
    ? '例如：多出一些修辭題，或希望難度稍微高一點。'
    : mode === 'tutor'
      ? '把你真正不懂的地方說出來，AI 會從基礎開始教。'
      : '例如：我看過課文了，但不懂這句話到底在說什麼。';
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function inlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  return html;
}

function renderMarkdown(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  let html = '';
  let inList = false;
  let listType = null;

  const closeList = () => {
    if (!inList) return;
    html += `</${listType}>`;
    inList = false;
    listType = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    if (/^###\s+/.test(line)) {
      closeList();
      html += `<h5>${inlineMarkdown(line.replace(/^###\s+/, ''))}</h5>`;
    } else if (/^##\s+/.test(line)) {
      closeList();
      html += `<h4>${inlineMarkdown(line.replace(/^##\s+/, ''))}</h4>`;
    } else if (/^#\s+/.test(line)) {
      closeList();
      html += `<h3>${inlineMarkdown(line.replace(/^#\s+/, ''))}</h3>`;
    } else if (/^[-*]\s+/.test(line)) {
      if (!inList || listType !== 'ul') { closeList(); html += '<ul>'; inList = true; listType = 'ul'; }
      html += `<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`;
    } else if (/^\d+\.\s+/.test(line)) {
      if (!inList || listType !== 'ol') { closeList(); html += '<ol>'; inList = true; listType = 'ol'; }
      html += `<li>${inlineMarkdown(line.replace(/^\d+\.\s+/, ''))}</li>`;
    } else {
      closeList();
      html += `<p>${inlineMarkdown(line)}</p>`;
    }
  }
  closeList();
  return html;
}

function renderSources(sources = []) {
  if (!sources.length) {
    els.sources.classList.add('hidden');
    els.sources.innerHTML = '';
    return;
  }
  els.sources.classList.remove('hidden');
  els.sources.innerHTML = `<div class="sources-title">參考來源</div>${sources.map((source, index) => `
    <a class="source-card" href="${escapeHtml(source.uri)}" target="_blank" rel="noopener noreferrer">
      <span>${index + 1}</span><div><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(source.uri)}</small></div><b>↗</b>
    </a>`).join('')}`;
}

function setLoading(busy) {
  state.busy = busy;
  els.send.disabled = busy;
  els.send.classList.toggle('loading-state', busy);
  els.loading.classList.toggle('hidden', !busy);
  if (busy) els.result.innerHTML = '';
}

async function checkHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    if (data.configured) {
      els.statusDot.className = 'status-dot online';
      els.statusText.textContent = 'AI 已就緒';
    } else {
      els.statusDot.className = 'status-dot offline';
      els.statusText.textContent = '尚未設定 API Key';
    }
  } catch {
    els.statusDot.className = 'status-dot offline';
    els.statusText.textContent = '後端尚未啟動';
  }
}

async function learn() {
  if (state.busy) return;
  const topic = els.topic.value.trim();
  const message = els.message.value.trim();
  if (!topic) {
    els.topic.focus();
    showToast('先輸入一個學習主題吧。', 'warn');
    return;
  }

  els.resultSection.classList.remove('hidden');
  els.welcome.classList.add('hidden');
  setLoading(true);
  renderSources([]);

  try {
    const response = await fetch('/api/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: state.mode, topic, message, grade: els.grade.value, subject: els.subject.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '請求失敗');

    els.result.innerHTML = renderMarkdown(data.text || '沒有收到內容。');
    els.modelBadge.textContent = data.model || 'Gemini';
    renderSources(data.sources || []);
    showToast('完成！來看看 AI 幫你整理的內容。', 'success');
    localStorage.setItem('elolearning:lastTopic', topic);
  } catch (error) {
    els.result.innerHTML = `<div class="error-card"><strong>這次沒有成功連上 AI。</strong><p>${escapeHtml(error.message || '未知錯誤')}</p><small>請確認後端已啟動、.env 已設定 GEMINI_API_KEY，然後再試一次。</small></div>`;
    showToast('AI 請求失敗，已把原因顯示在結果區。', 'error');
  } finally {
    setLoading(false);
  }
}

function updateCounter() {
  els.charCount.textContent = `${els.message.value.length} / 2000`;
}

$('.input-action').addEventListener('click', () => els.topic.focus());
$('#focusBtn').addEventListener('click', () => els.topic.focus());
els.send.addEventListener('click', learn);
els.message.addEventListener('input', updateCounter);
els.topic.addEventListener('keydown', (event) => { if (event.key === 'Enter') learn(); });
$('#clearBtn').addEventListener('click', () => {
  els.topic.value = '';
  els.message.value = '';
  updateCounter();
  els.resultSection.classList.add('hidden');
  els.welcome.classList.remove('hidden');
  els.result.innerHTML = '';
  renderSources([]);
  els.topic.focus();
});
$$('.mode-card').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
$$('.topic-chip').forEach((button) => button.addEventListener('click', () => { els.topic.value = button.textContent; els.topic.focus(); }));
$$('.example-btn').forEach((button) => button.addEventListener('click', () => {
  const text = button.dataset.example;
  if (text.startsWith('我想理解') || text.startsWith('幫我複習')) els.topic.value = text.replace(/^我想理解|^幫我複習/, '').trim();
  else { setMode('tutor'); els.topic.value = text.replace('我不懂', '').replace('，可以用簡單的方法教我嗎？', '').trim(); els.message.value = text; updateCounter(); }
  els.topic.focus();
}));

document.addEventListener('keydown', (event) => {
  if (event.target.matches('input, textarea, select')) return;
  if (event.key === '1') setMode('summary');
  if (event.key === '2') setMode('quiz');
  if (event.key === '3') setMode('tutor');
});

setMode('summary');
updateCounter();
checkHealth();
