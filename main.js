const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const state = {
  screen: 'ask',
  authMode: 'login',
  user: null,
  notes: [],
  questionSets: [],
  currentNoteId: null,
  currentQuiz: null,
  busy: false,
};

const els = {
  authGate: $('#authGate'), appShell: $('#appShell'),
  authForm: $('#authForm'), loginTab: $('#loginTab'), registerTab: $('#registerTab'),
  nameWrap: $('#nameWrap'), nameInput: $('#nameInput'), emailInput: $('#emailInput'),
  passwordInput: $('#passwordInput'), authBtn: $('#authBtn'), authMessage: $('#authMessage'),
  userName: $('#userName'), logoutBtn: $('#logoutBtn'),
  navAsk: $('#navAsk'), navNotes: $('#navNotes'), navQuestions: $('#navQuestions'), navQuiz: $('#navQuiz'),
  askPanel: $('#askPanel'), notesPanel: $('#notesPanel'), questionsPanel: $('#questionsPanel'), quizPanel: $('#quizPanel'),
  topic: $('#topicInput'), question: $('#questionInput'), grade: $('#gradeSelect'), subject: $('#subjectSelect'),
  askBtn: $('#askBtn'), result: $('#result'), resultBox: $('#resultBox'), loading: $('#loading'),
  history: $('#history'), emptyNotes: $('#emptyNotes'), notesCount: $('#notesCount'), questionsCount: $('#questionsCount'),
  editorArea: $('#noteEditorArea'), editor: $('#noteEditor'), titleInput: $('#noteTitleInput'), noteMeta: $('#noteMeta'),
  saveIndicator: $('#saveIndicator'), formatBlock: $('#formatBlock'), quizBox: $('#quizBox'), quizCount: $('#quizCount'), difficulty: $('#difficultySelect'),
  quizScope: $('#quizScope'), quizBtn: $('#quizBtn'), questionsList: $('#questionsList'), toast: $('#toast'),
};

const ALLOWED_TAGS = new Set(['H1','H2','H3','H4','P','STRONG','EM','U','S','DEL','UL','OL','LI','BLOCKQUOTE','PRE','CODE','BR','HR','TABLE','THEAD','TBODY','TR','TH','TD']);

function escapeHtml(text = '') {
  return String(text).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
}
function sanitizeRichHtml(input='') {
  const doc = new DOMParser().parseFromString(String(input), 'text/html');
  function cleanNode(node) {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.COMMENT_NODE) return child.remove();
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      if (!ALLOWED_TAGS.has(child.tagName)) {
        if (['DIV','SPAN','SECTION'].includes(child.tagName)) {
          const parent = child.parentNode;
          while (child.firstChild) parent.insertBefore(child.firstChild, child);
          child.remove();
        } else child.replaceWith(document.createTextNode(child.textContent || ''));
        return;
      }
      [...child.attributes].forEach((a) => child.removeAttribute(a.name));
      cleanNode(child);
    });
  }
  cleanNode(doc.body);
  return doc.body.innerHTML.trim();
}
function htmlToPlainText(input='') {
  const d=document.createElement('div'); d.innerHTML=sanitizeRichHtml(input);
  return (d.innerText||d.textContent||'').replace(/\n{3,}/g,'\n\n').trim();
}
function toast(text,type='info') {
  els.toast.textContent=text; els.toast.dataset.type=type; els.toast.classList.add('show');
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>els.toast.classList.remove('show'),2800);
}
async function api(path, options={}) {
  const opts={method:'GET',credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}};
  if (opts.body && typeof opts.body !== 'string') opts.body=JSON.stringify(opts.body);
  const res=await fetch(path,opts);
  let data={}; try { data=await res.json(); } catch { throw new Error(`伺服器沒有回傳有效資料（HTTP ${res.status}）。`); }
  if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
  return data;
}

function setAuthMode(mode) {
  state.authMode=mode;
  els.loginTab.classList.toggle('active',mode==='login');
  els.registerTab.classList.toggle('active',mode==='register');
  els.nameWrap.hidden=mode!=='register';
  els.authBtn.textContent=mode==='login'?'登入 ELOLearning':'建立帳號';
  els.passwordInput.autocomplete=mode==='login'?'current-password':'new-password';
  els.authMessage.textContent='';
}

async function submitAuth(e) {
  e.preventDefault();
  const payload={email:els.emailInput.value.trim(),password:els.passwordInput.value};
  if(state.authMode==='register') payload.name=els.nameInput.value.trim();
  els.authBtn.disabled=true; els.authMessage.textContent='處理中…';
  try {
    const data=await api(`/api/auth/${state.authMode==='login'?'login':'register'}`,{method:'POST',body:payload});
    state.user=data.user; await enterApp();
  } catch(err) { els.authMessage.textContent=err.message; }
  finally { els.authBtn.disabled=false; }
}

async function enterApp() {
  els.authGate.hidden=true; els.appShell.hidden=false;
  els.userName.textContent=`${state.user.name} · ${state.user.email}`;
  await loadData();
  const old = loadLegacyNotes();
  if(old.length) {
    const importedFlag=`elolearning.imported.${state.user.id}`;
    if(!localStorage.getItem(importedFlag)) {
      const should=confirm(`發現這台瀏覽器有 ${old.length} 筆舊版學習筆記。\n要把它們搬到「${state.user.name}」的雲端帳號嗎？`);
      if(should) {
        try { const r=await api('/api/notes/import',{method:'POST',body:{notes:old}}); if(r.added) toast(`已搬到雲端：${r.added} 筆`, 'success'); localStorage.setItem(importedFlag,'1'); await loadData(); } 
        catch(err) { toast(`舊筆記匯入失敗：${err.message}`,'error'); }
      } else localStorage.setItem(importedFlag,'1');
    }
  }
  updateCounts(); showScreen('ask');
}

function loadLegacyNotes() {
  const candidates=['elolearning.v2.rich-notes','elolearning.rich-notes','elolearning.notes'];
  for(const key of candidates) {
    try {
      const raw=JSON.parse(localStorage.getItem(key)||'[]');
      if(Array.isArray(raw) && raw.length) return raw;
    } catch {}
  }
  return [];
}

async function loadData() {
  const data=await api('/api/data');
  state.notes=data.notes||[]; state.questionSets=data.questions||[];
  state.currentNoteId=state.currentNoteId && state.notes.some(n=>n.id===state.currentNoteId) ? state.currentNoteId : (state.notes[0]?.id||null);
  if(state.currentNoteId) openNote(state.currentNoteId);
  renderHistory(); renderQuestions(); updateQuizScope(); updateCounts();
}

function updateCounts() {
  els.notesCount.textContent=`${state.notes.length} 筆`;
  els.questionsCount.textContent=`${state.questionSets.length} 份`;
}
function updateQuizScope() {
  els.quizScope.innerHTML='<option value="all">全部我的重點</option>'+state.notes.map(n=>`<option value="${escapeHtml(n.id)}">${escapeHtml(n.title)}</option>`).join('');
}

function showScreen(name) {
  state.screen=name;
  const panels={ask:els.askPanel,notes:els.notesPanel,questions:els.questionsPanel,quiz:els.quizPanel};
  Object.entries(panels).forEach(([k,v])=>v.hidden=k!==name);
  [els.navAsk,els.navNotes,els.navQuestions,els.navQuiz].forEach(b=>b.classList.remove('active'));
  ({ask:els.navAsk,notes:els.navNotes,questions:els.navQuestions,quiz:els.navQuiz})[name].classList.add('active');
  if(name==='notes' && state.currentNoteId) openNote(state.currentNoteId);
  if(name==='questions') renderQuestions();
}

function setBusy(value,text='AI 正在思考…') {
  state.busy=value; els.askBtn.disabled=value; els.quizBtn.disabled=value;
  els.loading.hidden=!value; $('#loading strong').textContent=text;
}
function renderHistory() {
  els.history.innerHTML='';
  if(!state.notes.length){ els.emptyNotes.hidden=false; els.editorArea.hidden=true; return; }
  els.emptyNotes.hidden=true;
  [...state.notes].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).forEach(note=>{
    const card=document.createElement('button'); card.className=`history-card ${note.id===state.currentNoteId?'selected':''}`; card.dataset.noteId=note.id;
    const plain=htmlToPlainText(note.html);
    card.innerHTML=`<span>${escapeHtml(note.title)}</span><small>${escapeHtml(note.subject)} · ${new Date(note.updatedAt).toLocaleString()}</small><p>${escapeHtml(plain.slice(0,120))}${plain.length>120?'…':''}</p>`;
    els.history.appendChild(card);
  });
}
function openNote(id) {
  const note=state.notes.find(n=>n.id===id); if(!note) return;
  state.currentNoteId=id; els.titleInput.value=note.title; els.noteMeta.textContent=`${note.grade} · ${note.subject} · 建立於 ${new Date(note.createdAt).toLocaleString()}`;
  els.editor.innerHTML=sanitizeRichHtml(note.html||'<p></p>'); els.editorArea.hidden=false; els.saveIndicator.textContent='已同步'; renderHistory();
}
async function createNoteFromAi(meta) {
  const r=await api('/api/notes',{method:'POST',body:meta});
  state.notes.unshift(r.note); state.currentNoteId=r.note.id; renderHistory(); updateQuizScope(); updateCounts(); openNote(r.note.id); return r.note;
}
async function saveCurrentNote(immediate=false) {
  const note=state.notes.find(n=>n.id===state.currentNoteId); if(!note) return;
  note.title=(els.titleInput.value.trim()||note.topic||'未命名筆記').slice(0,200);
  note.html=sanitizeRichHtml(els.editor.innerHTML); note.updatedAt=new Date().toISOString();
  renderHistory();
  clearTimeout(saveCurrentNote.timer);
  const delay=immediate?0:650;
  saveCurrentNote.timer=setTimeout(async()=>{
    els.saveIndicator.textContent='同步中…';
    try {
      const r=await api(`/api/notes/${encodeURIComponent(note.id)}`,{method:'PUT',body:{title:note.title,html:note.html}});
      Object.assign(note,r.note); els.saveIndicator.textContent='✓ 已同步'; renderHistory();
    } catch(err){ els.saveIndicator.textContent='同步失敗'; toast(`筆記同步失敗：${err.message}`,'error'); }
  },delay);
}
async function ask() {
  if(state.busy) return;
  const topic=els.topic.value.trim(), question=els.question.value.trim();
  if(!topic) return toast('先輸入學習主題。','warn');
  setBusy(true,'AI 正在回答並整理…'); els.resultBox.hidden=false;
  try {
    const data=await api('/api/ask',{method:'POST',body:{topic,question,grade:els.grade.value,subject:els.subject.value}});
    const html=sanitizeRichHtml(data.html||'<p>沒有內容</p>'); els.result.innerHTML=html;
    const note=await createNoteFromAi({title:topic,topic,question,grade:els.grade.value,subject:els.subject.value,html});
    toast(`「${note.title}」已保存到你的帳號！`,'success');
  } catch(err) { els.result.innerHTML=`<div class="error-card"><strong>AI 沒有成功回覆。</strong><p>${escapeHtml(err.message)}</p></div>`; toast('這次 AI 請求失敗。','error'); }
  finally { setBusy(false); }
}
let savedEditorRange = null;
function saveEditorSelection(){
  const sel=window.getSelection();
  if(!sel?.rangeCount || !els.editor.contains(sel.anchorNode) || !els.editor.contains(sel.focusNode)) return;
  savedEditorRange = sel.getRangeAt(0).cloneRange();
}
function restoreEditorSelection(){
  if(!savedEditorRange) return false;
  const sel=window.getSelection();
  sel.removeAllRanges(); sel.addRange(savedEditorRange);
  return true;
}
function execCommand(cmd,val=null){
  els.editor.focus();
  restoreEditorSelection();
  document.execCommand(cmd,false,val);
  saveCurrentNote(true);
  saveEditorSelection();
}
function insertNodeAtSelection(node) {
  els.editor.focus();
  restoreEditorSelection();
  const sel=window.getSelection();
  if(!sel?.rangeCount || !els.editor.contains(sel.anchorNode)) {
    els.editor.appendChild(node);
    const range=document.createRange(); range.selectNodeContents(node); range.collapse(false);
    sel.removeAllRanges(); sel.addRange(range);
    saveCurrentNote(true);
    saveEditorSelection();
    return;
  }
  const range=sel.getRangeAt(0);
  range.deleteContents(); range.insertNode(node); range.setStartAfter(node); range.collapse(true);
  sel.removeAllRanges(); sel.addRange(range);
  saveCurrentNote(true);
  saveEditorSelection();
}
function insertTable(rows=3,cols=3){
  const table=document.createElement('table'),thead=document.createElement('thead'),tr=document.createElement('tr');
  for(let c=0;c<cols;c++){const th=document.createElement('th');th.textContent=`標題 ${c+1}`;tr.appendChild(th);} thead.appendChild(tr);
  const tbody=document.createElement('tbody');
  for(let r=0;r<rows-1;r++){const row=document.createElement('tr');for(let c=0;c<cols;c++){const td=document.createElement('td');td.textContent='內容';row.appendChild(td);}tbody.appendChild(row);}
  table.append(thead,tbody); insertNodeAtSelection(table); const p=document.createElement('p');p.innerHTML='<br>';table.after(p);saveCurrentNote(true);
}
async function deleteCurrentNote(){
  const note=state.notes.find(n=>n.id===state.currentNoteId); if(!note) return;
  if(!confirm(`確定刪除「${note.title}」？`)) return;
  try { await api(`/api/notes/${encodeURIComponent(note.id)}`,{method:'DELETE'}); state.notes=state.notes.filter(n=>n.id!==note.id); state.currentNoteId=state.notes[0]?.id||null; renderHistory(); updateQuizScope(); updateCounts(); if(state.currentNoteId) openNote(state.currentNoteId); else els.editorArea.hidden=true; toast('筆記已刪除。','success'); }
  catch(err){toast(err.message,'error');}
}
async function clearNotes(){
  if(!state.notes.length) return;
  if(!confirm('確定清空你的所有學習重點？這會從雲端帳號刪除。')) return;
  try { await api('/api/notes',{method:'DELETE'}); state.notes=[];state.currentNoteId=null;renderHistory();updateQuizScope();updateCounts();toast('所有重點已清空。','success');}
  catch(err){toast(err.message,'error');}
}

async function downloadExternal(src,globalName){ if(window[globalName]) return window[globalName]; return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.async=true;s.onload=()=>window[globalName]?resolve(window[globalName]):reject(new Error(`無法載入 ${globalName}`));s.onerror=()=>reject(new Error(`無法載入匯出工具`));document.head.appendChild(s);}); }
function safeFilename(name){return String(name||'ELOLearning').replace(/[<>:"/\\|?*\x00-\x1F]/g,'-').slice(0,90);}
function exportDoc(note){const d=document.createElement('div');d.className='export-document';d.innerHTML=`<h1>${escapeHtml(note.title)}</h1><p>${escapeHtml(note.grade)} · ${escapeHtml(note.subject)}</p>${sanitizeRichHtml(note.html)}`;return d;}
async function downloadWord(){const n=state.notes.find(x=>x.id===state.currentNoteId);if(!n)return;try{const h=await downloadExternal('https://unpkg.com/html-docx-js@0.3.1/dist/html-docx.js','htmlDocx');const d=exportDoc(n);const html=`<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;line-height:1.7}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:7px}th{background:#eee}</style></head><body>${d.innerHTML}</body></html>`;downloadBlob(h.asBlob(html),`${safeFilename(n.title)}.docx`);toast('Word 已下載。','success');}catch(e){toast(`Word 匯出失敗：${e.message}`,'error');}}
async function downloadPdf(){const n=state.notes.find(x=>x.id===state.currentNoteId);if(!n)return;try{const h=await downloadExternal('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js','html2pdf');const d=exportDoc(n);Object.assign(d.style,{background:'#fff',color:'#111',width:'760px',padding:'40px',position:'fixed',left:'-10000px',top:'0'});document.body.appendChild(d);await h().set({margin:8,filename:`${safeFilename(n.title)}.pdf`,html2canvas:{scale:2,backgroundColor:'#fff'},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},pagebreak:{mode:['css','legacy']}}).from(d).save();d.remove();toast('PDF 已下載。','success');}catch(e){toast(`PDF 匯出失敗：${e.message}`,'error');}}
function downloadBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}

function plainNotesForQuiz(notes){return notes.map((n,i)=>`【第${i+1}筆｜${n.title}｜${n.subject}｜${n.grade}】\n${htmlToPlainText(n.html)}`).join('\n\n');}
async function makeQuiz(){
  if(state.busy)return;
  if(!state.notes.length)return toast('先保存一些學習重點，再來出題。','warn');
  const scope=els.quizScope.value;
  const selected=scope==='all'?state.notes:state.notes.filter(n=>n.id===scope);
  if(!selected.length)return toast('這份筆記不存在。','warn');
  setBusy(true,'AI 正在讀你的筆記並出題…');
  try{
    const r=await api('/api/quiz',{method:'POST',body:{notes:plainNotesForQuiz(selected),noteIds:selected.map(n=>n.id),count:Number(els.quizCount.value),difficulty:els.difficulty.value,subject:selected[0]?.subject||'綜合'}});
    state.questionSets.unshift(r.questionSet); updateCounts(); renderQuestions(); renderQuiz(r.quiz,r.questionSet.id); toast('題目已保存到「我的題目」。','success');
  } catch(err){toast(`出題失敗：${err.message}`,'error');}
  finally{setBusy(false);}
}
function renderQuiz(quiz,setId){
  state.currentQuiz={...quiz,setId,submitted:false}; els.quizBox.hidden=false;
  els.quizBox.innerHTML=`<div class="quiz-head"><div><span class="eyebrow">AI QUIZ</span><h2>開始作答</h2></div><button id="submitQuiz" class="primary-btn">交卷</button></div><div id="quizList"></div><div id="quizScore" class="quiz-score" hidden></div>`;
  const list=$('#quizList');
  quiz.questions.forEach((q,qi)=>{
    const card=document.createElement('section');card.className='quiz-card';
    card.innerHTML=`<div class="quiz-q"><b>${qi+1}</b><span>${escapeHtml(q.question)}</span></div><div class="options">${q.options.map((o,oi)=>`<label><input type="radio" name="q${qi}" value="${oi}"><span>${escapeHtml(o)}</span></label>`).join('')}</div><div class="explanation" id="exp${qi}" hidden>${escapeHtml(q.explanation||'')}</div>`;
    list.appendChild(card);
  });
}
async function submitQuiz(){
  const quiz=state.currentQuiz;if(!quiz||quiz.submitted)return;
  let score=0;
  quiz.questions.forEach((q,i)=>{const checked=$(`input[name="q${i}"]:checked`);const chosen=checked?Number(checked.value):-1;if(chosen===q.answer)score++;const exp=$(`#exp${i}`);exp.hidden=false;exp.innerHTML=`${chosen===q.answer?'✓ 答對！':'✕ 答案：'} ${escapeHtml(q.options[q.answer])}<br>${escapeHtml(q.explanation||'')}`;});
  quiz.submitted=true;$(`#quizScore`).hidden=false;$(`#quizScore`).innerHTML=`<strong>${score} / ${quiz.questions.length}</strong><span>完成這份練習。答案與解析已顯示。</span>`;
  try{await api(`/api/questions/${encodeURIComponent(quiz.setId)}/score`,{method:'POST',body:{score}});const set=state.questionSets.find(x=>x.id===quiz.setId);if(set){set.lastScore=score;set.lastAnsweredAt=new Date().toISOString();renderQuestions();}}catch{}
}
function renderQuestions(){
  els.questionsList.innerHTML='';
  if(!state.questionSets.length){els.questionsList.innerHTML='<div class="empty"><div>☷</div><h3>還沒有保存的題目</h3><p>到「開始出題」讓 AI 根據你的重點產生第一份練習。</p></div>';return;}
  [...state.questionSets].forEach(set=>{
    const card=document.createElement('article');card.className='saved-question-card'; card.dataset.questionId=set.id;
    card.innerHTML=`<div class="saved-question-main"><span class="eyebrow">SAVED QUIZ</span><h3>${escapeHtml(set.title)}</h3><p>${escapeHtml(set.subject)} · ${escapeHtml(set.difficulty)} · ${set.count} 題 · ${new Date(set.createdAt).toLocaleString()}</p>${set.lastScore!==null&&set.lastScore!==undefined?`<span class="saved-score">上次 ${set.lastScore} / ${set.count}</span>`:''}</div><div class="saved-question-actions"><button class="ghost-btn do-open">重新作答</button><button class="danger-btn do-delete">刪除</button></div>`;
    els.questionsList.appendChild(card);
  });
}

async function logout(){try{await api('/api/auth/logout',{method:'POST'});}catch{} location.reload();}

async function bootstrap(){
  setAuthMode('login');
  try{
    const me=await api('/api/auth/me');
    if(me.authenticated){state.user=me.user;await enterApp();}
    else{els.authGate.hidden=false;els.appShell.hidden=true;}
  }catch{els.authGate.hidden=false;els.appShell.hidden=true;}
}


function bindEvents() {
  // 事件委派：靜態、動態產生的按鈕都走同一條路，避免後續 render 後事件失效。
  document.addEventListener('click', async (event) => {
    const target = event.target;
    const btn = target.closest('button, [role="button"]');
    if (!btn) return;

    // 登入 / 註冊
    if (btn.id === 'loginTab') return setAuthMode('login');
    if (btn.id === 'registerTab') return setAuthMode('register');

    // 主導覽
    if (btn.id === 'navAsk') return showScreen('ask');
    if (btn.id === 'navNotes') return showScreen('notes');
    if (btn.id === 'navQuestions') return showScreen('questions');
    if (btn.id === 'navQuiz') return showScreen('quiz');

    // 一般操作
    if (btn.id === 'logoutBtn') return logout();
    if (btn.id === 'askBtn') return ask();
    if (btn.id === 'quizBtn') return makeQuiz();
    if (btn.id === 'editCurrentBtn') {
      if (state.currentNoteId) {
        showScreen('notes');
        openNote(state.currentNoteId);
      } else showScreen('notes');
      return;
    }
    if (btn.id === 'newNoteBtn') return createBlankNote();
    if (btn.id === 'clearAll') return clearNotes();
    if (btn.id === 'deleteNoteBtn') return deleteCurrentNote();
    if (btn.id === 'downloadWordBtn') return downloadWord();
    if (btn.id === 'downloadPdfBtn') return downloadPdf();
    if (btn.id === 'insertTableBtn') return insertTable();

    // 首頁快速格式提示
    if (btn.classList.contains('format-hint') || btn.closest('.format-hints')) {
      const prompt = btn.dataset.prompt;
      if (prompt) {
        els.question.value = els.question.value
          ? `${els.question.value}\n${prompt}`
          : prompt;
        els.question.focus();
      }
      return;
    }

    // 富文字工具列
    const editorButton = btn.closest('.editor-toolbar') && btn;
    if (editorButton?.dataset?.cmd) {
      execCommand(editorButton.dataset.cmd);
      return;
    }

    // 我的重點清單
    const historyCard = btn.closest('#history .history-card');
    if (historyCard) {
      const id = historyCard.dataset.noteId;
      if (id) openNote(id);
      return;
    }

    // 我的題目操作
    const questionCard = btn.closest('.saved-question-card');
    if (questionCard) {
      const id = questionCard.dataset.questionId;
      if (btn.classList.contains('do-open')) {
        const set = state.questionSets.find((item) => item.id === id);
        if (set) {
          showScreen('quiz');
          renderQuiz({ questions: set.questions }, set.id);
        }
        return;
      }
      if (btn.classList.contains('do-delete')) {
        return deleteQuestionSet(id);
      }
    }

    // 動態產生的交卷按鈕
    if (btn.id === 'submitQuiz') return submitQuiz();
  });

  // 表單提交
  els.authForm.addEventListener('submit', submitAuth);

  // 鍵盤快捷鍵
  els.question.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      ask();
    }
  });

  // 編輯器：只保存選取，不阻止原生 click，避免按鈕「看得到但按不到」。
  els.editor.addEventListener('input', () => {
    saveEditorSelection();
    saveCurrentNote();
  });
  ['keyup', 'mouseup', 'focus'].forEach((type) => {
    els.editor.addEventListener(type, saveEditorSelection);
  });

  document.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('.editor-toolbar button');
    if (button && els.editor.contains(document.activeElement)) {
      saveEditorSelection();
    }
  });

  // 格式區塊選單
  els.formatBlock.addEventListener('change', (event) => {
    if (!event.target.value) return;
    execCommand('formatBlock', event.target.value);
  });

  // 筆記標題
  els.titleInput.addEventListener('input', () => saveCurrentNote());

  // 防止 brand 的 # 把畫面跳回最頂端
  document.querySelector('.brand')?.addEventListener('click', (event) => {
    event.preventDefault();
    showScreen('ask');
  });

  // 點空白處時不做任何額外處理
}

async function createBlankNote() {
  try {
    const r = await api('/api/notes', {
      method: 'POST',
      body: {
        title: '新筆記',
        topic: '新筆記',
        subject: '其他',
        grade: '',
        html: '<h2>新筆記</h2><p>開始記錄你的學習內容。</p>',
      },
    });
    state.notes.unshift(r.note);
    state.currentNoteId = r.note.id;
    updateQuizScope();
    updateCounts();
    renderHistory();
    showScreen('notes');
    openNote(r.note.id);
    toast('新筆記已建立。', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function deleteQuestionSet(id) {
  const set = state.questionSets.find((item) => item.id === id);
  if (!set) return;
  if (!confirm(`刪除「${set.title}」？`)) return;
  try {
    await api(`/api/questions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.questionSets = state.questionSets.filter((item) => item.id !== id);
    updateCounts();
    renderQuestions();
    toast('題目已刪除。', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function refreshDynamicIds() {
  document.querySelectorAll('#history .history-card').forEach((card) => {
    if (!card.dataset.noteId) {
      const note = state.notes.find((item) => card.querySelector('span')?.textContent === item.title);
      if (note) card.dataset.noteId = note.id;
    }
  });
}

bindEvents();

bootstrap();
