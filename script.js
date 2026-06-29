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

  /* 簡單提示音（Web Audio），用於比手畫腳時間到 */
  beep: function () {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      gain.gain.value = 0.2;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      // 響 0.6 秒後關閉
      setTimeout(function () {
        osc.stop();
        ctx.close();
      }, 600);
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

  var people = [];     // 原始題庫（含 name/image）
  var screen, dom = {}; // DOM 參照
  var state = null;     // { order:[原始index...], idx:Number }

  function cacheDom() {
    screen = document.getElementById('screen-guess-people');
    dom.lobby   = Util.q(screen, 'data-gp-lobby');
    dom.play    = Util.q(screen, 'data-gp-play');
    dom.done    = Util.q(screen, 'data-gp-done');
    dom.counter = Util.q(screen, 'data-gp-counter');
    dom.image   = Util.q(screen, 'data-gp-image');
  }

  // 顯示三個區塊其中之一
  function showPhase(phase) {
    dom.lobby.classList.toggle('hidden', phase !== 'lobby');
    dom.play.classList.toggle('hidden', phase !== 'play');
    dom.done.classList.toggle('hidden', phase !== 'done');
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
    // 只更新 img.src（不重建節點），符合效能要求
    dom.image.src = person.image;
    dom.image.alt = '人物圖片';

    var remain = state.order.length - state.idx;
    dom.counter.textContent = '剩餘題數：' + remain;

    // 預載下一張，讓「下一題」更順
    preloadNext();
  }

  function preloadNext() {
    var nextIdx = state.idx + 1;
    if (nextIdx < state.order.length) {
      var img = new Image();
      img.src = people[state.order[nextIdx]].image;
    }
  }

  // 開始遊戲：載入題庫 → 洗牌 → 存檔 → 渲染
  function start() {
    Util.loadJSON(DATA_PATH).then(function (data) {
      people = data;
      var order = [];
      for (var i = 0; i < people.length; i++) order.push(i);
      Util.shuffle(order);
      state = { order: order, idx: 0 };
      Util.storage.set(KEY, state);
      render();
    }).catch(function (err) {
      alert('讀取題庫失敗：' + err.message);
    });
  }

  function next() {
    if (!state) return;
    state.idx++;
    Util.storage.set(KEY, state);
    render();
  }

  function reset() {
    if (!Util.confirmReset()) return;
    Util.storage.remove(KEY);
    state = null;
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
        render();
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
    for (i = 0; i < starts.length; i++) starts[i].addEventListener('click', start);
    var nexts = Util.qa(screen, 'data-gp-next');
    for (i = 0; i < nexts.length; i++) nexts[i].addEventListener('click', next);
    var resets = Util.qa(screen, 'data-gp-reset');
    for (i = 0; i < resets.length; i++) resets[i].addEventListener('click', reset);
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

  // 開始一個回合（沿用目前 state.idx，答對歸零、倒數重開）
  function beginRound() {
    if (state.idx >= state.order.length) {
      showPhase('done');
      return;
    }
    state.correct = 0;
    Util.storage.set(KEY, state);
    remainingTime = state.seconds;
    lockButtons(false);
    showPhase('play');
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
    for (i = 0; i < starts.length; i++) starts[i].addEventListener('click', start);
    dom.correctBtn.addEventListener('click', answerCorrect);
    dom.passBtn.addEventListener('click', pass);
    var nr = Util.qa(screen, 'data-ch-nextround');
    for (i = 0; i < nr.length; i++) nr[i].addEventListener('click', nextRound);
    var resets = Util.qa(screen, 'data-ch-reset');
    for (i = 0; i < resets.length; i++) resets[i].addEventListener('click', reset);
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
        btn.addEventListener('click', function () {
          // 開啟對應 YouTube Music 歌單（網址由 JSON 維護）
          window.open(item.url, '_blank');
        });
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
  if ('serviceWorker' in navigator) {
    // 用相對路徑，GitHub Pages 子目錄也適用
    navigator.serviceWorker.register('service-worker.js').catch(function () {
      /* 註冊失敗不影響功能 */
    });
  }
}

window.addEventListener('DOMContentLoaded', function () {
  buildHomeMenu();
  bindBackButtons();

  // 初始化各遊戲（綁定按鈕事件）
  GAMES.forEach(function (game) {
    if (game.init) game.init();
  });

  // 路由：hash 改變或首次載入
  window.addEventListener('hashchange', Router.apply);
  Router.apply();

  registerServiceWorker();
});
