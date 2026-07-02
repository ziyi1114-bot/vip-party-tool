/* =================================================================
   VIP Party Tool — script.js
   架構：單一檔案 + 遊戲註冊表 (registry) 模式
   - 路由：用 hash (#home / #guess-people / #charades / #playlists)
     切換 <section class="screen">，不重新載入頁面 → 返回不清進度
   - 共用工具 Util：shuffle / loadJSON / storage / confirmReset / beep
   - 每個遊戲是一個物件，註冊進 GAMES 陣列
   - 新增第 4、5 個遊戲：
       1) 在 index.html 加一個 <section class="screen"> 與按鈕
       2) 寫一個遊戲模組物件（含 id/title/onEnter…）
       3) push 進 GAMES 陣列
     不需要更動核心路由。
   ================================================================= */

'use strict';

/* 顯示在首頁的版本號。發新版時把這裡與 service-worker.js 的 CACHE_VERSION
   一起 +1（見 CLAUDE.md），使用者就能在首頁確認裝置吃到哪一版。 */
var APP_VERSION = 'v4';

/* =================================================================
   共用工具模組
   ================================================================= */
var Util = {

  /* Fisher–Yates 洗牌：原地打亂並回傳同一陣列 */
  shuffle: function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  },

  /* 載入 JSON（附記憶體快取，避免重複 fetch）。回傳 Promise */
  _jsonCache: {},
  loadJSON: function (path) {
    if (Util._jsonCache[path]) {
      return Promise.resolve(Util._jsonCache[path]);
    }
    return fetch(path, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('載入失敗：' + path);
        return res.json();
      })
      .then(function (data) {
        Util._jsonCache[path] = data;
        return data;
      });
  },

  /* localStorage 包裝：自動 JSON 序列化，並用 try/catch
     防止 Safari 無痕模式寫入時拋錯讓整個 app 掛掉 */
  storage: {
    get: function (key) {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    set: function (key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* 無痕模式或空間滿，靜默忽略；遊戲仍可記憶體內進行 */
      }
    },
    remove: function (key) {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
    }
  },

  /* 重製防呆確認，確認才回傳 true */
  confirmReset: function () {
    return window.confirm('確定要重製嗎？目前進度會被清除。');
  },

  /* 共用 AudioContext 單例。iOS/iPadOS Safari 規定必須在「使用者手勢」
     當下建立並 resume，否則之後（如計時器回呼）播放會被靜音策略擋掉。 */
  _audioCtx: null,

  /* 於使用者手勢（例如按「開始遊戲」）當下呼叫，解鎖音訊 */
  unlockAudio: function () {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!Util._audioCtx) Util._audioCtx = new Ctx();
      if (Util._audioCtx.state === 'suspended') Util._audioCtx.resume();
    } catch (e) {
      /* 不支援就靜默，不影響其它功能 */
    }
  },

  /* 播放單一柔和音：三角波 + 淡入淡出包絡，避免方波的尖銳與爆音。
     peak 為音量峰值（預設 0.16）；短音自動縮短淡入時間讓它更俐落 */
  _tone: function (ctx, freq, startTime, duration, peak) {
    peak = peak || 0.16;
    var attack = Math.min(0.03, duration * 0.4);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'triangle';           // 比 square 柔和許多
    osc.frequency.value = freq;
    // 用指數包絡（不能到 0，故用極小值）：快速淡入、平滑淡出，消除硬起硬停的「喀」聲
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peak, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  },

  /* 短促「滴／答」聲，用於比手畫腳最後 10 秒。
     high 決定高音或低音，交替呼叫即成時鐘般的滴答節奏 */
  tickSound: function (high) {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!Util._audioCtx) Util._audioCtx = new Ctx();
      var ctx = Util._audioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      Util._tone(ctx, high ? 1100 : 820, ctx.currentTime, 0.06, 0.13);
    } catch (e) {
      /* 不支援就靜默 */
    }
  },

  /* 提示音（Web Audio），用於比手畫腳時間到。
     柔和「叮—咚」兩聲，明顯但不刺耳。重用已解鎖的單例 context（不 close） */
  beep: function () {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!Util._audioCtx) Util._audioCtx = new Ctx();
      var ctx = Util._audioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime;
      Util._tone(ctx, 659.25, t, 0.35);        // E5（叮）
      Util._tone(ctx, 523.25, t + 0.32, 0.5);  // C5（咚）
    } catch (e) {
      /* 某些舊 Safari 不支援，忽略即可 */
    }
  },

  /* 震動（iPad Safari 多半無效，但不影響其他裝置） */
  vibrate: function (ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {}
  },

  /* 小工具：以 data-* 屬性在指定範圍內找元素 */
  q: function (root, attr) {
    return root.querySelector('[' + attr + ']');
  },
  qa: function (root, attr) {
    return root.querySelectorAll('[' + attr + ']');
  },

  /* 按鈕防連點：包裝一個 handler，點擊後立即鎖定，ms 後自動解除，
     鎖定期間再次點擊直接忽略。每次呼叫產生獨立的鎖（每顆按鈕各自計時），
     所以「答對」與「PASS」不會互相卡住。預設 250ms，不影響正常操作速度。 */
  guard: function (fn, ms) {
    var locked = false;
    return function () {
      if (locked) return;
      locked = true;
      var self = this, args = arguments;
      setTimeout(function () { locked = false; }, ms || 250);
      return fn.apply(self, args);
    };
  },

  /* 螢幕防休眠（Screen Wake Lock）。
     request/release 由路由呼叫；系統在切到背景時會自動釋放螢幕鎖，
     故切回前景需重新取得（見啟動時的 visibilitychange）。
     不支援的裝置（如較舊 iOS）會靜默略過，不影響其它功能。 */
  wakeLock: {
    _lock: null,
    _wanted: false,   // 目前是否「想要」保持螢幕不休眠（在遊戲中）

    request: function () {
      Util.wakeLock._wanted = true;
      Util.wakeLock._acquire();
    },

    release: function () {
      Util.wakeLock._wanted = false;
      if (Util.wakeLock._lock) {
        try { Util.wakeLock._lock.release(); } catch (e) {}
        Util.wakeLock._lock = null;
      }
    },

    _acquire: function () {
      if (!Util.wakeLock._wanted) return;
      if (Util.wakeLock._lock) return;
      if (!('wakeLock' in navigator)) return;
      try {
        navigator.wakeLock.request('screen').then(function (lock) {
          Util.wakeLock._lock = lock;
          // 系統自動釋放時清掉參照，回前景才能再次取得
          lock.addEventListener('release', function () {
            Util.wakeLock._lock = null;
          });
        }).catch(function () { /* 被拒或不支援，忽略 */ });
      } catch (e) {}
    }
  }
};

/* =================================================================
   路由：hash → 對應 screen
   ================================================================= */
var Router = {
  current: null,

  // hash 名稱 → screen 元素 id 對照
  routes: {
    'home': 'screen-home',
    'guess-people': 'screen-guess-people',
    'charades': 'screen-charades',
    'playlists': 'screen-playlists'
  },

  go: function (hash) {
    location.hash = '#' + hash;
  },

  apply: function () {
    var hash = (location.hash || '#home').replace('#', '');
    if (!Router.routes[hash]) hash = 'home';

    // 切換 active class
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.remove('active');
    }
    var el = document.getElementById(Router.routes[hash]);
    if (el) el.classList.add('active');

    // 通知前一個遊戲離開（例如清計時器），再通知新遊戲進入
    if (Router.current && Router.current !== hash) {
      var prev = GameRegistry.byId(Router.current);
      if (prev && prev.onLeave) prev.onLeave();
    }
    var game = GameRegistry.byId(hash);
    if (game && game.onEnter) game.onEnter();

    // 遊戲畫面保持螢幕不休眠，回首頁釋放
    if (hash === 'home') Util.wakeLock.release();
    else Util.wakeLock.request();

    Router.current = hash;
    window.scrollTo(0, 0);
  }
};

/* =================================================================
   遊戲註冊表
   ================================================================= */
var GAMES = []; // 各遊戲模組 push 進來
var GameRegistry = {
  byId: function (id) {
    for (var i = 0; i < GAMES.length; i++) {
      if (GAMES[i].id === id) return GAMES[i];
    }
    return null;
  }
};

/* =================================================================
   遊戲一：猜人名
   ================================================================= */
var GuessPeople = (function () {
  var KEY = 'vpt:guessPeople';
  var DATA_PATH = 'data/guess-people.json';
  var WINDOW = 5;       // 預載視窗大小（前幾張優先 + 後方維持張數）

  var people = [];      // 原始題庫（含 name/image）
  var screen, dom = {}; // DOM 參照
  var state = null;     // { order:[原始index...], idx:Number }
  var preloadedSet = {};// 已預載的原始 index（避免重複建 Image）
  var loading = false;  // 前幾張圖預載中（避免長時間下載期間重複觸發開始）
  var answerShown = false; // 目前是否顯示答案（僅檢視狀態，不寫進存檔）

  function cacheDom() {
    screen = document.getElementById('screen-guess-people');
    dom.lobby   = Util.q(screen, 'data-gp-lobby');
    dom.loading = Util.q(screen, 'data-gp-loading');
    dom.play    = Util.q(screen, 'data-gp-play');
    dom.done    = Util.q(screen, 'data-gp-done');
    dom.counter = Util.q(screen, 'data-gp-counter');
    dom.image   = Util.q(screen, 'data-gp-image');
    dom.answer       = Util.q(screen, 'data-gp-answer');
    dom.answerToggle = Util.q(screen, 'data-gp-answer-toggle');
    // 可見圖片載入失敗也記一筆，避免破圖無提示
    dom.image.onerror = function () {
      console.warn('圖片載入失敗：' + dom.image.src);
    };
  }

  // 顯示四個區塊其中之一（lobby / loading / play / done）
  function showPhase(phase) {
    dom.lobby.classList.toggle('hidden', phase !== 'lobby');
    dom.loading.classList.toggle('hidden', phase !== 'loading');
    dom.play.classList.toggle('hidden', phase !== 'play');
    dom.done.classList.toggle('hidden', phase !== 'done');
  }

  // 預載單張圖片。回傳 Promise；成功或失敗都 resolve（失敗只 warn，不中斷）
  function preloadImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(); };
      img.onerror = function () {
        console.warn('圖片載入失敗：' + src);
        resolve();
      };
      img.src = src;
    });
  }

  // 預載 order[fromIdx .. fromIdx+count-1] 中尚未預載者。回傳 Promise（全數完成）
  function preloadWindow(fromIdx, count) {
    if (!state) return Promise.resolve();
    var promises = [];
    var end = Math.min(fromIdx + count, state.order.length);
    for (var i = fromIdx; i < end; i++) {
      var origIdx = state.order[i];
      if (preloadedSet[origIdx]) continue;
      preloadedSet[origIdx] = true;
      promises.push(preloadImage(people[origIdx].image));
    }
    return Promise.all(promises);
  }

  // 依目前 state 渲染畫面
  function render() {
    if (!state) { showPhase('lobby'); return; }

    if (state.idx >= state.order.length) {
      showPhase('done');
      return;
    }
    showPhase('play');

    var person = people[state.order[state.idx]];
    // 只更新 img.src（不重建節點）；已預載者會直接命中快取
    dom.image.src = person.image;
    dom.image.alt = '人物圖片';

    var remain = state.order.length - state.idx;
    dom.counter.textContent = '剩餘題數：' + remain;

    // 換題自動恢復隱藏答案
    hideAnswer();

    // 維持後方約 WINDOW 張預載（不等按下一題才下載）
    preloadWindow(state.idx, WINDOW);
  }

  // 隱藏答案並重置切換鈕
  function hideAnswer() {
    answerShown = false;
    if (dom.answer) {
      dom.answer.classList.add('hidden');
      dom.answer.textContent = '';
    }
    if (dom.answerToggle) dom.answerToggle.textContent = '顯示答案';
  }

  // 切換答案顯示／隱藏
  function toggleAnswer() {
    if (!state || state.idx >= state.order.length) return;
    answerShown = !answerShown;
    if (answerShown) {
      dom.answer.textContent = people[state.order[state.idx]].name;
      dom.answer.classList.remove('hidden');
      dom.answerToggle.textContent = '隱藏答案';
    } else {
      hideAnswer();
    }
  }

  // 開始遊戲：載入題庫 → 洗牌 → 存檔 → 優先預載前 WINDOW 張 → 進入
  function start() {
    if (loading) return; // 前幾張還在載，忽略重複觸發
    Util.loadJSON(DATA_PATH).then(function (data) {
      people = data;
      var order = [];
      for (var i = 0; i < people.length; i++) order.push(i);
      Util.shuffle(order);
      state = { order: order, idx: 0 };
      preloadedSet = {};
      Util.storage.set(KEY, state);

      // 優先預載前 WINDOW 張（不足則全部），完成即可開始
      loading = true;
      showPhase('loading');
      var head = Math.min(WINDOW, order.length);
      preloadWindow(0, head).then(function () {
        loading = false;
        showPhase('play');
        render();
        // 其餘圖片背景慢慢預載（不 await）
        preloadWindow(head, order.length);
      });
    }).catch(function (err) {
      loading = false;
      alert('讀取題庫失敗：' + err.message);
    });
  }

  function next() {
    if (!state) return;
    state.idx++;
    Util.storage.set(KEY, state);
    render(); // render 內會維持後方預載視窗
  }

  function reset() {
    if (!Util.confirmReset()) return;
    Util.storage.remove(KEY);
    state = null;
    preloadedSet = {};
    hideAnswer();
    showPhase('lobby');
  }

  // 進入頁面：若有存檔則接續，並確保題庫已載入
  function onEnter() {
    if (!screen) cacheDom();
    var saved = Util.storage.get(KEY);
    if (saved && saved.order && saved.order.length) {
      // 接續進度，需要把題庫載回記憶體才能取圖
      Util.loadJSON(DATA_PATH).then(function (data) {
        people = data;
        state = saved;
        preloadedSet = {};
        render(); // 會預熱目前位置附近的圖
      }).catch(function () {
        showPhase('lobby');
      });
    } else {
      state = null;
      showPhase('lobby');
    }
  }

  function bind() {
    if (!screen) cacheDom();
    // 同一畫面內可能有多顆 reset（play/done 區），全部綁定
    var i;
    var starts = Util.qa(screen, 'data-gp-start');
    for (i = 0; i < starts.length; i++) starts[i].addEventListener('click', Util.guard(start));
    var nexts = Util.qa(screen, 'data-gp-next');
    for (i = 0; i < nexts.length; i++) nexts[i].addEventListener('click', Util.guard(next));
    var resets = Util.qa(screen, 'data-gp-reset');
    for (i = 0; i < resets.length; i++) resets[i].addEventListener('click', Util.guard(reset));
    // 答案切換不套 guard，保持切換即時
    var toggles = Util.qa(screen, 'data-gp-answer-toggle');
    for (i = 0; i < toggles.length; i++) toggles[i].addEventListener('click', toggleAnswer);
  }

  return {
    id: 'guess-people',
    title: '猜人名',
    init: bind,
    onEnter: onEnter
  };
})();

/* =================================================================
   遊戲二：比手畫腳
   ================================================================= */
var Charades = (function () {
  var KEY = 'vpt:charades';
  var DATA_PATH = 'data/charades.json';

  var words = [];      // 原始題庫（字串陣列）
  var screen, dom = {};
  // state: { order:[原始index...], idx, correct, seconds }
  var state = null;
  var timerId = null;
  var remainingTime = 0; // 本回合剩餘秒數

  function cacheDom() {
    screen = document.getElementById('screen-charades');
    dom.lobby    = Util.q(screen, 'data-ch-lobby');
    dom.play     = Util.q(screen, 'data-ch-play');
    dom.summary  = Util.q(screen, 'data-ch-summary');
    dom.done     = Util.q(screen, 'data-ch-done');
    dom.seconds  = Util.q(screen, 'data-ch-seconds');
    dom.timer    = Util.q(screen, 'data-ch-timer');
    dom.correct  = Util.q(screen, 'data-ch-correct');
    dom.remain   = Util.q(screen, 'data-ch-remain');
    dom.word     = Util.q(screen, 'data-ch-word');
    dom.correctBtn = Util.q(screen, 'data-ch-correct-btn');
    dom.passBtn  = Util.q(screen, 'data-ch-pass-btn');
    dom.final    = Util.q(screen, 'data-ch-final');
  }

  function showPhase(phase) {
    dom.lobby.classList.toggle('hidden', phase !== 'lobby');
    dom.play.classList.toggle('hidden', phase !== 'play');
    dom.summary.classList.toggle('hidden', phase !== 'summary');
    dom.done.classList.toggle('hidden', phase !== 'done');
  }

  function clearTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
  }

  function lockButtons(locked) {
    dom.correctBtn.disabled = locked;
    dom.passBtn.disabled = locked;
  }

  // 渲染目前題目與統計
  function renderWord() {
    if (state.idx >= state.order.length) {
      // 題庫用完
      clearTimer();
      showPhase('done');
      return;
    }
    dom.word.textContent = words[state.order[state.idx]];
    dom.correct.textContent = '答對：' + state.correct;
    dom.remain.textContent = '剩餘：' + (state.order.length - state.idx);
  }

  // 更新倒數顯示
  function renderTimer() {
    dom.timer.textContent = remainingTime;
    dom.timer.classList.toggle('warning', remainingTime <= 10);
  }

  function tick() {
    remainingTime--;
    if (remainingTime <= 0) {
      remainingTime = 0;
      renderTimer();
      timeUp();
      return;
    }
    renderTimer();
    // 最後 10 秒開始滴答（高低交替像時鐘），倒數結束由 timeUp 的提示音收尾
    if (remainingTime <= 10) Util.tickSound(remainingTime % 2 === 0);
  }

  function startTimer() {
    clearTimer();
    renderTimer();
    timerId = setInterval(tick, 1000);
  }

  // 時間到：停止、鎖按鈕、提示音+震動、顯示總結
  function timeUp() {
    clearTimer();
    lockButtons(true);
    Util.beep();
    Util.vibrate(400);
    dom.final.textContent = state.correct;
    showPhase('summary');
  }

  // 開始遊戲（全新一輪）：載入→洗牌→存檔
  function start() {
    // 趁使用者手勢當下解鎖音訊，稍後「時間到」的提示音才響得出來（iPadOS Safari）
    Util.unlockAudio();

    var secs = parseInt(dom.seconds.value, 10);
    if (isNaN(secs) || secs < 1) secs = 60;

    Util.loadJSON(DATA_PATH).then(function (data) {
      words = data;
      var order = [];
      for (var i = 0; i < words.length; i++) order.push(i);
      Util.shuffle(order);
      state = { order: order, idx: 0, correct: 0, seconds: secs };
      Util.storage.set(KEY, state);
      beginRound();
    }).catch(function (err) {
      alert('讀取題庫失敗：' + err.message);
    });
  }

  // 開始一個回合（沿用目前 state.idx，答對歸零）：先 3 秒準備倒數，再正式開始
  function beginRound() {
    if (state.idx >= state.order.length) {
      showPhase('done');
      return;
    }
    state.correct = 0;
    Util.storage.set(KEY, state);
    showPhase('play');
    countdownThenStart();
  }

  // 3、2、1 準備倒數；期間鎖住按鈕、題目顯示「準備…」，倒數結束才發題與計時
  function countdownThenStart() {
    clearTimer();
    lockButtons(true);
    dom.word.textContent = '準備…';
    dom.correct.textContent = '答對：' + state.correct;
    dom.remain.textContent = '剩餘：' + (state.order.length - state.idx);
    var count = 3;
    dom.timer.classList.remove('warning');
    dom.timer.textContent = count;
    timerId = setInterval(function () {
      count--;
      if (count <= 0) {
        clearTimer();
        startRound();
        return;
      }
      dom.timer.textContent = count;
    }, 1000);
  }

  // 真正開始本回合：解鎖按鈕、發題、開始遊戲倒數
  function startRound() {
    remainingTime = state.seconds;
    lockButtons(false);
    renderWord();
    startTimer();
  }

  function answerCorrect() {
    if (!state) return;
    state.correct++;
    state.idx++;
    Util.storage.set(KEY, state);
    renderWord();
  }

  function pass() {
    if (!state) return;
    state.idx++;
    Util.storage.set(KEY, state);
    renderWord();
  }

  function nextRound() {
    if (!state) return;
    beginRound();
  }

  function reset() {
    if (!Util.confirmReset()) return;
    clearTimer();
    Util.storage.remove(KEY);
    state = null;
    if (dom.seconds) dom.seconds.value = 60;
    showPhase('lobby');
  }

  // 進入頁面：有存檔則回到待機（顯示秒數），不自動續倒數
  function onEnter() {
    if (!screen) cacheDom();
    var saved = Util.storage.get(KEY);
    if (saved && saved.order) {
      state = saved;
      dom.seconds.value = saved.seconds || 60;
      // 重新整理後不直接續倒數（計時不可靠），回到待機讓主持人按開始下一回合
      Util.loadJSON(DATA_PATH).then(function (data) { words = data; });
    } else {
      state = null;
      // 沒有進行中存檔時，明確設回預設 60 秒
      // （不依賴 HTML value，因瀏覽器重載時會還原使用者上次輸入的值蓋掉它）
      dom.seconds.value = 60;
    }
    showPhase('lobby');
  }

  // 離開頁面：清除計時器避免背景殘留
  function onLeave() {
    clearTimer();
  }

  function bind() {
    if (!screen) cacheDom();
    var i;
    var starts = Util.qa(screen, 'data-ch-start');
    for (i = 0; i < starts.length; i++) starts[i].addEventListener('click', Util.guard(start));
    dom.correctBtn.addEventListener('click', Util.guard(answerCorrect));
    dom.passBtn.addEventListener('click', Util.guard(pass));
    var nr = Util.qa(screen, 'data-ch-nextround');
    for (i = 0; i < nr.length; i++) nr[i].addEventListener('click', Util.guard(nextRound));
    var resets = Util.qa(screen, 'data-ch-reset');
    for (i = 0; i < resets.length; i++) resets[i].addEventListener('click', Util.guard(reset));
  }

  return {
    id: 'charades',
    title: '比手畫腳',
    init: bind,
    onEnter: onEnter,
    onLeave: onLeave
  };
})();

/* =================================================================
   遊戲三：猜歌名（只負責開啟外部歌單）
   ================================================================= */
var Playlists = (function () {
  var DATA_PATH = 'data/playlists.json';
  var screen, menu;
  var built = false;

  function build() {
    if (built) return;
    Util.loadJSON(DATA_PATH).then(function (list) {
      menu.innerHTML = '';
      list.forEach(function (item) {
        var btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.textContent = item.title;
        btn.addEventListener('click', Util.guard(function () {
          // 開啟對應 YouTube Music 歌單（網址由 JSON 維護）
          window.open(item.url, '_blank');
        }));
        menu.appendChild(btn);
      });
      built = true;
    }).catch(function (err) {
      menu.textContent = '讀取歌單失敗：' + err.message;
    });
  }

  function onEnter() {
    if (!screen) {
      screen = document.getElementById('screen-playlists');
      menu = Util.q(screen, 'data-pl-menu');
    }
    build();
  }

  return {
    id: 'playlists',
    title: '猜歌名',
    onEnter: onEnter
  };
})();

/* =================================================================
   註冊遊戲（首頁按鈕順序即此順序）
   ================================================================= */
GAMES.push(GuessPeople);
GAMES.push(Charades);
GAMES.push(Playlists);

/* =================================================================
   啟動
   ================================================================= */
function buildHomeMenu() {
  var menu = document.getElementById('home-menu');
  GAMES.forEach(function (game) {
    var btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = game.title;
    btn.addEventListener('click', function () { Router.go(game.id); });
    menu.appendChild(btn);
  });
}

function bindBackButtons() {
  // 所有帶 data-back 的按鈕都回首頁（不清進度）
  var backs = document.querySelectorAll('[data-back]');
  for (var i = 0; i < backs.length; i++) {
    backs[i].addEventListener('click', function () { Router.go('home'); });
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // 自動更新：偵測到新版 Service Worker 接管時自動重載一次，
  // 讓使用者「開一次 App 就換到最新版」，免手動移除重加。
  // 只有原本就有 SW 控制（＝是「更新」而非首次安裝）才重載，避免首次安裝多跳一次。
  if (navigator.serviceWorker.controller) {
    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }

  // 用相對路徑，GitHub Pages 子目錄也適用
  navigator.serviceWorker.register('service-worker.js').catch(function () {
    /* 註冊失敗不影響功能 */
  });
}

function showAppVersion() {
  var el = document.querySelector('[data-app-version]');
  if (el) el.textContent = '版本 ' + APP_VERSION;
}

window.addEventListener('DOMContentLoaded', function () {
  buildHomeMenu();
  showAppVersion();
  bindBackButtons();

  // 初始化各遊戲（綁定按鈕事件）
  GAMES.forEach(function (game) {
    if (game.init) game.init();
  });

  // 路由：hash 改變或首次載入
  window.addEventListener('hashchange', Router.apply);
  Router.apply();

  registerServiceWorker();

  // 切回前景時，若仍在遊戲中則重新取得螢幕鎖（切到背景會被系統自動釋放）
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') Util.wakeLock._acquire();
  });
});
