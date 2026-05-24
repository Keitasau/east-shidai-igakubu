'use strict';

// ============================================================
// STATE
// ============================================================
const State = {
  vocab: [],
  progress: {},
  sessions: {},
  weakWords: new Set(),
  currentScreen: 'screen-home',
};

const STORAGE_KEY = 'mvm_v1';
const TOTAL = 512;
const SMALL_STEP_SIZE = 10;

// Topic → creature/environment config (Medical edition)
const TOPIC_META = {
  'Medical Science':      {
    emoji: '🏥', color: '#29b6f6',
    creatures: ['🩺','💊','🧬','🔬','🩻'],
    corals: ['💊','🩺','🔬','🧪'],
    bgCreature: '🩺',
    label: '臨床・免疫・神経・腫瘍'
  },
  'Public Health Sea':    {
    emoji: '🌍', color: '#66bb6a',
    creatures: ['🦠','💉','🌍','🏥','🧪'],
    corals: ['🌿','🦠','💉','🌊'],
    bgCreature: '🌍',
    label: '感染症・環境・社会'
  },
  'Mind & Brain Bay':     {
    emoji: '🧠', color: '#ce93d8',
    creatures: ['🧠','💭','🔮','🦋','💡'],
    corals: ['🌿','💜','🌸','🍄'],
    bgCreature: '🧠',
    label: '認知・記憶・感情・行動'
  },
  'Bioethics Abyss':      {
    emoji: '⚖️', color: '#ef5350',
    creatures: ['⚖️','📜','🕊️','🏛️','🔬'],
    corals: ['🪸','📜','🕊️','🌊'],
    bgCreature: '⚖️',
    label: '同意・移植・倫理哲学'
  },
  'Science Reef':         {
    emoji: '🔬', color: '#26c6da',
    creatures: ['🦕','🌿','🔭','🦋','🐢'],
    corals: ['🌿','🦎','🍃','🌳'],
    bgCreature: '🔬',
    label: '進化・生態・気候・技術'
  },
  'Academic Deep':        {
    emoji: '📚', color: '#ffd54f',
    creatures: ['📚','✍️','🎓','💡','🔍'],
    corals: ['📜','🌿','⭐','🪸'],
    bgCreature: '📚',
    label: '論証・批判・哲学・研究語'
  },
};

// Memory tip templates for wrong answers
function buildMemoryTip(w) {
  const tips = [];
  if (w.etymology) {
    tips.push(`🔤 語源ヒント: ${w.etymology.split('；')[0]}`);
  }
  if (w.derivatives && w.derivatives.length) {
    tips.push(`🔗 関連語: ${w.derivatives.slice(0,2).join('、')}`);
  }
  if (w.example) {
    // Take first 60 chars of example as context
    const ex = w.example.length > 70 ? w.example.slice(0,70)+'...' : w.example;
    tips.push(`📖 例文: ${ex}`);
  }
  return tips;
}

const SHARK_CORRECT = [
  "Great Dive! 🦈", "Concept Found!", "Excellent!", "Ocean Brain Activated!",
  "That's the way! 🌊", "Splash! Perfect!", "Deep Knowledge!", "Surfing Smart!",
];
const SHARK_WRONG = [
  "Keep swimming! 🦈", "Almost there...", "Next wave~", "Don't give up!",
  "You'll get it! 💪", "Keep going!", "One more dive!",
];
const SHARK_HOME = [
  "Let's master medical vocab! 🏥", "Ready for today's session?",
  "512 words await! 🌊", "Dive deep into medical English!",
  "Your medical future starts here!", "Let's explore the deep!",
];

// Correct burst emojis by topic (Waseda Bunka edition)
const BURST_CORRECT = {
  'Medical Science':    ['🩺','✨','💊','💡'],
  'Public Health Sea':  ['🌍','✨','💉','🌿'],
  'Mind & Brain Bay':   ['🧠','✨','💭','💜'],
  'Bioethics Abyss':    ['⚖️','✨','📜','❤️'],
  'Science Reef':       ['🔬','✨','🦋','🌿'],
  'Academic Deep':      ['📚','✨','🎓','💡'],
};

// ============================================================
// PERSISTENCE
// ============================================================
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      progress: State.progress,
      sessions: State.sessions,
      weakWords: [...State.weakWords],
    }));
  } catch(e) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.progress) State.progress = data.progress;
    if (data.sessions) State.sessions = data.sessions;
    if (data.weakWords) State.weakWords = new Set(data.weakWords);
  } catch(e) {
    State.progress = {}; State.sessions = {}; State.weakWords = new Set();
  }
}

// ============================================================
// APP
// ============================================================
const App = {
  sessionWords: [],
  sessionMode: 'flashcard',
  sessionIndex: 0,
  sessionCorrect: 0,
  sessionSource: 'day',
  sessionTopic: null,
  sessionDay: null,
  quizTimer: null,
  advanceTimer: null,
  quizTimerLeft: 10,
  quizCurrentWord: null,
  quizAnswered: false,
  fcFlipped: false,
  pendingTopicFull: null, // topic string for modal

  async init() {
    loadState();
    try {
      const res = await fetch('vocabulary.json');
      State.vocab = await res.json();
    } catch(e) {
      console.error('Failed to load vocabulary.json', e);
      State.vocab = [];
    }
    this.spawnBubbles();
    this.spawnParticles();
    this.updateBackground(null);
    this.updateHeader();
    this.renderHome();
    this.renderTopics();
    this.renderReview();
    this.showScreen('screen-home');
  },

  // ---- SCREEN NAV ----
  showScreen(id) {
    this.stopSpeak(); // モード切替時に必ず停止
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) { el.classList.add('active'); State.currentScreen = id; }
    window.scrollTo(0,0);
  },

  // ---- BACKGROUND CREATURES ----
  updateBackground(topic) {
    const meta = topic ? TOPIC_META[topic] : null;

    // Gradient
    document.body.setAttribute('data-topic', topic || '');

    // Creatures
    const layer = document.getElementById('creatures-layer');
    if (layer) {
      layer.innerHTML = '';
      const creatures = meta ? meta.creatures : ['🐠','🐟','🐡','🦑','🐙'];
      const count = 5 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const c = document.createElement('div');
        c.className = 'creature' + (i === 0 ? ' large' : i > 3 ? ' small' : '');
        const emoji = creatures[i % creatures.length];
        c.textContent = emoji;
        const top = 8 + Math.random() * 75;
        const dur = 18 + Math.random() * 25;
        const delay = -Math.random() * dur;
        const dir = Math.random() > 0.5 ? 1 : -1;
        c.style.cssText = `
          top:${top}%;
          animation-duration:${dur}s;
          animation-delay:${delay}s;
          ${dir < 0 ? 'animation-direction:reverse;' : ''}
        `;
        layer.appendChild(c);
      }
    }

    // Corals
    const coral = document.getElementById('coral-layer');
    if (coral) {
      coral.innerHTML = '';
      const corals = meta ? meta.corals : ['🪸','🌿','🐚','🌊'];
      const positions = [5,15,25,40,55,68,78,88,95];
      positions.forEach((pos, i) => {
        const c = document.createElement('div');
        c.className = 'coral';
        c.textContent = corals[i % corals.length];
        const size = 24 + Math.random() * 20;
        const dur = 3 + Math.random() * 3;
        const delay = -Math.random() * dur;
        c.style.cssText = `
          left:${pos}%;
          font-size:${size}px;
          animation-duration:${dur}s;
          animation-delay:${delay}s;
        `;
        coral.appendChild(c);
      });
    }
  },

  spawnBubbles() {
    const container = document.getElementById('bubbles');
    if (!container) return;
    for (let i = 0; i < 20; i++) {
      const b = document.createElement('div');
      b.className = 'bubble';
      const size = 6 + Math.random() * 18;
      b.style.cssText = `
        width:${size}px; height:${size}px;
        left:${Math.random()*100}%;
        bottom:-${size}px;
        animation-duration:${10+Math.random()*15}s;
        animation-delay:-${Math.random()*25}s;
      `;
      container.appendChild(b);
    }
  },

  spawnParticles() {
    const container = document.getElementById('particles');
    if (!container) return;
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.cssText = `
        left:${Math.random()*100}%;
        animation-duration:${20+Math.random()*30}s;
        animation-delay:-${Math.random()*30}s;
        opacity:${0.2+Math.random()*0.4};
      `;
      container.appendChild(p);
    }
  },

  // ---- HEADER STATS ----
  updateHeader() {
    const seen = Object.values(State.progress).filter(p => p.seen).length;
    const mastered = Object.values(State.progress).filter(p => p.mastered).length;
    const weak = State.weakWords.size;
    const exploredPct = Math.round(seen / TOTAL * 100);
    this.setText('stat-explored', exploredPct + '%');
    this.setText('stat-mastered', mastered + '/' + TOTAL);
    this.setText('stat-weak', '⚑' + weak);
  },

  // ---- HOME ----
  renderHome() {
    const greet = document.getElementById('shark-greeting');
    if (greet) greet.textContent = SHARK_HOME[Math.floor(Math.random() * SHARK_HOME.length)];

    const dayScroll = document.getElementById('day-scroll');
    if (!dayScroll) return;
    dayScroll.innerHTML = '';
    const todayDay = this.getTodayDay();
    for (let d = 1; d <= 67; d++) {
      const pill = document.createElement('div');
      pill.className = 'day-pill';
      if (d === todayDay) pill.classList.add('today');
      else if (this.isDayClear(d)) pill.classList.add('clear');
      else if (this.isDayPartial(d)) pill.classList.add('partial');
      const status = d === todayDay ? '📍' : this.isDayClear(d) ? '✅' : '○';
      pill.innerHTML = `<span class="day-num">Day ${d}</span><span class="day-status">${status}</span>`;
      pill.onclick = () => this.startDaySession(d);
      dayScroll.appendChild(pill);
    }
    const todayEl = dayScroll.children[todayDay - 1];
    if (todayEl) setTimeout(() => todayEl.scrollIntoView({behavior:'smooth', inline:'center'}), 300);

    const mastered = Object.values(State.progress).filter(p => p.mastered).length;
    const pct = Math.round(mastered / TOTAL * 100);
    const bar = document.getElementById('total-progress-bar');
    const pctEl = document.getElementById('total-progress-pct');
    if (bar) bar.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
  },

  getTodayDay() {
    try {
      let firstDate = localStorage.getItem('mvm_start');
      if (!firstDate) {
        firstDate = new Date().toDateString();
        localStorage.setItem('mvm_start', firstDate);
      }
      const diff = Math.floor((new Date() - new Date(firstDate)) / 86400000);
      return Math.min(67, Math.max(1, diff + 1));
    } catch(e) { return 1; }
  },

  isDayClear(day) { const s = State.sessions[day]; return s && s.listening; },
  isDayPartial(day) { const s = State.sessions[day]; return s && (s.fc || s.quiz); },

  // ---- TOPICS ----
  renderTopics() {
    const grid = document.getElementById('topic-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const topics = [...new Set(State.vocab.map(v => v.topic))];
    topics.forEach(topic => {
      const words = State.vocab.filter(v => v.topic === topic);
      const seen = words.filter(w => State.progress[w.word]?.seen).length;
      const pct = words.length ? Math.round(seen / words.length * 100) : 0;
      const meta = TOPIC_META[topic] || { emoji: '🌊', color: '#29b6f6' };
      const card = document.createElement('div');
      card.className = 'topic-card';
      card.style.setProperty('--card-accent', meta.color + '33');
      card.innerHTML = `
        <div class="topic-emoji">${meta.bgCreature || meta.emoji}</div>
        <div class="topic-name">${topic}</div>
        <div class="topic-name-jp">${meta.label || (words[0]?.topicJp || '')}</div>
        <div class="topic-count">${words.length}語 / 達成${pct}%</div>
        <div class="topic-mini-bar"><div class="topic-mini-fill" style="width:${pct}%;background:${meta.color}"></div></div>
      `;
      card.onclick = () => this.openTopicModal(topic);
      grid.appendChild(card);
    });
  },

  // ---- TOPIC MODE MODAL ----
  openTopicModal(topic) {
    this.pendingTopicFull = topic;
    const meta = TOPIC_META[topic] || { emoji: '🌊', bgCreature: '🌊' };
    const words = State.vocab.filter(v => v.topic === topic);

    this.setText('modal-topic-name', topic);
    const creatureEl = document.getElementById('modal-creature');
    if (creatureEl) creatureEl.textContent = meta.bgCreature || meta.emoji;
    this.setText('modal-full-count', words.length + '語');
    this.setText('modal-step-count', SMALL_STEP_SIZE + '語');

    const btn1 = document.getElementById('modal-full-btn');
    const btn2 = document.getElementById('modal-step-btn');
    if (btn1) btn1.onclick = () => { this.closeTopicModal(); this.startTopicSession(topic, 'full'); };
    if (btn2) btn2.onclick = () => { this.closeTopicModal(); this.startTopicSession(topic, 'step'); };

    const modal = document.getElementById('topic-mode-modal');
    if (modal) modal.style.display = 'flex';
  },

  closeTopicModal() {
    const modal = document.getElementById('topic-mode-modal');
    if (modal) modal.style.display = 'none';
  },

  // ---- REVIEW ----
  renderReview() {
    const weakCount = document.getElementById('weak-count');
    if (weakCount) weakCount.textContent = State.weakWords.size + '語';
    const list = document.getElementById('topic-review-list');
    if (!list) return;
    list.innerHTML = '';
    const topics = [...new Set(State.vocab.map(v => v.topic))];
    topics.forEach(topic => {
      const words = State.vocab.filter(v => v.topic === topic);
      const meta = TOPIC_META[topic] || { emoji: '🌊' };
      const btn = document.createElement('button');
      btn.className = 'review-btn';
      btn.innerHTML = `
        <span class="r-icon">${meta.bgCreature || meta.emoji}</span>
        <span class="r-label">${topic}</span>
        <span class="r-count">${words.length}語</span>
      `;
      btn.onclick = () => this.openTopicModal(topic);
      list.appendChild(btn);
    });
  },

  // ---- SESSIONS ----
  startTodaySession() {
    const day = this.getTodayDay();
    this.startDaySession(day);
  },

  startDaySession(day) {
    const words = State.vocab.filter(v => v.day === day);
    if (!words.length) { this.showShark("今日の単語が見つかりません。"); return; }
    this.sessionSource = 'day';
    this.sessionDay = day;
    this.sessionWords = this.shuffleArr([...words]);
    this.sessionTopic = words[0]?.topic || null;
    this.sessionCorrect = 0;
    this.updateBackground(this.sessionTopic);
    this.startPhase('flashcard');
  },

  startTopicSession(topic, mode) {
    // mode: 'full' | 'step'
    const allWords = State.vocab.filter(v => v.topic === topic);
    let words;

    if (mode === 'step') {
      // Find unseen words first, then seen-but-not-mastered, then mastered
      const unseen = allWords.filter(w => !State.progress[w.word]?.seen);
      const seen = allWords.filter(w => State.progress[w.word]?.seen && !State.progress[w.word]?.mastered);
      const mastered = allWords.filter(w => State.progress[w.word]?.mastered);
      const pool = [...this.shuffleArr(unseen), ...this.shuffleArr(seen), ...this.shuffleArr(mastered)];
      words = pool.slice(0, SMALL_STEP_SIZE);
    } else {
      words = this.shuffleArr([...allWords]);
    }

    this.sessionSource = mode === 'step' ? 'topic-step' : 'topic';
    this.sessionTopic = topic;
    this.sessionWords = words;
    this.sessionCorrect = 0;
    this.updateBackground(topic);
    this.startPhase('flashcard');
  },

  startReview(mode) {
    let words = [];
    if (mode === 'weak') {
      words = State.vocab.filter(v => State.weakWords.has(v.word));
      if (!words.length) { this.showShark("Weak Wordsがありません！素晴らしい！🎉"); return; }
    } else if (mode === 'random') {
      words = this.shuffleArr([...State.vocab]);
    }
    this.sessionSource = mode;
    this.sessionWords = this.shuffleArr(words);
    this.sessionCorrect = 0;
    this.updateBackground(null);
    this.startPhase('quiz');
  },

  startPhase(phase) {
    this.sessionMode = phase;
    this.sessionIndex = 0;

    if (phase === 'flashcard') {
      this.setupFlashcard();
      this.showScreen('screen-flashcard');
    } else if (phase === 'quiz') {
      this.sessionCorrect = 0; // クイズフェーズ開始時にリセット
      this.setupQuiz();
      this.showScreen('screen-quiz');
    } else if (phase === 'listening') {
      this.sessionMode = 'listening';
      this.sessionCorrect = 0;
      // リスニングへの切替後150ms余分に待機（音声初期化待ち）
      setTimeout(() => {
        this.setupQuiz();
        this.showScreen('screen-quiz');
      }, 150);
    }
  },

  // ---- FLASHCARD ----
  setupFlashcard() {
    const backBtn = document.getElementById('fc-back-btn');
    if (backBtn) backBtn.onclick = () => { this.clearQuizTimer(); this.showScreen('screen-home'); };
    this.renderFlashcard();
  },

  renderFlashcard() {
    const w = this.sessionWords[this.sessionIndex];
    if (!w) { this.advancePhase(); return; }

    if (!State.progress[w.word]) State.progress[w.word] = { seen: false, correct: 0, wrong: 0, mastered: false };
    State.progress[w.word].seen = true;
    saveState();
    this.updateHeader();

    const fc = document.getElementById('flashcard');
    if (fc) fc.classList.remove('flipped');
    this.fcFlipped = false;

    this.setText('card-pos', w.pos);
    this.setText('card-word', w.word);
    this.setText('card-meaning', w.meaning);
    this.setText('card-example', '📖 ' + w.example);
    this.setText('card-translation', '　' + w.translation);
    this.setText('card-etymology', w.etymology ? '🔤 ' + w.etymology : '');
    const deriv = w.derivatives && w.derivatives.length ? '🔗 ' + w.derivatives.join('  /  ') : '';
    this.setText('card-derivatives', deriv);
    this.setText('fc-progress', `${this.sessionIndex + 1} / ${this.sessionWords.length}`);
    this.setText('fc-topic-label', w.topic);
  },

  flipCard() {
    const fc = document.getElementById('flashcard');
    if (!fc) return;
    this.fcFlipped = !this.fcFlipped;
    fc.classList.toggle('flipped', this.fcFlipped);
  },

  fcNext() {
    if (this.sessionIndex < this.sessionWords.length - 1) {
      this.sessionIndex++;
      this.renderFlashcard();
    } else {
      this.advancePhase();
    }
  },

  fcPrev() {
    if (this.sessionIndex > 0) {
      this.sessionIndex--;
      this.renderFlashcard();
    }
  },

  fcKnew() {
    const w = this.sessionWords[this.sessionIndex];
    if (w) {
      if (!State.progress[w.word]) State.progress[w.word] = { seen: true, correct: 0, wrong: 0, mastered: false };
      State.progress[w.word].correct++;
      State.weakWords.delete(w.word);
      saveState();
    }
    this.fcNext();
  },

  fcSkip() { this.fcNext(); },

  // ---- PHASE ADVANCEMENT ----
  advancePhase() {
    if (this.sessionMode === 'flashcard') {
      // FC完了を記録（dayセッションのみ）
      if (this.sessionSource === 'day' && this.sessionDay) {
        if (!State.sessions[this.sessionDay]) State.sessions[this.sessionDay] = {};
        State.sessions[this.sessionDay].fc = true;
        saveState();
      }
      this.sessionWords = this.shuffleArr([...this.sessionWords]); // クイズ用に再シャッフル
      this.sessionIndex = 0;
      this.startPhase('quiz');

    } else if (this.sessionMode === 'quiz') {
      // Quiz完了を記録（dayセッションのみ）
      if (this.sessionSource === 'day' && this.sessionDay) {
        if (!State.sessions[this.sessionDay]) State.sessions[this.sessionDay] = {};
        State.sessions[this.sessionDay].quiz = true;
        saveState();
      }
      // topic系はクイズで終了、dayセッションのみlisteningへ
      if (this.sessionSource === 'day') {
        this.sessionWords = this.shuffleArr([...this.sessionWords]); // リスニング用に再シャッフル
        this.sessionIndex = 0;
        this.startPhase('listening');
      } else {
        this.showResults();
      }

    } else {
      // Listening完了（dayセッションのみここに到達）
      if (this.sessionSource === 'day' && this.sessionDay) {
        if (!State.sessions[this.sessionDay]) State.sessions[this.sessionDay] = {};
        State.sessions[this.sessionDay].listening = true;
        saveState();
      }
      this.showResults();
    }
  },

  // ---- QUIZ ----
  setupQuiz() {
    const backBtn = document.getElementById('quiz-back-btn');
    if (backBtn) backBtn.onclick = () => { this.clearQuizTimer(); this.showScreen('screen-home'); };
    const modeLabel = document.getElementById('quiz-mode-label');
    if (modeLabel) modeLabel.textContent = this.sessionMode === 'listening' ? '🔊 Listening' : '英→日';
    const listenBtn = document.getElementById('quiz-listen-btn');
    if (listenBtn) listenBtn.style.display = this.sessionMode === 'listening' ? 'flex' : 'none';
    this.renderQuiz();
  },

  renderQuiz() {
    this.clearQuizTimer();
    if (this.advanceTimer) { clearTimeout(this.advanceTimer); this.advanceTimer = null; }
    const feedback = document.getElementById('quiz-feedback');
    if (feedback) feedback.style.display = 'none';

    const w = this.sessionWords[this.sessionIndex];
    if (!w) { this.advancePhase(); return; }
    this.quizCurrentWord = w;
    this.quizAnswered = false;

    this.setText('quiz-word', this.sessionMode === 'listening' ? '🔊 ??　??' : w.word);
    this.setText('quiz-progress', `${this.sessionIndex + 1}/${this.sessionWords.length}`);

    const correct = w.meaning;
    const distractors = this.getDistractors(w, 3);
    const all = this.shuffleArr([correct, ...distractors]);
    this.quizChoices = all;

    const choicesEl = document.getElementById('quiz-choices');
    if (!choicesEl) return;
    choicesEl.innerHTML = '';
    all.forEach((choice, i) => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.innerHTML = `<span class="choice-num">${i+1}</span><span>${choice}</span>`;
      btn.onclick = () => this.selectChoice(choice, btn);
      choicesEl.appendChild(btn);
    });

    this.quizTimerLeft = 10;
    this.updateTimerUI(10);
    this.quizTimer = setInterval(() => {
      this.quizTimerLeft--;
      this.updateTimerUI(this.quizTimerLeft);
      if (this.quizTimerLeft <= 0) {
        this.clearQuizTimer();
        if (!this.quizAnswered) this.selectChoice(null, null);
      }
    }, 1000);

    // リスニングモード: 全問ここで音声再生
    if (this.sessionMode === 'listening') {
      setTimeout(() => this.speak(w.word), 300);
    }
  },

  updateTimerUI(t) {
    const bar = document.getElementById('quiz-timer-bar');
    const text = document.getElementById('quiz-timer-text');
    if (bar) bar.style.setProperty('--timer-pct', (t / 10 * 100) + '%');
    if (text) text.textContent = t;
  },

  clearQuizTimer() {
    if (this.quizTimer) { clearInterval(this.quizTimer); this.quizTimer = null; }
  },

  selectChoice(choice, btn) {
    if (this.quizAnswered) return;
    this.quizAnswered = true;
    this.clearQuizTimer();
    const w = this.quizCurrentWord;
    const correct = w.meaning;
    const isCorrect = choice === correct;

    if (!State.progress[w.word]) State.progress[w.word] = { seen: true, correct: 0, wrong: 0, mastered: false };
    if (isCorrect) {
      State.progress[w.word].correct++;
      State.weakWords.delete(w.word);
      if (State.progress[w.word].correct >= 3) State.progress[w.word].mastered = true;
      this.sessionCorrect++;
      this.playCorrectEffect(w.topic);
    } else {
      State.progress[w.word].wrong++;
      State.weakWords.add(w.word);
    }
    saveState();
    this.updateHeader();

    if (this.sessionMode === 'listening') {
      const qw = document.getElementById('quiz-word');
      if (qw) qw.textContent = w.word;
    }

    document.querySelectorAll('.choice-btn').forEach(b => {
      b.classList.add('disabled');
      const txt = b.querySelector('span:last-child')?.textContent;
      if (txt === correct) b.classList.add('correct');
      else if (b === btn) b.classList.add('wrong');
    });

    // Feedback panel
    const feedback = document.getElementById('quiz-feedback');
    const icon = document.getElementById('feedback-icon');
    const msg = document.getElementById('feedback-msg');
    const correctEl = document.getElementById('feedback-correct');
    const hintEl = document.getElementById('feedback-hint');
    const etymEl = document.getElementById('hint-etymology');
    const derivEl = document.getElementById('hint-derivatives');
    const exEl = document.getElementById('hint-example');

    if (feedback) feedback.style.display = 'block';
    if (icon) icon.textContent = isCorrect ? '🎉' : '😅';
    if (msg) msg.textContent = isCorrect
      ? SHARK_CORRECT[Math.floor(Math.random() * SHARK_CORRECT.length)]
      : SHARK_WRONG[Math.floor(Math.random() * SHARK_WRONG.length)];

    if (correctEl) correctEl.textContent = isCorrect ? '' : `正解: ${correct}`;

    // Memory hint for wrong answers
    if (!isCorrect && hintEl && etymEl && derivEl && exEl) {
      hintEl.style.display = 'block';
      // Etymology
      if (w.etymology) {
        etymEl.textContent = '🔤 語源ヒント: ' + w.etymology.split('；')[0];
        etymEl.style.display = 'block';
      } else {
        etymEl.style.display = 'none';
      }
      // Derivatives
      if (w.derivatives && w.derivatives.length) {
        derivEl.textContent = '🔗 関連語: ' + w.derivatives.slice(0,3).join('  /  ');
        derivEl.style.display = 'block';
      } else {
        derivEl.style.display = 'none';
      }
      // Example sentence (short)
      if (w.example) {
        const ex = w.example.length > 75 ? w.example.slice(0,75) + '…' : w.example;
        exEl.textContent = '📖 ' + ex;
        exEl.style.display = 'block';
      } else {
        exEl.style.display = 'none';
      }
    } else if (hintEl) {
      hintEl.style.display = 'none';
    }

    // Auto advance after longer delay if wrong (to read hint)
    this.advanceTimer = setTimeout(() => this.nextQuiz(), isCorrect ? 2000 : 3500);
  },

  nextQuiz() {
    // 二重呼び出し防止
    if (this.advanceTimer) { clearTimeout(this.advanceTimer); this.advanceTimer = null; }
    if (this.sessionIndex < this.sessionWords.length - 1) {
      this.sessionIndex++;
      this.renderQuiz();
    } else {
      this.advancePhase();
    }
  },

  getDistractors(word, count) {
    let pool = State.vocab.filter(v =>
      v.word !== word.word &&
      v.meaning !== word.meaning &&
      !this.meaningsAreSimilar(v.meaning, word.meaning)
    );
    pool = this.shuffleArr(pool);
    return pool.slice(0, count).map(v => v.meaning);
  },

  meaningsAreSimilar(a, b) {
    const ka = a.replace(/[；・]/g, '').slice(0, 4);
    const kb = b.replace(/[；・]/g, '').slice(0, 4);
    return ka === kb;
  },

  playCurrentWord() {
    if (this.quizCurrentWord) this.speak(this.quizCurrentWord.word);
  },

  _spkTimer: null,
  _kaTimer: null,

  speak(text) {
    if (!text || !window.speechSynthesis) return;
    // ① 前の発話を確実にキャンセル
    window.speechSynthesis.cancel();
    clearTimeout(this._spkTimer);
    clearInterval(this._kaTimer);
    // ② 80ms待機後に発話（Chromiumバグ対策）
    this._spkTimer = setTimeout(() => {
      try {
        const utt = new SpeechSynthesisUtterance(text);
        utt.lang = 'en-US'; utt.rate = 0.85; utt.pitch = 1; utt.volume = 1;
        utt.onend = () => clearInterval(this._kaTimer);
        utt.onerror = (e) => { if (e.error !== 'interrupted') clearInterval(this._kaTimer); };
        window.speechSynthesis.speak(utt);
        // ③ Chrome 14秒バグ対策
        this._kaTimer = setInterval(() => {
          if (window.speechSynthesis.speaking) {
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
          } else { clearInterval(this._kaTimer); }
        }, 10000);
      } catch(e) {}
    }, 80);
  },

  stopSpeak() {
    window.speechSynthesis.cancel();
    clearTimeout(this._spkTimer);
    clearInterval(this._kaTimer);
  },

  // ---- CORRECT EFFECT (new!) ----
  playCorrectEffect(topic) {
    // 1. Burst emoji overlay
    const burst = document.getElementById('correct-burst');
    const content = document.getElementById('burst-content');
    if (burst && content) {
      const burstEmojis = BURST_CORRECT[topic] || ['✨','⭐','💫','🌟'];
      content.textContent = burstEmojis[Math.floor(Math.random() * burstEmojis.length)];
      burst.style.display = 'flex';
      setTimeout(() => { burst.style.display = 'none'; }, 650);
    }

    // 2. Marine confetti instead of plain sparks
    this.playMarineConfetti(topic);

    // 3. Sound chime
    this.playChime();
  },

  playMarineConfetti(topic) {
    const container = document.getElementById('celebration');
    if (!container) return;
    const meta = TOPIC_META[topic];
    const emojis = meta ? meta.creatures : ['🐠','🌊','⭐','🐟','✨'];
    const colors = ['#ffd54f','#29b6f6','#4dd0e1','#ff6b6b','#81c784','#ce93d8'];

    // Colored sparks
    for (let i = 0; i < 16; i++) {
      const spark = document.createElement('div');
      spark.className = 'spark';
      const x = 20 + Math.random() * 60;
      const dy = -(80 + Math.random() * 220);
      const dx = -100 + Math.random() * 200;
      spark.style.cssText = `
        left:${x}%; top:55%;
        background:${colors[Math.floor(Math.random()*colors.length)]};
        --dx:${dx}px; --dy:${dy}px;
        animation-duration:${0.7 + Math.random()*0.6}s;
        animation-delay:${Math.random()*0.2}s;
        width:${4+Math.random()*8}px; height:${4+Math.random()*8}px;
        border-radius:${Math.random()>0.5?'50%':'2px'};
      `;
      container.appendChild(spark);
      spark.addEventListener('animationend', () => spark.remove());
    }

    // Fish/creature emojis floating up
    for (let i = 0; i < 6; i++) {
      const fish = document.createElement('div');
      fish.className = 'fish-confetti';
      fish.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      const x = 10 + Math.random() * 80;
      const dy = -(120 + Math.random() * 200);
      const dx = -60 + Math.random() * 120;
      const dr = -180 + Math.random() * 360;
      fish.style.cssText = `
        left:${x}%; top:60%;
        --dx:${dx}px; --dy:${dy}px; --dr:${dr}deg;
        animation-duration:${1.0 + Math.random()*0.6}s;
        animation-delay:${Math.random()*0.3}s;
        font-size:${18+Math.random()*14}px;
      `;
      container.appendChild(fish);
      fish.addEventListener('animationend', () => fish.remove());
    }
  },

  playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523, 659, 784, 1047];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.12, ctx.currentTime + i*0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i*0.08 + 0.35);
        osc.start(ctx.currentTime + i*0.08);
        osc.stop(ctx.currentTime + i*0.08 + 0.4);
      });
    } catch(e) {}
  },

  // ---- RESULTS ----
  showResults() {
    const total = this.sessionWords.length;
    const correct = this.sessionCorrect;
    const pct = total ? Math.round(correct / total * 100) : 0;

    this.setText('results-score', `${correct} / ${total}`);
    this.setText('results-title', pct >= 80 ? 'Excellent Dive! 🌊' : pct >= 50 ? 'Good Progress!' : 'Keep Swimming!');

    const comments = pct >= 90 ? "Perfect! You're a vocabulary shark! 🦈"
      : pct >= 70 ? "Great work! The ocean is yours! 🌊"
      : pct >= 50 ? "Keep diving deeper! 💪"
      : "Every mistake makes you stronger! 🦈";
    this.setText('results-comment', comments);

    // フェーズ名ラベル
    const phaseLabel = this.sessionMode === 'listening' ? 'リスニング'
      : this.sessionMode === 'quiz' ? 'クイズ' : '';

    const statsEl = document.getElementById('results-stats');
    if (statsEl) {
      const mastered = Object.values(State.progress).filter(p => p.mastered).length;
      const weak = State.weakWords.size;
      statsEl.innerHTML = `
        <div class="r-stat"><div class="r-stat-num">${pct}%</div><div class="r-stat-label">${phaseLabel}正答率</div></div>
        <div class="r-stat"><div class="r-stat-num">${correct}/${total}</div><div class="r-stat-label">${phaseLabel}正解数</div></div>
        <div class="r-stat"><div class="r-stat-num">${mastered}</div><div class="r-stat-label">習得済み</div></div>
        <div class="r-stat"><div class="r-stat-num">${weak}</div><div class="r-stat-label">Weak Words</div></div>
      `;
    }

    if (pct >= 80) this.playMarineConfetti(this.sessionTopic);
    this.renderHome();
    this.renderTopics();
    this.renderReview();
    this.showScreen('screen-results');
  },

  goHome() { this.showScreen('screen-home'); },

  retryWeak() {
    if (!State.weakWords.size) { this.showShark("Weak Wordsがありません！ 🎉"); return; }
    this.showScreen('screen-review');
    this.startReview('weak');
  },

  // ---- SHARK OVERLAY ----
  showShark(msg) {
    const overlay = document.getElementById('shark-overlay');
    const msgEl = document.getElementById('shark-overlay-msg');
    if (!overlay || !msgEl) return;
    msgEl.textContent = msg;
    overlay.style.display = 'flex';
  },

  closeShark() {
    const overlay = document.getElementById('shark-overlay');
    if (overlay) overlay.style.display = 'none';
  },

  // ---- UTILITIES ----
  shuffleArr(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text || '';
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
// タブ非表示時に音声停止
document.addEventListener('visibilitychange', () => {
  if (document.hidden && App.stopSpeak) App.stopSpeak();
});
