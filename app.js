// ---------- State ----------
const LS_LEARNED = "vocabmaster_learned";
const LS_FAVORITES = "vocabmaster_favorites";
const LS_THEME = "vocabmaster_theme";

let activeGroup = "all";
let searchTerm = "";
let showFavOnly = false;
let showImpOnly = false;
let showDoneOnly = false;
let learned = new Set(JSON.parse(localStorage.getItem(LS_LEARNED) || "[]"));
let favorites = new Set(JSON.parse(localStorage.getItem(LS_FAVORITES) || "[]"));

const grid = document.getElementById("cardGrid");
const groupTabsEl = document.getElementById("groupTabs");
const emptyState = document.getElementById("emptyState");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const searchInput = document.getElementById("searchInput");

// ---------- Animation helper ----------
function replayAnimation(el, className) {
  el.classList.remove(className);
  void el.offsetWidth; // force reflow so the animation restarts
  el.classList.add(className);
}

// ---------- Speech helpers ----------
function speak(text, rate = 0.9) {
  if (!("speechSynthesis" in window)) {
    alert("Speech synthesis is not supported in this browser.");
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  utter.rate = rate;
  window.speechSynthesis.speak(utter);
}

function levenshtein(a, b) {
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  const dist = levenshtein(a, b);
  const longer = Math.max(a.length, b.length) || 1;
  return 1 - dist / longer;
}

// ---------- Image helper (Twemoji — real colorful images, not just font glyphs) ----------
function emojiToTwemojiUrl(emoji) {
  const codePoints = Array.from(emoji)
    .map(c => c.codePointAt(0).toString(16))
    .filter(cp => cp !== "fe0f"); // drop variation selector, twemoji filenames omit it
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${codePoints.join("-")}.png`;
}

// ---------- Speech recognition (mic) ----------
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
if (SpeechRecognitionCtor) {
  recognizer = new SpeechRecognitionCtor();
  recognizer.lang = "en-US";
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 3;
}

// ---------- Rendering ----------
function renderGroupTabs() {
  const counts = { all: VOCAB.length };
  VOCAB_GROUPS.forEach(g => (counts[g.id] = VOCAB.filter(v => v.g === g.id).length));

  const tabs = [{ id: "all", name: "All words", icon: "📚" }, ...VOCAB_GROUPS];
  groupTabsEl.innerHTML = tabs
    .map(
      g => `<button class="group-tab ${g.id === activeGroup ? "active" : ""}" data-group="${g.id}">
        ${g.icon} ${g.name} <span style="opacity:.6">(${counts[g.id]})</span>
      </button>`
    )
    .join("");

  groupTabsEl.querySelectorAll(".group-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      activeGroup = btn.dataset.group;
      renderGroupTabs();
      renderCards();
    });
  });
}

function filteredVocab() {
  return VOCAB.filter(v => {
    const groupMatch = activeGroup === "all" || v.g === activeGroup;
    if (!groupMatch) return false;
    if (showFavOnly && !favorites.has(v.w)) return false;
    if (showImpOnly && v.imp !== 3) return false;
    if (showDoneOnly && !learned.has(v.w)) return false;
    if (!searchTerm) return true;
    const hay = [v.w, v.meaning, v.bn, ...(v.syn || []), ...(v.ant || [])].join(" ").toLowerCase();
    return hay.includes(searchTerm);
  });
}

function renderProgress() {
  const total = VOCAB.length;
  const done = VOCAB.filter(v => learned.has(v.w)).length;
  progressFill.style.width = total ? `${(done / total) * 100}%` : "0%";
  progressLabel.textContent = `${done} / ${total} learned`;
}

const IMP_LABEL = { 3: "🔥 High priority", 2: "⭐ Medium priority", 1: "· Low priority" };

function cardTemplate(v) {
  const isLearned = learned.has(v.w);
  const isFav = favorites.has(v.w);
  const synChips = (v.syn || []).map(s => `<span class="chip">${s}</span>`).join("");
  const antChips = (v.ant || []).map(s => `<span class="chip">${s}</span>`).join("");
  const imgUrl = v.img ? v.img : emojiToTwemojiUrl(v.emoji);
  const fallbackDisplay = v.emoji || v.w.charAt(0).toUpperCase();
  const groupInfo = VOCAB_GROUPS.find(g => g.id === v.g);
  return `
    <div class="vocab-card" data-word="${v.w}">
      <div class="card-inner">
        <div class="card-face card-front">
          <div class="card-top-row">
            <div class="card-image-wrap ${v.img ? "card-image-wrap--photo" : ""}" data-action="zoom" title="Tap to enlarge">
              <img class="card-image" src="${imgUrl}" alt="${v.w}" loading="lazy"
                   onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
              <span class="card-emoji-fallback">${fallbackDisplay}</span>
            </div>
            <div class="card-top-actions">
              <button class="fav-btn ${isFav ? "favorited" : ""}" data-action="fav" title="Add to favorites">${isFav ? "❤️" : "🤍"}</button>
              <button class="star-btn ${isLearned ? "learned" : ""}" data-action="learn" title="Mark as learned">${isLearned ? "★" : "☆"}</button>
            </div>
          </div>
          <p class="card-word">${v.w}</p>
          <p class="card-ipa">${v.ipa}</p>
          <p class="card-bn">${v.bn || ""}</p>
          <div class="card-pos-row">
            <span class="card-pos">${v.pos}</span>
            <span class="imp-badge imp-${v.imp}">${IMP_LABEL[v.imp]}</span>
          </div>
          <div class="card-actions">
            <button class="mini-btn" data-action="speak" title="Hear pronunciation">🔊 Say it</button>
            <button class="mini-btn" data-action="practice" title="Practice pronunciation">🎤 Practice</button>
          </div>
          <p class="card-hint">tap card to flip</p>
        </div>
        <div class="card-face card-back">
          <p class="chip-label">Meaning</p>
          <p class="back-meaning">${v.meaning}</p>
          <p class="back-bn">${v.bn || ""}</p>
          <p class="chip-label">Example</p>
          <p class="back-sentence">&ldquo;${v.sentence}&rdquo;</p>
          <p class="chip-label">Memory trick</p>
          <p class="mnemonic-box">🧠 ${v.mnemonic || "—"}</p>
          <p class="chip-label">Synonyms</p>
          <div class="chip-row">${synChips || "<span class='chip'>—</span>"}</div>
          <p class="chip-label">Antonyms</p>
          <div class="chip-row">${antChips || "<span class='chip'>—</span>"}</div>
          <p class="chip-label">Reference</p>
          <p class="ref-line">📖 ${groupInfo ? groupInfo.examRef : ""}</p>
        </div>
      </div>
    </div>`;
}

function renderCards() {
  const list = filteredVocab();
  emptyState.classList.toggle("hidden", list.length > 0);
  grid.innerHTML = list.map(cardTemplate).join("");
  renderProgress();

  grid.querySelectorAll(".vocab-card").forEach(cardEl => {
    const word = cardEl.dataset.word;
    const vocabItem = VOCAB.find(v => v.w === word);

    cardEl.addEventListener("click", e => {
      if (e.target.closest("[data-action]")) return;
      cardEl.classList.toggle("flipped");
    });

    cardEl.querySelector('[data-action="zoom"]').addEventListener("click", e => {
      e.stopPropagation();
      openLightbox(vocabItem);
    });

    cardEl.querySelector('[data-action="speak"]').addEventListener("click", e => {
      e.stopPropagation();
      speak(vocabItem.w);
    });

    cardEl.querySelector('[data-action="practice"]').addEventListener("click", e => {
      e.stopPropagation();
      openPronModal(vocabItem);
    });

    cardEl.querySelector('[data-action="learn"]').addEventListener("click", e => {
      e.stopPropagation();
      if (learned.has(word)) learned.delete(word);
      else learned.add(word);
      localStorage.setItem(LS_LEARNED, JSON.stringify([...learned]));
      renderCards();
    });

    cardEl.querySelector('[data-action="fav"]').addEventListener("click", e => {
      e.stopPropagation();
      if (favorites.has(word)) favorites.delete(word);
      else favorites.add(word);
      localStorage.setItem(LS_FAVORITES, JSON.stringify([...favorites]));
      renderCards();
    });
  });
}

// ---------- Search ----------
searchInput.addEventListener("input", () => {
  searchTerm = searchInput.value.trim().toLowerCase();
  renderCards();
});

// ---------- Favorites / Most Important / Done filter toggles (mutually exclusive) ----------
const favToggle = document.getElementById("favToggle");
const impToggle = document.getElementById("impToggle");
const doneToggle = document.getElementById("doneToggle");

function setExclusiveFilter(which) {
  showFavOnly = which === "fav" ? !showFavOnly : false;
  showImpOnly = which === "imp" ? !showImpOnly : false;
  showDoneOnly = which === "done" ? !showDoneOnly : false;
  favToggle.dataset.active = String(showFavOnly);
  impToggle.dataset.active = String(showImpOnly);
  doneToggle.dataset.active = String(showDoneOnly);
  favToggle.textContent = showFavOnly ? "❤️ Favorites" : "🤍 Favorites";
  renderCards();
}

favToggle.addEventListener("click", () => setExclusiveFilter("fav"));
impToggle.addEventListener("click", () => setExclusiveFilter("imp"));
doneToggle.addEventListener("click", () => setExclusiveFilter("done"));

// ---------- Theme ----------
const themeToggle = document.getElementById("themeToggle");
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
  localStorage.setItem(LS_THEME, theme);
}
const savedTheme = localStorage.getItem(LS_THEME) ||
  (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
applyTheme(savedTheme);
themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

// ---------- Pronunciation practice modal ----------
const pronModal = document.getElementById("pronModal");
const pronWordEl = document.getElementById("pronWord");
const pronBnEl = document.getElementById("pronBn");
const pronHeard = document.getElementById("pronHeard");
const pronResult = document.getElementById("pronResult");
let currentPronItem = null;

function openPronModal(item) {
  currentPronItem = item;
  pronWordEl.textContent = item.w;
  pronBnEl.textContent = item.bn || "";
  pronHeard.textContent = "";
  pronResult.textContent = "";
  pronModal.classList.remove("hidden");
}
document.getElementById("pronClose").addEventListener("click", () => pronModal.classList.add("hidden"));
document.getElementById("pronListenModel").addEventListener("click", () => speak(currentPronItem.w, 0.8));

document.getElementById("pronRecord").addEventListener("click", function () {
  if (!recognizer) {
    pronResult.textContent = "Speech recognition isn't supported in this browser. Try Chrome.";
    return;
  }
  this.textContent = "🎙️ Listening...";
  pronHeard.textContent = "";
  pronResult.textContent = "";
  recognizer.start();

  recognizer.onresult = ev => {
    const alternatives = Array.from(ev.results[0]).map(r => r.transcript);
    const best = alternatives.reduce((bestAlt, alt) => {
      const score = similarity(alt, currentPronItem.w);
      return score > bestAlt.score ? { text: alt, score } : bestAlt;
    }, { text: alternatives[0], score: -1 });

    pronHeard.textContent = `Heard: "${best.text}"`;
    if (best.score >= 0.8) {
      pronResult.textContent = "✅ Great pronunciation!";
      pronResult.style.color = "var(--accent-2)";
      replayAnimation(pronResult, "feedback-bounce");
      learned.add(currentPronItem.w);
      localStorage.setItem(LS_LEARNED, JSON.stringify([...learned]));
      renderCards();
    } else if (best.score >= 0.5) {
      pronResult.textContent = "🙂 Close! Try again, listen closely.";
      pronResult.style.color = "#f5b301";
      replayAnimation(pronResult, "feedback-bounce");
    } else {
      pronResult.textContent = "❌ Not quite. Tap 'Hear correct pronunciation' and retry.";
      pronResult.style.color = "var(--danger)";
      replayAnimation(pronResult, "feedback-shake");
    }
  };
  recognizer.onerror = ev => {
    pronResult.textContent = `Mic error: ${ev.error}. Check microphone permission.`;
  };
  recognizer.onend = () => {
    this.textContent = "🎙️ Tap and say the word";
  };
});

// ---------- Quiz mode ----------
const quizModal = document.getElementById("quizModal");
const quizPlay = document.getElementById("quizPlay");
const quizInput = document.getElementById("quizInput");
const quizFeedback = document.getElementById("quizFeedback");
const quizScoreEl = document.getElementById("quizScore");
let quizWord = null;
let quizScore = { correct: 0, total: 0 };

function pickQuizWord() {
  const pool = filteredVocab().length ? filteredVocab() : VOCAB;
  quizWord = pool[Math.floor(Math.random() * pool.length)];
  quizInput.value = "";
  quizFeedback.textContent = "";
}

document.getElementById("quizBtn").addEventListener("click", () => {
  pickQuizWord();
  quizModal.classList.remove("hidden");
});
document.getElementById("quizClose").addEventListener("click", () => quizModal.classList.add("hidden"));
quizPlay.addEventListener("click", () => speak(quizWord.w, 0.85));
document.getElementById("quizNext").addEventListener("click", pickQuizWord);

document.getElementById("quizSubmit").addEventListener("click", checkQuizAnswer);
quizInput.addEventListener("keydown", e => {
  if (e.key === "Enter") checkQuizAnswer();
});

function checkQuizAnswer() {
  if (!quizWord) return;
  quizScore.total++;
  const correct = quizInput.value.trim().toLowerCase() === quizWord.w.toLowerCase();
  if (correct) {
    quizScore.correct++;
    quizFeedback.textContent = `✅ Correct — "${quizWord.w}" (${quizWord.bn} — ${quizWord.meaning})`;
    quizFeedback.style.color = "var(--accent-2)";
    replayAnimation(quizFeedback, "feedback-bounce");
  } else {
    quizFeedback.textContent = `❌ It was "${quizWord.w}" (${quizWord.bn}) — ${quizWord.meaning}`;
    quizFeedback.style.color = "var(--danger)";
    replayAnimation(quizFeedback, "feedback-shake");
  }
  quizScoreEl.textContent = `Score: ${quizScore.correct} / ${quizScore.total}`;
}

// ---------- Daily Challenge (gamification) ----------
const LS_DAILY_TARGET = "vocabmaster_daily_target";
const LS_DAILY_STATE = "vocabmaster_daily_state";
const LS_UNSEEN_POOL = "vocabmaster_unseen_pool";
const LS_PRACTICED_ALL = "vocabmaster_practiced_all";
const LS_STREAK = "vocabmaster_streak";
const MIN_EXAM_WORDS = 5;
const EXAM_LEN = 10;
const LS_EXAM_STATS = "vocabmaster_exam_stats";

let dailyTarget = parseInt(localStorage.getItem(LS_DAILY_TARGET) || "0", 10);
let dailyState = JSON.parse(localStorage.getItem(LS_DAILY_STATE) || "null");
let unseenPool = JSON.parse(localStorage.getItem(LS_UNSEEN_POOL) || "null");
let practicedAll = new Set(JSON.parse(localStorage.getItem(LS_PRACTICED_ALL) || "[]"));
let streakData = JSON.parse(localStorage.getItem(LS_STREAK) || '{"count":0,"lastCompletedDate":null}');
let examStats = JSON.parse(localStorage.getItem(LS_EXAM_STATS) || '{"examsTaken":0,"totalCorrect":0,"totalQuestions":0,"bestPct":0,"history":[]}');
function saveExamStats() { localStorage.setItem(LS_EXAM_STATS, JSON.stringify(examStats)); }

function pad2(n) { return String(n).padStart(2, "0"); }
function dateToStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function getTodayStr() { return dateToStr(new Date()); }
function getYesterdayStr(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return dateToStr(d);
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function saveDailyState() { localStorage.setItem(LS_DAILY_STATE, JSON.stringify(dailyState)); }
function saveUnseenPool() { localStorage.setItem(LS_UNSEEN_POOL, JSON.stringify(unseenPool)); }
function savePracticedAll() { localStorage.setItem(LS_PRACTICED_ALL, JSON.stringify([...practicedAll])); }
function saveStreak() { localStorage.setItem(LS_STREAK, JSON.stringify(streakData)); }

function generateDailyWords(target) {
  if (!unseenPool || unseenPool.length === 0) unseenPool = shuffle(VOCAB.map(v => v.w));
  if (unseenPool.length < target) unseenPool = shuffle(VOCAB.map(v => v.w));
  const picked = unseenPool.slice(0, target);
  unseenPool = unseenPool.slice(target);
  saveUnseenPool();
  return picked;
}

function ensureDailyState() {
  const today = getTodayStr();
  if (dailyState && dailyState.date === today) return dailyState;
  const words = generateDailyWords(dailyTarget);
  dailyState = { date: today, target: dailyTarget, words, practiced: [] };
  saveDailyState();
  return dailyState;
}

function maybeUpdateStreakOnComplete() {
  if (dailyState.practiced.length !== dailyState.words.length || dailyState.words.length === 0) return;
  if (streakData.lastCompletedDate === dailyState.date) return;
  const yesterday = getYesterdayStr(dailyState.date);
  streakData.count = streakData.lastCompletedDate === yesterday ? streakData.count + 1 : 1;
  streakData.lastCompletedDate = dailyState.date;
  saveStreak();
}

const dailyBtn = document.getElementById("dailyBtn");
const dailyModal = document.getElementById("dailyModal");
const dailyClose = document.getElementById("dailyClose");
const dailySetupEl = document.getElementById("dailySetup");
const dailyActiveEl = document.getElementById("dailyActive");
const dailyTargetInput = document.getElementById("dailyTargetInput");
const dailyStartBtn = document.getElementById("dailyStartBtn");
const streakBadge = document.getElementById("streakBadge");
const dailyProgressLabel = document.getElementById("dailyProgressLabel");
const dailyWordListEl = document.getElementById("dailyWordList");
const dailyChangeTarget = document.getElementById("dailyChangeTarget");
const startExamBtn = document.getElementById("startExamBtn");
const examHint = document.getElementById("examHint");

function dailyWordItemHtml(word) {
  const v = VOCAB.find(x => x.w === word);
  const done = dailyState.practiced.includes(word);
  return `<div class="daily-word-item ${done ? "done" : ""}" data-word="${word}">
    <button class="daily-check ${done ? "checked" : ""}" data-action="daily-check" title="Mark practiced">${done ? "✓" : ""}</button>
    <div class="daily-word-main">
      <div class="daily-word-title">${v.w} <span style="color:var(--muted);font-weight:400;font-size:.8rem;">${v.ipa}</span></div>
      <div class="daily-word-bn">${v.bn} — ${v.meaning}</div>
    </div>
    <button class="mini-btn" data-action="daily-speak" style="flex:none;padding:6px 10px;">🔊</button>
  </div>`;
}

function renderDailyModal() {
  if (!dailyTarget) {
    dailySetupEl.classList.remove("hidden");
    dailyActiveEl.classList.add("hidden");
    dailyTargetInput.value = 5;
    return;
  }
  ensureDailyState();
  dailySetupEl.classList.add("hidden");
  dailyActiveEl.classList.remove("hidden");
  streakBadge.textContent = `🔥 ${streakData.count} day streak`;
  dailyProgressLabel.textContent = `${dailyState.practiced.length} / ${dailyState.words.length} practiced today`;
  dailyWordListEl.innerHTML = dailyState.words.map(dailyWordItemHtml).join("");

  if (practicedAll.size < MIN_EXAM_WORDS) {
    startExamBtn.textContent = "🔒 Take Review Exam";
    examHint.textContent = `Practice at least ${MIN_EXAM_WORDS} words first (so far: ${practicedAll.size}). Tap ✓ on words above.`;
    examHint.style.color = "var(--muted)";
  } else {
    startExamBtn.textContent = "📝 Take Review Exam";
    examHint.textContent = `Exam pool ready — ${practicedAll.size} practiced words to draw from.`;
    examHint.style.color = "var(--muted)";
  }

  dailyWordListEl.querySelectorAll(".daily-word-item").forEach(itemEl => {
    const word = itemEl.dataset.word;
    itemEl.querySelector('[data-action="daily-speak"]').addEventListener("click", () => speak(word));
    itemEl.querySelector('[data-action="daily-check"]').addEventListener("click", () => {
      const idx = dailyState.practiced.indexOf(word);
      if (idx === -1) {
        dailyState.practiced.push(word);
        practicedAll.add(word);
        savePracticedAll();
      } else {
        dailyState.practiced.splice(idx, 1);
      }
      saveDailyState();
      maybeUpdateStreakOnComplete();
      renderDailyModal();
    });
  });
}

dailyBtn.addEventListener("click", () => {
  renderDailyModal();
  dailyModal.classList.remove("hidden");
});
dailyClose.addEventListener("click", () => dailyModal.classList.add("hidden"));
dailyStartBtn.addEventListener("click", () => {
  const val = Math.max(1, Math.min(30, parseInt(dailyTargetInput.value, 10) || 5));
  dailyTarget = val;
  localStorage.setItem(LS_DAILY_TARGET, String(val));
  // Always regenerate today's word list with the chosen target — this is what
  // makes "reset today's challenge" actually work instead of silently no-op-ing
  // when a dailyState for today already exists.
  const words = generateDailyWords(val);
  dailyState = { date: getTodayStr(), target: val, words, practiced: [] };
  saveDailyState();
  renderDailyModal();
});
dailyChangeTarget.addEventListener("click", () => {
  dailySetupEl.classList.remove("hidden");
  dailyActiveEl.classList.add("hidden");
  dailyTargetInput.value = dailyTarget;
});

// ---------- Review Exam ----------
const examModal = document.getElementById("examModal");
const examClose = document.getElementById("examClose");
const examRunningEl = document.getElementById("examRunning");
const examResultsEl = document.getElementById("examResults");
const examProgressLabel = document.getElementById("examProgressLabel");
const examMeaning = document.getElementById("examMeaning");
const examBn = document.getElementById("examBn");
const examInput = document.getElementById("examInput");
const examSubmit = document.getElementById("examSubmit");
const examFeedback = document.getElementById("examFeedback");
const examScoreLine = document.getElementById("examScoreLine");
const examMissedList = document.getElementById("examMissedList");

let examQuestions = [];
let examIndex = 0;
let examScore = 0;
let examMissed = [];

function showExamQuestion() {
  const q = examQuestions[examIndex];
  examProgressLabel.textContent = `Question ${examIndex + 1} / ${examQuestions.length}`;
  examMeaning.textContent = q.meaning;
  examBn.textContent = q.bn;
  examInput.value = "";
  examFeedback.textContent = "";
  examInput.focus();
}

function checkExamAnswer() {
  if (examIndex >= examQuestions.length) return;
  const q = examQuestions[examIndex];
  const correct = examInput.value.trim().toLowerCase() === q.w.toLowerCase();
  if (correct) {
    examScore++;
    examFeedback.textContent = "✅ Correct!";
    examFeedback.style.color = "var(--accent-2)";
    replayAnimation(examFeedback, "feedback-bounce");
  } else {
    examMissed.push(q);
    examFeedback.textContent = `❌ It was "${q.w}"`;
    examFeedback.style.color = "var(--danger)";
    replayAnimation(examFeedback, "feedback-shake");
  }
  examIndex++;
  setTimeout(() => {
    if (examIndex >= examQuestions.length) showExamResults();
    else showExamQuestion();
  }, 900);
}

function showExamResults() {
  examRunningEl.classList.add("hidden");
  examResultsEl.classList.remove("hidden");
  examScoreLine.textContent = `You scored ${examScore} / ${examQuestions.length}`;

  const pct = Math.round((examScore / examQuestions.length) * 100);
  examStats.examsTaken += 1;
  examStats.totalCorrect += examScore;
  examStats.totalQuestions += examQuestions.length;
  examStats.bestPct = Math.max(examStats.bestPct, pct);
  examStats.history.push({ score: examScore, total: examQuestions.length, pct });
  if (examStats.history.length > 50) examStats.history = examStats.history.slice(-50);
  saveExamStats();
  examMissedList.innerHTML = examMissed.length
    ? examMissed
        .map(
          q => `<div class="daily-word-item"><div class="daily-word-main">
            <div class="daily-word-title">${q.w}</div>
            <div class="daily-word-bn">${q.bn} — ${q.meaning}</div>
          </div></div>`
        )
        .join("")
    : `<p class="quiz-sub">Perfect score! No missed words 🎉</p>`;
}

startExamBtn.addEventListener("click", () => {
  if (practicedAll.size < MIN_EXAM_WORDS) {
    examHint.textContent = `⚠️ You need ${MIN_EXAM_WORDS - practicedAll.size} more practiced word(s) first — tap ✓ next to a word above, then try again.`;
    examHint.style.color = "var(--danger)";
    return;
  }
  const poolWords = shuffle([...practicedAll]);
  examQuestions = poolWords
    .map(w => VOCAB.find(v => v.w === w))
    .filter(Boolean)
    .slice(0, EXAM_LEN);
  if (examQuestions.length === 0) {
    examHint.textContent = "⚠️ Couldn't build an exam from your practiced words. Try practicing a few more.";
    examHint.style.color = "var(--danger)";
    return;
  }
  examIndex = 0;
  examScore = 0;
  examMissed = [];
  dailyModal.classList.add("hidden");
  examRunningEl.classList.remove("hidden");
  examResultsEl.classList.add("hidden");
  examModal.classList.remove("hidden");
  showExamQuestion();
});

examSubmit.addEventListener("click", checkExamAnswer);
examInput.addEventListener("keydown", e => {
  if (e.key === "Enter") checkExamAnswer();
});

function closeExamAndReturn() {
  examModal.classList.add("hidden");
  renderDailyModal();
  dailyModal.classList.remove("hidden");
}
examClose.addEventListener("click", closeExamAndReturn);
document.getElementById("examCloseResults").addEventListener("click", closeExamAndReturn);

// ---------- Image lightbox ----------
const imageLightbox = document.getElementById("imageLightbox");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxWord = document.getElementById("lightboxWord");

function openLightbox(v) {
  const imgUrl = v.img ? v.img : emojiToTwemojiUrl(v.emoji);
  lightboxImg.src = imgUrl;
  lightboxImg.alt = v.w;
  lightboxWord.textContent = `${v.w}  ${v.ipa}`;
  imageLightbox.classList.remove("hidden");
}
document.getElementById("lightboxClose").addEventListener("click", () => imageLightbox.classList.add("hidden"));
imageLightbox.addEventListener("click", e => {
  if (e.target === imageLightbox) imageLightbox.classList.add("hidden");
});

// ---------- My Progress (global stats + Done Words) ----------
const progressBtn = document.getElementById("progressBtn");
const progressModal = document.getElementById("progressModal");
const statsGrid = document.getElementById("statsGrid");
const doneWordsList = document.getElementById("doneWordsList");
const doneEmptyState = document.getElementById("doneEmptyState");
const doneSearch = document.getElementById("doneSearch");
let doneSearchTerm = "";

function statTile(label, value) {
  return `<div class="stat-tile"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}

function renderStatsGrid() {
  const totalLearned = learned.size;
  const examAccuracy = examStats.totalQuestions
    ? Math.round((examStats.totalCorrect / examStats.totalQuestions) * 100)
    : 0;
  statsGrid.innerHTML = [
    statTile("Words done", `${totalLearned} / ${VOCAB.length}`),
    statTile("Daily streak", `🔥 ${streakData.count}`),
    statTile("Practiced pool", practicedAll.size),
    statTile("Favorites", favorites.size),
    statTile("Exams taken", examStats.examsTaken),
    statTile("Exam accuracy", examStats.examsTaken ? `${examAccuracy}%` : "—"),
    statTile("Best exam score", examStats.examsTaken ? `${examStats.bestPct}%` : "—"),
  ].join("");
}

function doneWordItemHtml(v) {
  const imgUrl = v.img ? v.img : emojiToTwemojiUrl(v.emoji);
  const fallbackDisplay = v.emoji || v.w.charAt(0).toUpperCase();
  return `<div class="daily-word-item done-word-item" data-word="${v.w}">
    <div class="card-image-wrap ${v.img ? "card-image-wrap--photo" : ""} done-word-thumb" data-action="zoom" title="Tap to enlarge">
      <img class="card-image" src="${imgUrl}" alt="${v.w}" loading="lazy"
           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
      <span class="card-emoji-fallback">${fallbackDisplay}</span>
    </div>
    <div class="daily-word-main">
      <div class="daily-word-title">${v.w} <span style="color:var(--muted);font-weight:400;font-size:.8rem;">${v.ipa}</span></div>
      <div class="daily-word-bn">${v.bn} — ${v.meaning}</div>
    </div>
    <button class="mini-btn" data-action="unlearn" style="flex:none;padding:6px 10px;" title="Move back to not-done">✕</button>
  </div>`;
}

function renderDoneWords() {
  renderStatsGrid();
  const doneVocab = VOCAB.filter(v => learned.has(v.w));
  const filtered = doneSearchTerm
    ? doneVocab.filter(v => v.w.toLowerCase().includes(doneSearchTerm) || (v.bn || "").includes(doneSearchTerm))
    : doneVocab;

  doneEmptyState.classList.toggle("hidden", doneVocab.length > 0);
  doneWordsList.innerHTML = filtered.map(doneWordItemHtml).join("");

  doneWordsList.querySelectorAll(".done-word-item").forEach(itemEl => {
    const word = itemEl.dataset.word;
    const v = VOCAB.find(x => x.w === word);
    itemEl.querySelector('[data-action="zoom"]').addEventListener("click", () => openLightbox(v));
    itemEl.querySelector('[data-action="unlearn"]').addEventListener("click", () => {
      learned.delete(word);
      localStorage.setItem(LS_LEARNED, JSON.stringify([...learned]));
      renderDoneWords();
      renderCards();
    });
  });
}

progressBtn.addEventListener("click", () => {
  doneSearchTerm = "";
  doneSearch.value = "";
  renderDoneWords();
  progressModal.classList.remove("hidden");
});
document.getElementById("progressClose").addEventListener("click", () => progressModal.classList.add("hidden"));
doneSearch.addEventListener("input", () => {
  doneSearchTerm = doneSearch.value.trim().toLowerCase();
  renderDoneWords();
});

// ---------- Init ----------
renderGroupTabs();
renderCards();
