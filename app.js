// ---------- State ----------
const LS_LEARNED = "vocabmaster_learned";
const LS_LEARNED_LOG = "vocabmaster_learned_log";
const LS_FAVORITES = "vocabmaster_favorites";
const LS_THEME = "vocabmaster_theme";

let activeGroup = "all";
let activeLetter = null;
let searchTerm = "";
let showFavOnly = false;
let showImpOnly = false;
let showDoneOnly = false;
let learned = new Set(JSON.parse(localStorage.getItem(LS_LEARNED) || "[]"));
let favorites = new Set(JSON.parse(localStorage.getItem(LS_FAVORITES) || "[]"));
// learnedLog maps word -> date-first-marked-done ("YYYY-MM-DD"), used to build the
// 3-Day Review Exam pool ("words completed in the last 3 days").
let learnedLog = JSON.parse(localStorage.getItem(LS_LEARNED_LOG) || "{}");

function persistLearned() {
  localStorage.setItem(LS_LEARNED, JSON.stringify([...learned]));
  localStorage.setItem(LS_LEARNED_LOG, JSON.stringify(learnedLog));
}
function markLearned(word) {
  learned.add(word);
  learnedLog[word] = getTodayStr();
  persistLearned();
  maybeUpdateStreakOnComplete();
}
function unmarkLearned(word) {
  learned.delete(word);
  delete learnedLog[word];
  persistLearned();
}

const grid = document.getElementById("cardGrid");
const groupTabsEl = document.getElementById("groupTabs");
const alphaBarEl = document.getElementById("alphaBar");
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
      activeLetter = null;
      renderGroupTabs();
      renderAlphaBar();
      renderCards();
    });
  });
}

function renderAlphaBar() {
  const groupWords = VOCAB.filter(v => activeGroup === "all" || v.g === activeGroup);
  const counts = {};
  groupWords.forEach(v => {
    const letter = v.w.charAt(0).toUpperCase();
    counts[letter] = (counts[letter] || 0) + 1;
  });

  const allBtn = `<button class="alpha-btn all-btn ${activeLetter === null ? "active" : ""}" data-letter="">All</button>`;
  const letterBtns = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    .split("")
    .map(letter => {
      const count = counts[letter] || 0;
      const active = activeLetter === letter ? "active" : "";
      return `<button class="alpha-btn ${active}" data-letter="${letter}" ${count === 0 ? "disabled" : ""} title="${count} word${count === 1 ? "" : "s"}">${letter}</button>`;
    })
    .join("");

  alphaBarEl.innerHTML = allBtn + letterBtns;

  alphaBarEl.querySelectorAll(".alpha-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const letter = btn.dataset.letter;
      activeLetter = letter === "" ? null : activeLetter === letter ? null : letter;
      renderAlphaBar();
      renderCards();
    });
  });
}

function filteredVocab() {
  const globalScope = showFavOnly || showDoneOnly;
  return VOCAB.filter(v => {
    if (!globalScope) {
      const groupMatch = activeGroup === "all" || v.g === activeGroup;
      if (!groupMatch) return false;
    }
    if (activeLetter && v.w.charAt(0).toUpperCase() !== activeLetter) return false;
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
    <div class="vocab-card ${isLearned ? "is-done" : ""}" data-word="${v.w}">
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

// ---------- Card grid: event delegation (one listener per container, not per card) ----------
// With up to ~1700 cards, attaching 5 listeners per card (8500+ listeners) on every
// render was the main cause of slowness. A single delegated listener handles clicks
// for every card ever rendered into a container, current or future (e.g. lazy-loaded).
function attachVocabCardDelegation(containerEl, handlers) {
  containerEl.addEventListener("click", e => {
    const cardEl = e.target.closest(".vocab-card");
    if (!cardEl) return;
    const word = cardEl.dataset.word;
    const vocabItem = VOCAB.find(v => v.w === word);
    if (!vocabItem) return;
    const actionBtn = e.target.closest("[data-action]");
    if (!actionBtn) {
      cardEl.classList.toggle("flipped");
      return;
    }
    e.stopPropagation();
    const action = actionBtn.dataset.action;
    if (action === "zoom") return openLightbox(vocabItem);
    if (action === "speak") return speak(vocabItem.w);
    if (action === "practice") return openPronModal(vocabItem);
    if (action === "learn") {
      if (learned.has(word)) unmarkLearned(word);
      else markLearned(word);
      handlers.onToggle(action, word, cardEl, vocabItem);
      return;
    }
    if (action === "fav") {
      if (favorites.has(word)) favorites.delete(word);
      else favorites.add(word);
      localStorage.setItem(LS_FAVORITES, JSON.stringify([...favorites]));
      handlers.onToggle(action, word, cardEl, vocabItem);
      return;
    }
  });
}

// Swap a single card's DOM for a freshly-rendered version (used after fav/learn
// toggles) instead of rebuilding the whole grid — keeps scroll position and any
// lazy-loaded pages intact.
function refreshCardInPlace(cardEl, vocabItem) {
  const wasFlipped = cardEl.classList.contains("flipped");
  const tmp = document.createElement("div");
  tmp.innerHTML = cardTemplate(vocabItem);
  const freshEl = tmp.firstElementChild;
  if (wasFlipped) freshEl.classList.add("flipped");
  cardEl.replaceWith(freshEl);
}

// ---------- Main grid: paginated / lazy rendering ----------
const PAGE_SIZE = 60;
let currentFilteredList = [];
let renderedCount = 0;

function renderCards() {
  currentFilteredList = filteredVocab();
  emptyState.classList.toggle("hidden", currentFilteredList.length > 0);
  renderedCount = Math.min(PAGE_SIZE, currentFilteredList.length);
  grid.innerHTML = currentFilteredList.slice(0, renderedCount).map(cardTemplate).join("");
  renderProgress();
}

function appendMoreCards() {
  if (renderedCount >= currentFilteredList.length) return;
  const next = currentFilteredList.slice(renderedCount, renderedCount + PAGE_SIZE);
  grid.insertAdjacentHTML("beforeend", next.map(cardTemplate).join(""));
  renderedCount += next.length;
}

attachVocabCardDelegation(grid, {
  onToggle(action, word, cardEl, vocabItem) {
    // If the active filter is defined by the very attribute we just toggled
    // (e.g. "Favorites only" + un-favoriting), the card must disappear from
    // this view, which changes the list itself — needs a full re-render.
    const listChanged = (action === "fav" && showFavOnly) || (action === "learn" && showDoneOnly);
    if (listChanged) {
      renderCards();
      return;
    }
    refreshCardInPlace(cardEl, vocabItem);
    renderProgress();
  },
});

const loadMoreSentinel = document.getElementById("loadMoreSentinel");
if ("IntersectionObserver" in window && loadMoreSentinel) {
  new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) appendMoreCards();
  }, { rootMargin: "800px" }).observe(loadMoreSentinel);
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
      markLearned(currentPronItem.w);
      refreshVisibleWordViews();
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

// ---------- Full-page navigation (Daily Learn / Exams replace the grid, not popups) ----------
const dailyPageEl = document.getElementById("dailyPage");
const examPageEl = document.getElementById("examPage");
const mainViewEls = [groupTabsEl, alphaBarEl, document.querySelector(".filter-row"), document.querySelector(".progress-row"), grid, loadMoreSentinel, emptyState];
const fullPageEls = [dailyPageEl, examPageEl];

function showFullPage(pageEl) {
  mainViewEls.forEach(el => el && el.classList.add("hidden"));
  fullPageEls.forEach(el => el.classList.add("hidden"));
  pageEl.classList.remove("hidden");
}
function returnToMainView() {
  fullPageEls.forEach(el => el.classList.add("hidden"));
  mainViewEls.forEach(el => el && el.classList.remove("hidden"));
  emptyState.classList.toggle("hidden", currentFilteredList.length > 0 || filteredVocab().length > 0);
}
// Pronunciation practice can be opened from either the main grid or the Daily
// Learn page (both use the same pron modal) — refresh whichever is visible.
function refreshVisibleWordViews() {
  renderProgress();
  if (!dailyPageEl.classList.contains("hidden")) renderDailyPage();
  else renderCards();
}

document.getElementById("dailyPageBack").addEventListener("click", returnToMainView);
document.getElementById("examPageBack").addEventListener("click", returnToMainView);

// ---------- Daily Challenge (full page, shows real vocab cards for today's words) ----------
const LS_DAILY_TARGET = "vocabmaster_daily_target";
const LS_DAILY_STATE = "vocabmaster_daily_state";
const LS_UNSEEN_POOL = "vocabmaster_unseen_pool";
const LS_STREAK = "vocabmaster_streak";
const LS_EXAM_STATS = "vocabmaster_exam_stats";
const EXAM_LEN_CAP = 20;

let dailyTarget = parseInt(localStorage.getItem(LS_DAILY_TARGET) || "0", 10);
let dailyState = JSON.parse(localStorage.getItem(LS_DAILY_STATE) || "null");
let unseenPool = JSON.parse(localStorage.getItem(LS_UNSEEN_POOL) || "null");
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
function saveStreak() { localStorage.setItem(LS_STREAK, JSON.stringify(streakData)); }

function impPool() {
  return shuffle(VOCAB.filter(v => v.imp === 3).map(v => v.w));
}

function generateDailyWords(target) {
  // Guard against a pool saved before Daily Challenge was restricted to
  // high-priority words — drop anything that isn't imp:3 before drawing.
  if (unseenPool) unseenPool = unseenPool.filter(w => { const v = VOCAB.find(x => x.w === w); return v && v.imp === 3; });
  if (!unseenPool || unseenPool.length === 0) unseenPool = impPool();
  if (unseenPool.length < target) unseenPool = impPool();
  const picked = unseenPool.slice(0, target);
  unseenPool = unseenPool.slice(target);
  saveUnseenPool();
  return picked;
}

function ensureDailyState() {
  const today = getTodayStr();
  if (dailyState && dailyState.date === today) return dailyState;
  const words = generateDailyWords(dailyTarget);
  dailyState = { date: today, target: dailyTarget, words };
  saveDailyState();
  return dailyState;
}

function maybeUpdateStreakOnComplete() {
  if (!dailyState || dailyState.words.length === 0) return;
  if (!dailyState.words.every(w => learned.has(w))) return;
  if (streakData.lastCompletedDate === dailyState.date) return;
  const yesterday = getYesterdayStr(dailyState.date);
  streakData.count = streakData.lastCompletedDate === yesterday ? streakData.count + 1 : 1;
  streakData.lastCompletedDate = dailyState.date;
  saveStreak();
}

const dailyBtn = document.getElementById("dailyBtn");
const dailySetupEl = document.getElementById("dailySetup");
const dailyActiveEl = document.getElementById("dailyActive");
const dailyTargetInput = document.getElementById("dailyTargetInput");
const dailyStartBtn = document.getElementById("dailyStartBtn");
const streakBadge = document.getElementById("streakBadge");
const dailyProgressLabel = document.getElementById("dailyProgressLabel");
const dailyWordGridEl = document.getElementById("dailyWordGrid");
const dailyChangeTarget = document.getElementById("dailyChangeTarget");

function renderDailyPage() {
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
  const doneCount = dailyState.words.filter(w => learned.has(w)).length;
  dailyProgressLabel.textContent = `${doneCount} / ${dailyState.words.length} done today`;
  dailyWordGridEl.innerHTML = dailyState.words.map(w => cardTemplate(VOCAB.find(v => v.w === w))).join("");
}

attachVocabCardDelegation(dailyWordGridEl, {
  onToggle() {
    renderDailyPage();
    renderProgress();
  },
});

dailyBtn.addEventListener("click", () => {
  renderDailyPage();
  showFullPage(dailyPageEl);
});
dailyStartBtn.addEventListener("click", () => {
  const val = Math.max(1, Math.min(30, parseInt(dailyTargetInput.value, 10) || 5));
  dailyTarget = val;
  localStorage.setItem(LS_DAILY_TARGET, String(val));
  // Always regenerate today's word list with the chosen target — this is what
  // makes "reset today's challenge" actually work instead of silently no-op-ing
  // when a dailyState for today already exists.
  const words = generateDailyWords(val);
  dailyState = { date: getTodayStr(), target: val, words };
  saveDailyState();
  renderDailyPage();
});
dailyChangeTarget.addEventListener("click", () => {
  dailySetupEl.classList.remove("hidden");
  dailyActiveEl.classList.add("hidden");
  dailyTargetInput.value = dailyTarget;
});

// ---------- Exams (full page): Daily Exam (today's Daily Challenge batch) + 3-Day Review Exam (every word marked done) ----------
function dailyExamPool() {
  if (!dailyTarget) return [];
  ensureDailyState();
  return dailyState.words;
}
function threeDayExamPool() {
  return [...learned];
}

const examsBtn = document.getElementById("examsBtn");
const examChooserEl = document.getElementById("examChooser");
const dailyExamHint = document.getElementById("dailyExamHint");
const startDailyExamBtn = document.getElementById("startDailyExamBtn");
const threeDayExamHint = document.getElementById("threeDayExamHint");
const start3DayExamBtn = document.getElementById("start3DayExamBtn");
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
let currentExamMode = "daily";

function renderExamChooser() {
  examChooserEl.classList.remove("hidden");
  examRunningEl.classList.add("hidden");
  examResultsEl.classList.add("hidden");

  const dPool = dailyExamPool();
  dailyExamHint.textContent = dPool.length
    ? `${dPool.length} word${dPool.length === 1 ? "" : "s"} from today's Daily Challenge, ready to test.`
    : "No Daily Challenge words yet — start a Daily Challenge batch first.";
  startDailyExamBtn.disabled = dPool.length === 0;

  const tPool = threeDayExamPool();
  if (tPool.length === 0) {
    threeDayExamHint.textContent = "No words marked done yet — mark some words done, then come back.";
    start3DayExamBtn.disabled = true;
  } else {
    threeDayExamHint.textContent = `${tPool.length} word${tPool.length === 1 ? "" : "s"} done overall — ready to test!`;
    start3DayExamBtn.disabled = false;
  }
}

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
  const pct = Math.round((examScore / examQuestions.length) * 100);
  examScoreLine.textContent = `You scored ${examScore} / ${examQuestions.length} (${pct}%)`;

  examStats.examsTaken += 1;
  examStats.totalCorrect += examScore;
  examStats.totalQuestions += examQuestions.length;
  examStats.bestPct = Math.max(examStats.bestPct, pct);
  examStats.history.push({ mode: currentExamMode, score: examScore, total: examQuestions.length, pct });
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

function startExam(mode, pool) {
  currentExamMode = mode;
  examQuestions = shuffle(pool.map(w => VOCAB.find(v => v.w === w)).filter(Boolean)).slice(0, EXAM_LEN_CAP);
  if (examQuestions.length === 0) return;
  examIndex = 0;
  examScore = 0;
  examMissed = [];
  examChooserEl.classList.add("hidden");
  examResultsEl.classList.add("hidden");
  examRunningEl.classList.remove("hidden");
  showExamQuestion();
}

examsBtn.addEventListener("click", () => {
  renderExamChooser();
  showFullPage(examPageEl);
});
startDailyExamBtn.addEventListener("click", () => {
  if (startDailyExamBtn.disabled) return;
  startExam("daily", dailyExamPool());
});
start3DayExamBtn.addEventListener("click", () => {
  if (start3DayExamBtn.disabled) return;
  startExam("threeday", threeDayExamPool());
});
examSubmit.addEventListener("click", checkExamAnswer);
examInput.addEventListener("keydown", e => {
  if (e.key === "Enter") checkExamAnswer();
});
document.getElementById("examBackToChooser").addEventListener("click", renderExamChooser);

// ---------- Priority Sprint (high-priority words, fixed 3-day batches gated by exam) ----------
const LS_SPRINT_STATE = "vocabmaster_sprint_state";
const SPRINT_MIN_BATCH = 15;
const SPRINT_MAX_BATCH = 20;
const SPRINT_CYCLE_DAYS = 3;
const SPRINT_PASS_PCT = 70;

let sprintState = JSON.parse(localStorage.getItem(LS_SPRINT_STATE) || "null");
function saveSprintState() { localStorage.setItem(LS_SPRINT_STATE, JSON.stringify(sprintState)); }

function daysBetween(dateStr1, dateStr2) {
  const d1 = new Date(`${dateStr1}T00:00:00`);
  const d2 = new Date(`${dateStr2}T00:00:00`);
  return Math.round((d2 - d1) / 86400000);
}

function sprintPool() {
  return VOCAB.filter(v => v.imp === 3 && !learned.has(v.w)).map(v => v.w);
}

function generateSprintBatch(batchSize, cycleNumber) {
  const words = shuffle(sprintPool()).slice(0, batchSize);
  return { batchSize, words, startDate: getTodayStr(), cycleNumber, practiced: [] };
}

function sprintExamUnlocked() {
  return !!sprintState && daysBetween(sprintState.startDate, getTodayStr()) >= SPRINT_CYCLE_DAYS;
}

const sprintBtn = document.getElementById("sprintBtn");
const sprintModal = document.getElementById("sprintModal");
const sprintClose = document.getElementById("sprintClose");
const sprintSetupEl = document.getElementById("sprintSetup");
const sprintActiveEl = document.getElementById("sprintActive");
const sprintDoneEl = document.getElementById("sprintDone");
const sprintSizeInput = document.getElementById("sprintSizeInput");
const sprintStartBtn = document.getElementById("sprintStartBtn");
const sprintCycleBadge = document.getElementById("sprintCycleBadge");
const sprintDayLabel = document.getElementById("sprintDayLabel");
const sprintWordListEl = document.getElementById("sprintWordList");
const sprintTakeExamBtn = document.getElementById("sprintTakeExamBtn");
const sprintExamHint = document.getElementById("sprintExamHint");

function sprintWordItemHtml(word) {
  const v = VOCAB.find(x => x.w === word);
  if (!v) return "";
  const done = sprintState.practiced.includes(word);
  return `<div class="daily-word-item ${done ? "done" : ""}" data-word="${word}">
    <button class="daily-check ${done ? "checked" : ""}" data-action="sprint-check" title="Mark practiced">${done ? "✓" : ""}</button>
    <div class="daily-word-main">
      <div class="daily-word-title">${v.w} <span style="color:var(--muted);font-weight:400;font-size:.8rem;">${v.ipa}</span></div>
      <div class="daily-word-bn">${v.bn} — ${v.meaning}</div>
    </div>
    <button class="mini-btn" data-action="sprint-speak" style="flex:none;padding:6px 10px;">🔊</button>
  </div>`;
}

function renderSprintModal() {
  if (!sprintState) {
    sprintSetupEl.classList.remove("hidden");
    sprintActiveEl.classList.add("hidden");
    sprintDoneEl.classList.add("hidden");
    return;
  }
  sprintSetupEl.classList.add("hidden");
  sprintDoneEl.classList.add("hidden");
  sprintActiveEl.classList.remove("hidden");

  sprintCycleBadge.textContent = `📦 Batch #${sprintState.cycleNumber}`;
  const elapsed = daysBetween(sprintState.startDate, getTodayStr());
  const unlocked = sprintExamUnlocked();
  sprintDayLabel.textContent = unlocked ? "Exam unlocked! 🔓" : `Day ${Math.min(elapsed + 1, SPRINT_CYCLE_DAYS)} of ${SPRINT_CYCLE_DAYS}`;

  sprintWordListEl.innerHTML = sprintState.words.map(sprintWordItemHtml).join("");

  if (unlocked) {
    sprintTakeExamBtn.textContent = "📝 Take Sprint Exam";
    sprintTakeExamBtn.disabled = false;
    sprintExamHint.textContent = `Score ${SPRINT_PASS_PCT}%+ on these ${sprintState.words.length} words to unlock your next batch.`;
    sprintExamHint.style.color = "var(--muted)";
  } else {
    const daysLeft = SPRINT_CYCLE_DAYS - elapsed;
    sprintTakeExamBtn.textContent = "🔒 Exam locked";
    sprintTakeExamBtn.disabled = true;
    sprintExamHint.textContent = `Keep studying — exam unlocks in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`;
    sprintExamHint.style.color = "var(--muted)";
  }

  sprintWordListEl.querySelectorAll(".daily-word-item").forEach(itemEl => {
    const word = itemEl.dataset.word;
    itemEl.querySelector('[data-action="sprint-speak"]').addEventListener("click", () => speak(word));
    itemEl.querySelector('[data-action="sprint-check"]').addEventListener("click", () => {
      const idx = sprintState.practiced.indexOf(word);
      if (idx === -1) sprintState.practiced.push(word);
      else sprintState.practiced.splice(idx, 1);
      saveSprintState();
      renderSprintModal();
    });
  });
}

sprintBtn.addEventListener("click", () => {
  if (!sprintState && sprintPool().length === 0) {
    sprintSetupEl.classList.add("hidden");
    sprintActiveEl.classList.add("hidden");
    sprintDoneEl.classList.remove("hidden");
  } else if (!sprintState) {
    const availableNow = sprintPool().length;
    sprintSizeInput.max = String(Math.min(SPRINT_MAX_BATCH, availableNow) || SPRINT_MAX_BATCH);
    sprintSizeInput.value = String(Math.min(SPRINT_MAX_BATCH, availableNow));
    renderSprintModal();
  } else {
    renderSprintModal();
  }
  sprintModal.classList.remove("hidden");
});
sprintClose.addEventListener("click", () => sprintModal.classList.add("hidden"));

sprintStartBtn.addEventListener("click", () => {
  const pool = sprintPool();
  if (pool.length === 0) {
    sprintSetupEl.classList.add("hidden");
    sprintDoneEl.classList.remove("hidden");
    return;
  }
  const size = Math.max(SPRINT_MIN_BATCH, Math.min(SPRINT_MAX_BATCH, parseInt(sprintSizeInput.value, 10) || SPRINT_MAX_BATCH));
  sprintState = generateSprintBatch(Math.min(size, pool.length), 1);
  saveSprintState();
  renderSprintModal();
});

// ---------- Priority Sprint exam ----------
const sprintExamModal = document.getElementById("sprintExamModal");
const sprintExamClose = document.getElementById("sprintExamClose");
const sprintExamRunningEl = document.getElementById("sprintExamRunning");
const sprintExamResultsEl = document.getElementById("sprintExamResults");
const sprintExamProgressLabel = document.getElementById("sprintExamProgressLabel");
const sprintExamMeaning = document.getElementById("sprintExamMeaning");
const sprintExamBn = document.getElementById("sprintExamBn");
const sprintExamInput = document.getElementById("sprintExamInput");
const sprintExamSubmit = document.getElementById("sprintExamSubmit");
const sprintExamFeedback = document.getElementById("sprintExamFeedback");
const sprintExamScoreLine = document.getElementById("sprintExamScoreLine");
const sprintExamVerdict = document.getElementById("sprintExamVerdict");
const sprintExamMissedList = document.getElementById("sprintExamMissedList");
const sprintExamRetryBtn = document.getElementById("sprintExamRetryBtn");
const sprintExamNextBtn = document.getElementById("sprintExamNextBtn");

let sprintExamQuestions = [];
let sprintExamIndex = 0;
let sprintExamScoreVal = 0;
let sprintExamMissed = [];

function buildSprintExamQuestions() {
  return shuffle(sprintState.words.map(w => VOCAB.find(v => v.w === w)).filter(Boolean));
}

function showSprintExamQuestion() {
  const q = sprintExamQuestions[sprintExamIndex];
  sprintExamProgressLabel.textContent = `Question ${sprintExamIndex + 1} / ${sprintExamQuestions.length}`;
  sprintExamMeaning.textContent = q.meaning;
  sprintExamBn.textContent = q.bn;
  sprintExamInput.value = "";
  sprintExamFeedback.textContent = "";
  sprintExamInput.focus();
}

function checkSprintExamAnswer() {
  if (sprintExamIndex >= sprintExamQuestions.length) return;
  const q = sprintExamQuestions[sprintExamIndex];
  const correct = sprintExamInput.value.trim().toLowerCase() === q.w.toLowerCase();
  if (correct) {
    sprintExamScoreVal++;
    sprintExamFeedback.textContent = "✅ Correct!";
    sprintExamFeedback.style.color = "var(--accent-2)";
    replayAnimation(sprintExamFeedback, "feedback-bounce");
  } else {
    sprintExamMissed.push(q);
    sprintExamFeedback.textContent = `❌ It was "${q.w}"`;
    sprintExamFeedback.style.color = "var(--danger)";
    replayAnimation(sprintExamFeedback, "feedback-shake");
  }
  sprintExamIndex++;
  setTimeout(() => {
    if (sprintExamIndex >= sprintExamQuestions.length) showSprintExamResults();
    else showSprintExamQuestion();
  }, 900);
}

function showSprintExamResults() {
  sprintExamRunningEl.classList.add("hidden");
  sprintExamResultsEl.classList.remove("hidden");
  const pct = Math.round((sprintExamScoreVal / sprintExamQuestions.length) * 100);
  sprintExamScoreLine.textContent = `You scored ${sprintExamScoreVal} / ${sprintExamQuestions.length} (${pct}%)`;

  sprintExamMissedList.innerHTML = sprintExamMissed.length
    ? sprintExamMissed
        .map(
          q => `<div class="daily-word-item"><div class="daily-word-main">
            <div class="daily-word-title">${q.w}</div>
            <div class="daily-word-bn">${q.bn} — ${q.meaning}</div>
          </div></div>`
        )
        .join("")
    : `<p class="quiz-sub">Perfect score! No missed words 🎉</p>`;

  if (pct >= SPRINT_PASS_PCT) {
    sprintExamVerdict.textContent = `🎉 Passed! (need ${SPRINT_PASS_PCT}%+) These words are now marked done.`;
    sprintExamVerdict.style.color = "var(--accent-2)";
    sprintState.words.forEach(w => markLearned(w));
    renderCards();
    sprintExamRetryBtn.classList.add("hidden");
    sprintExamNextBtn.classList.remove("hidden");
  } else {
    sprintExamVerdict.textContent = `Not quite — need ${SPRINT_PASS_PCT}%+ to unlock the next batch. Keep studying and retry anytime.`;
    sprintExamVerdict.style.color = "var(--danger)";
    sprintExamRetryBtn.classList.remove("hidden");
    sprintExamNextBtn.classList.add("hidden");
  }
}

sprintTakeExamBtn.addEventListener("click", () => {
  if (sprintTakeExamBtn.disabled) return;
  sprintExamQuestions = buildSprintExamQuestions();
  sprintExamIndex = 0;
  sprintExamScoreVal = 0;
  sprintExamMissed = [];
  sprintModal.classList.add("hidden");
  sprintExamRunningEl.classList.remove("hidden");
  sprintExamResultsEl.classList.add("hidden");
  sprintExamModal.classList.remove("hidden");
  showSprintExamQuestion();
});

sprintExamSubmit.addEventListener("click", checkSprintExamAnswer);
sprintExamInput.addEventListener("keydown", e => {
  if (e.key === "Enter") checkSprintExamAnswer();
});

sprintExamRetryBtn.addEventListener("click", () => {
  sprintExamQuestions = buildSprintExamQuestions();
  sprintExamIndex = 0;
  sprintExamScoreVal = 0;
  sprintExamMissed = [];
  sprintExamRunningEl.classList.remove("hidden");
  sprintExamResultsEl.classList.add("hidden");
  showSprintExamQuestion();
});

sprintExamNextBtn.addEventListener("click", () => {
  const nextPool = sprintPool();
  if (nextPool.length === 0) {
    sprintState = null;
    saveSprintState();
    sprintExamModal.classList.add("hidden");
    sprintModal.classList.remove("hidden");
    renderSprintModal();
    return;
  }
  sprintState = generateSprintBatch(Math.min(sprintState.batchSize, nextPool.length), sprintState.cycleNumber + 1);
  saveSprintState();
  sprintExamModal.classList.add("hidden");
  sprintModal.classList.remove("hidden");
  renderSprintModal();
});

function closeSprintExamAndReturn() {
  sprintExamModal.classList.add("hidden");
  renderSprintModal();
  sprintModal.classList.remove("hidden");
}
sprintExamClose.addEventListener("click", closeSprintExamAndReturn);
document.getElementById("sprintExamCloseResults").addEventListener("click", closeSprintExamAndReturn);

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
      unmarkLearned(word);
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
renderAlphaBar();
renderCards();
// Refresh today's Daily Challenge batch on load (not just when the tab is opened) so a
// day's completion is tracked — and the streak can advance — even if today's words get
// marked done from elsewhere in the app before Daily Challenge is ever visited.
if (dailyTarget) ensureDailyState();
