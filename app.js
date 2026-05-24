// 医学部英語 重要語彙マスター — app.js
// ====================================================
// 音声トラブル防止の設計ポイント：
//   1. speak() は必ず cancel→80ms待機→発話（Chromiumバグ対策）
//   2. モード切替・画面遷移時に stopSpeak() を冒頭で呼ぶ
//   3. リスニングモード遷移後は 150ms 余分に待機してから描画・発音
//   4. listenReveal() は描画完了を待って 200ms 後に発音
//   5. listenRate() / nextQuiz() の冒頭で stopSpeak()
//   6. visibilitychange でタブ非表示時に自動停止
//   7. Chrome 14秒バグ対策：10秒ごとに pause/resume
//   8. 発音ボタンはトグル動作（発話中に押すと停止）
// ====================================================

const STORAGE_KEY = 'mvm_v1';

let State = {
  vocab:          null,
  progress:       {},   // { wordId: 'known' | 'weak' }
  streak:         0,
  lastStudyDate:  null,
  currentTopic:   null,
  currentMode:    null,
  studyQueue:     [],
  studyIdx:       0,
  studyFlipped:   false,
  quizQueue:      [],
  quizIdx:        0,
  quizScore:      0,
  quizAnswered:   false,
  listenQueue:    [],
  listenIdx:      0,
  listenRevealed: false,
};

// =====================================================
// PERSISTENCE
// =====================================================
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      progress: State.progress,
      streak: State.streak,
      lastStudyDate: State.lastStudyDate,
    }));
  } catch(e) {}
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (d.progress)       State.progress = d.progress;
    if (d.streak)         State.streak = d.streak;
    if (d.lastStudyDate)  State.lastStudyDate = d.lastStudyDate;
  } catch(e) {}
}

// =====================================================
// VOICE ENGINE — トラブル防止設計
// =====================================================
let _voice      = null;
let _spkTimer   = null;
let _kaTimer    = null;
let _isSpeaking = false;

function initVoice() {
  const upd = () => {
    const vs = speechSynthesis.getVoices();
    const en = vs.filter(v => v.lang.startsWith('en'));
    _voice = en.find(v => v.lang === 'en-US' && v.name.includes('Google'))
          || en.find(v => v.lang === 'en-US')
          || en[0] || vs[0];
  };
  speechSynthesis.addEventListener('voiceschanged', upd);
  upd(); setTimeout(upd, 600); setTimeout(upd, 1800);
}

function speak(text, onDone) {
  if (!text) { if (onDone) onDone(); return; }

  // ① 前の発話を確実にキャンセル
  speechSynthesis.cancel();
  clearTimeout(_spkTimer);
  clearInterval(_kaTimer);
  _isSpeaking = false;
  updSpeakUI(false);

  // ② 80ms 待機後に発話（Chromiumバグ対策：これがないと無音になる）
  _spkTimer = setTimeout(() => {
    const u = new SpeechSynthesisUtterance(text);
    if (_voice) u.voice = _voice;
    u.lang = 'en-US'; u.rate = 0.95; u.pitch = 1; u.volume = 1;

    u.onstart = () => { _isSpeaking = true; updSpeakUI(true); };
    u.onend   = () => {
      _isSpeaking = false; updSpeakUI(false);
      clearInterval(_kaTimer);
      if (onDone) onDone();
    };
    u.onerror = (e) => {
      // 'interrupted' は stopSpeak() によるキャンセルなので無視
      if (e.error !== 'interrupted') {
        _isSpeaking = false; updSpeakUI(false);
      }
      clearInterval(_kaTimer);
      if (onDone) onDone();
    };

    speechSynthesis.speak(u);

    // ③ Chrome 14秒バグ対策：10秒ごとに pause/resume
    _kaTimer = setInterval(() => {
      if (speechSynthesis.speaking) {
        speechSynthesis.pause();
        speechSynthesis.resume();
      } else {
        clearInterval(_kaTimer);
      }
    }, 10000);
  }, 80);
}

function stopSpeak() {
  speechSynthesis.cancel();
  clearTimeout(_spkTimer);
  clearInterval(_kaTimer);
  _isSpeaking = false;
  updSpeakUI(false);
}

function updSpeakUI(on) {
  document.querySelectorAll('.speak-btn, .speak-big, .q-speak-btn').forEach(b => {
    b.classList.toggle('speaking', on);
    b.classList.toggle('active', on);
  });
  const w = document.getElementById('wave');
  if (w) w.className = 'wave' + (on ? ' on' : '');
}

// タブ非表示（切り替え）時に自動停止
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopSpeak();
});

// =====================================================
// UTILS
// =====================================================
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getAllWords() {
  return State.vocab ? State.vocab.topics.flatMap(t => t.words) : [];
}

function getTopicWords(topicId) {
  const t = State.vocab?.topics.find(t => t.id === topicId);
  return t ? t.words : [];
}

function getWeakWords() {
  return getAllWords().filter(w => State.progress[w.id] === 'weak');
}

function getMasteredCount(topicId) {
  const words = topicId ? getTopicWords(topicId) : getAllWords();
  return words.filter(w => State.progress[w.id] === 'known').length;
}

function getTopicOfWord(wordId) {
  return State.vocab?.topics.find(t => t.words.some(w => w.id === wordId)) || null;
}

function updateStreak() {
  const today = new Date().toDateString();
  if (State.lastStudyDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    State.streak = (State.lastStudyDate === yesterday) ? State.streak + 1 : 1;
    State.lastStudyDate = today;
  }
}

// =====================================================
// HEADER / PROGRESS UPDATE
// =====================================================
function updateHeader() {
  if (!State.vocab) return;
  const total    = State.vocab.total;
  const mastered = getMasteredCount();
  const pct      = Math.round(mastered / total * 100);

  document.getElementById('hd-pct').textContent    = pct + '% | ' + mastered + '/' + total;
  document.getElementById('hd-streak').textContent = '⚑' + State.streak;
  document.getElementById('pb-fill').style.width   = pct + '%';
  document.getElementById('pb-l').textContent      = pct + '%';
  document.getElementById('pb-r').textContent      = mastered + ' / ' + total;
}

// =====================================================
// SCREEN NAVIGATION
// =====================================================
function showScreen(id) {
  stopSpeak(); // ← 画面遷移時は必ず停止
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('scr-' + id)?.classList.add('active');
  updateHeader();
}

// =====================================================
// HOME
// =====================================================
function goHome() {
  stopSpeak();
  showScreen('home');
}

// =====================================================
// TOPICS SCREEN
// =====================================================
function renderTopics() {
  const container = document.getElementById('topic-list');
  container.innerHTML = '';
  State.vocab.topics.forEach(topic => {
    const total = topic.count;
    const done  = getMasteredCount(topic.id);
    const pct   = Math.round(done / total * 100);
    const card  = document.createElement('div');
    card.className = 'topic-card';
    card.innerHTML = `
      <div class="t-icon">${topic.icon}</div>
      <div class="t-info">
        <div class="t-name">${topic.name}</div>
        <div class="t-theme">${topic.theme}</div>
        <div class="t-meta">
          <span class="t-count">${total}語</span>
          <span class="t-prog">${pct}% 習得</span>
        </div>
        <div class="t-bar"><div class="t-bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
    card.addEventListener('click', () => openModal(topic));
    container.appendChild(card);
  });
}

function openModal(topic) {
  State.currentTopic = topic;
  document.getElementById('modal-title').textContent    = topic.icon + ' ' + topic.name;
  document.getElementById('modal-sub').textContent      = topic.theme;
  document.getElementById('mode-full-count').textContent = topic.count + '語';
  document.getElementById('mode-modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('mode-modal').classList.add('hidden');
}

function startMode(mode) {
  closeModal();
  State.currentMode = mode;
  const words = getTopicWords(State.currentTopic.id);
  if      (mode === 'full')   startFlash(words);
  else if (mode === 'small')  startFlash(shuffle(words).slice(0, 10));
  else if (mode === 'quiz')   startQuiz(words);
  else if (mode === 'listen') startListen(words);
}

// =====================================================
// REVIEW SCREEN
// =====================================================
function renderReview() {
  const weak    = getWeakWords();
  const total   = getAllWords().length;
  const weakBtn = document.getElementById('btn-weak');
  const emptyEl = document.getElementById('weak-empty');

  document.getElementById('weak-count').textContent   = weak.length + '語';
  document.getElementById('r-total-count').textContent = total + '語から';

  if (weak.length === 0) {
    weakBtn.style.opacity        = '.4';
    weakBtn.style.pointerEvents  = 'none';
    emptyEl.style.display        = 'block';
  } else {
    weakBtn.style.opacity        = '1';
    weakBtn.style.pointerEvents  = 'auto';
    emptyEl.style.display        = 'none';
  }
}

function startWeakReview() {
  const words = getWeakWords();
  if (!words.length) return;
  State.currentTopic = { id: '_weak', name: 'Weak Words', icon: '⚑', count: words.length };
  State.currentMode  = 'full';
  startFlash(shuffle(words));
}

function startRandomReview() {
  const all = getAllWords();
  State.currentTopic = { id: '_all', name: '総復習', icon: '🎲', count: all.length };
  State.currentMode  = 'full';
  startFlash(shuffle(all));
}

// =====================================================
// FLASHCARD
// =====================================================
const CH_ACCENTS = {
  ch1:'#1F4E79', ch2:'#375623', ch3:'#7B6000',
  ch4:'#783F04', ch5:'#4A1B7D', ch6:'#434343'
};

function startFlash(words) {
  State.studyQueue   = words;
  State.studyIdx     = 0;
  State.studyFlipped = false;
  showScreen('flash');
  renderFlash();
}

function renderFlash() {
  if (State.studyIdx >= State.studyQueue.length) { showResult(); return; }

  const w     = State.studyQueue[State.studyIdx];
  const total = State.studyQueue.length;
  const pct   = Math.round(State.studyIdx / total * 100);
  const t     = getTopicOfWord(w.id);
  const color = CH_ACCENTS[t?.id] || '#1F4E79';

  // ヘッダー進捗
  document.getElementById('flash-prog-txt').textContent      = (State.studyIdx + 1) + ' / ' + total;
  document.getElementById('flash-mini-fill').style.width     = pct + '%';

  // カードのアクセントカラー
  document.getElementById('flash-card').style.setProperty('--card-accent', color);

  // 表面
  State.studyFlipped = false;
  document.getElementById('fc-label').textContent            = '英語';
  document.getElementById('fc-word').textContent             = w.word;
  document.getElementById('fc-pos').textContent              = w.pos;
  document.getElementById('fc-freq').style.display           = w.freq === 2 ? 'inline-block' : 'none';
  document.getElementById('fc-univ').textContent             = w.univ ? '📍 ' + w.univ.replace(/\//g, ' / ') : '';
  document.getElementById('fc-univ').style.display           = w.univ ? 'block' : 'none';
  document.getElementById('fc-hint').textContent             = 'タップで意味を見る 👆';

  // 裏面（非表示）
  document.getElementById('fc-meaning').textContent          = w.meaning;
  document.getElementById('fc-etym').textContent             = w.etymology ? '💡 ' + w.etymology : '';
  document.getElementById('fc-etym').style.display           = w.etymology ? 'block' : 'none';
  document.getElementById('fc-deriv').textContent            = w.derivatives ? '▶ 派生語：' + w.derivatives : '';
  document.getElementById('fc-deriv').style.display          = w.derivatives ? 'block' : 'none';
  document.getElementById('fc-ex').textContent               = w.example || '';
  document.getElementById('fc-ex-ja').textContent            = w.example_ja || '';

  const back = document.getElementById('fc-back');
  back.classList.remove('show');

  // 評価ボタンはめくるまで無効
  const rateRow = document.getElementById('rate-row');
  rateRow.style.opacity       = '.35';
  rateRow.style.pointerEvents = 'none';
}

function flipCard() {
  State.studyFlipped = !State.studyFlipped;
  const back     = document.getElementById('fc-back');
  const rateRow  = document.getElementById('rate-row');
  const hint     = document.getElementById('fc-hint');

  back.classList.toggle('show', State.studyFlipped);
  hint.textContent = '';
  rateRow.style.opacity       = State.studyFlipped ? '1'    : '.35';
  rateRow.style.pointerEvents = State.studyFlipped ? 'auto' : 'none';

  // めくったら自動発音
  if (State.studyFlipped) {
    speak(State.studyQueue[State.studyIdx]?.word);
  }
}

function speakCurrentCard() {
  // トグル動作：再生中なら停止、停止中なら再生
  if (_isSpeaking) { stopSpeak(); return; }
  const w = State.studyQueue[State.studyIdx];
  if (w) speak(w.word);
}

function rateWord(rating) {
  const w = State.studyQueue[State.studyIdx];
  if (w) State.progress[w.id] = (rating === 'knew') ? 'known' : 'weak';
  if (rating === 'knew') { updateStreak(); spawnConfetti(3); }
  save(); updateHeader();
  State.studyIdx++;
  State.studyFlipped = false;
  renderFlash();
}

// =====================================================
// QUIZ
// =====================================================
function startQuiz(words) {
  stopSpeak(); // モード切替時に必ず停止
  State.quizQueue    = shuffle(words).slice(0, 20);
  State.quizIdx      = 0;
  State.quizScore    = 0;
  State.quizAnswered = false;
  showScreen('quiz');
  renderQuiz();
}

function renderQuiz() {
  if (State.quizIdx >= State.quizQueue.length) { showResult(); return; }

  const w     = State.quizQueue[State.quizIdx];
  const total = State.quizQueue.length;
  const pct   = Math.round(State.quizIdx / total * 100);
  const t     = getTopicOfWord(w.id);

  document.getElementById('quiz-num').textContent       = (State.quizIdx + 1) + '/' + total + ' 英→日';
  document.getElementById('quiz-score-live').textContent = State.quizScore + '点';
  document.getElementById('quiz-q-fill').style.width    = pct + '%';
  document.getElementById('q-word').textContent         = w.word;
  document.getElementById('q-pos').textContent          = w.pos;
  document.getElementById('q-freq').style.display       = w.freq === 2 ? 'inline-block' : 'none';
  document.getElementById('q-ch').textContent           = t ? t.id.toUpperCase() + ' — ' + t.name : '';

  // 選択肢（同トピックから3つの誤答）
  const sameTopicWords = (t ? t.words : getAllWords()).filter(x => x.id !== w.id);
  const wrongs  = shuffle(sameTopicWords.length >= 3 ? sameTopicWords : getAllWords().filter(x => x.id !== w.id)).slice(0, 3);
  const choices = shuffle([w, ...wrongs]);

  const grid = document.getElementById('choices-grid');
  grid.innerHTML = '';
  choices.forEach(c => {
    const btn = document.createElement('button');
    btn.className   = 'choice-btn';
    btn.textContent = c.meaning;
    btn.addEventListener('click', () => answerQuiz(btn, c.id === w.id, w));
    grid.appendChild(btn);
  });

  document.getElementById('quiz-feedback').style.display  = 'none';
  document.getElementById('quiz-next-wrap').style.display = 'none';
  State.quizAnswered = false;
}

function answerQuiz(clickedBtn, isCorrect, word) {
  if (State.quizAnswered) return;
  State.quizAnswered = true;

  // 選択肢の色付け
  const grid = document.getElementById('choices-grid');
  grid.querySelectorAll('.choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === word.meaning) {
      btn.classList.add('correct'); // 正解は緑
    } else if (btn === clickedBtn && !isCorrect) {
      btn.classList.add('wrong');   // 選んだ不正解は赤
    }
  });

  if (isCorrect) {
    State.quizScore++;
    if (!State.progress[word.id]) State.progress[word.id] = 'known';
    spawnConfetti(2);
  } else {
    State.progress[word.id] = 'weak';
  }
  save(); updateHeader();

  // フィードバック表示
  const fb = document.getElementById('quiz-feedback');
  fb.style.display = 'block';
  fb.innerHTML = (isCorrect
    ? '<strong style="color:#43A047">✓ 正解！</strong>'
    : '<strong style="color:#E63946">✗ 不正解</strong>')
    + ' &nbsp;— <strong>' + word.word + '</strong> = ' + word.meaning
    + (word.etymology ? '<br><span style="font-size:12px;color:#718096">💡 ' + word.etymology + '</span>' : '');

  document.getElementById('quiz-next-wrap').style.display = 'block';

  // 正解音声を再生
  speak(word.word);
}

function speakQuizWord() {
  if (_isSpeaking) { stopSpeak(); return; }
  const w = State.quizQueue[State.quizIdx];
  if (w) speak(w.word);
}

function nextQuiz() {
  stopSpeak(); // ← 次へ移動前に必ず停止
  State.quizIdx++;
  State.quizAnswered = false;
  renderQuiz();
}

// =====================================================
// LISTEN — 最も音声トラブルが起きやすいモード
// =====================================================
function startListen(words) {
  stopSpeak(); // ← モード切替時に必ず停止

  State.listenQueue    = shuffle(words);
  State.listenIdx      = 0;
  State.listenRevealed = false;

  showScreen('listen');

  // リスニングモードへの切り替え後は 150ms 余分に待機してから描画
  // （SpeechSynthesis の初期化を待つ）
  setTimeout(renderListen, 150);
}

function renderListen() {
  if (State.listenIdx >= State.listenQueue.length) { showResult(); return; }

  const w     = State.listenQueue[State.listenIdx];
  const total = State.listenQueue.length;
  const pct   = Math.round(State.listenIdx / total * 100);

  document.getElementById('listen-prog-txt').textContent    = (State.listenIdx + 1) + ' / ' + total;
  document.getElementById('listen-mini-fill').style.width   = pct + '%';
  document.getElementById('listen-status').textContent      = State.listenRevealed
    ? '発音を確認する' : '音声を聞いて語を当てよう';

  const revealArea = document.getElementById('listen-reveal-area');
  const revealBtn  = document.getElementById('listen-reveal-btn');
  const rateRow    = document.getElementById('listen-rate-row');

  if (State.listenRevealed) {
    revealArea.style.display = 'block';
    revealBtn.style.display  = 'none';
    rateRow.style.display    = 'flex';

    document.getElementById('listen-word').textContent    = w.word;
    document.getElementById('listen-meaning').textContent = w.meaning;
    const etymEl = document.getElementById('listen-etym');
    etymEl.textContent  = w.etymology || '';
    etymEl.style.display = w.etymology ? 'block' : 'none';
  } else {
    revealArea.style.display = 'none';
    revealBtn.style.display  = 'block';
    rateRow.style.display    = 'none';
  }
}

function listenSpeak() {
  // トグル動作（発話中に押すと停止）
  if (_isSpeaking) { stopSpeak(); return; }
  const w = State.listenQueue[State.listenIdx];
  if (!w) return;
  speak(w.word);
}

function listenReveal() {
  State.listenRevealed = true;
  renderListen();
  // 描画完了後 200ms 待ってから発音（DOM更新を待つ）
  const w = State.listenQueue[State.listenIdx];
  if (w) setTimeout(() => speak(w.word), 200);
}

function listenRate(rating) {
  stopSpeak(); // ← 次のカードへ移動前に必ず停止

  const w = State.listenQueue[State.listenIdx];
  if (w) State.progress[w.id] = (rating === 'ok') ? 'known' : 'weak';
  save(); updateHeader();

  State.listenIdx++;
  State.listenRevealed = false;
  renderListen();
}

// =====================================================
// RESULT
// =====================================================
function showResult() {
  stopSpeak();
  updateStreak();
  save();

  const isQuiz   = State.currentMode === 'quiz';
  const score    = isQuiz ? State.quizScore + ' / ' + State.quizQueue.length
                          : getMasteredCount() + ' / ' + (State.vocab?.total || 0);
  const pct      = isQuiz
    ? State.quizScore / Math.max(State.quizQueue.length, 1) * 100
    : getMasteredCount() / Math.max(State.vocab?.total || 1, 1) * 100;
  const msg      = pct >= 80 ? '素晴らしい！高得点です！🎉'
                 : pct >= 60 ? 'よく頑張りました！💪' : '復習を続けよう！📚';

  document.getElementById('res-score').textContent  = score;
  document.getElementById('res-streak').textContent = State.streak + '日連続学習中🔥';
  document.getElementById('res-msg').textContent    = msg;

  showScreen('result');
  spawnConfetti(8);
}

function retrySession() {
  stopSpeak();
  const weak = getWeakWords();
  if (!weak.length) { goHome(); return; }
  State.currentTopic = { id: '_weak', name: 'Weak Words', icon: '⚑', count: weak.length };
  State.currentMode  = 'full';
  startFlash(shuffle(weak));
}

// =====================================================
// CONFETTI
// =====================================================
const CONFETTI_COLORS = ['#1F4E79','#2EC4B6','#F4A261','#E63946','#43A047','#7B2FBE','#FFB300'];
function spawnConfetti(n) {
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className  = 'confetti-piece';
      el.style.cssText = `left:${Math.random()*100}vw;top:-10px;`
        + `background:${CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]};`
        + `transform:rotate(${Math.random()*360}deg);`
        + `animation-duration:${1 + Math.random()}s;`
        + `animation-delay:${Math.random() * .3}s`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2000);
    }, i * 80);
  }
}

// =====================================================
// TOAST
// =====================================================
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

// =====================================================
// INIT
// =====================================================
async function init() {
  load();
  initVoice();

  try {
    const res = await fetch('vocabulary.json');
    if (!res.ok) throw new Error('fetch failed');
    State.vocab = await res.json();
  } catch(e) {
    document.getElementById('app').innerHTML =
      '<div style="padding:40px;text-align:center;font-size:15px;color:#666;line-height:1.8">' +
      '⚠️ データ読み込みエラー<br>' +
      'ローカルファイルとして開くとJSONが読めない場合があります。<br>' +
      'GitHub Pages等のサーバーから開いてください。</div>';
    return;
  }

  showScreen('home');
  updateHeader();
}

document.addEventListener('DOMContentLoaded', init);
