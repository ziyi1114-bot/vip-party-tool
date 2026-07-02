/* =================================================================
   VIP Party Tool — service-worker.js
   策略：
   - install：precache 核心靜態資源（HTML/CSS/JS/JSON/icons）
   - fetch：
       · data/*.json → network-first（先連網抓最新並更新快取，
         離線才回舊快取）→ 讓「改完 JSON 重整即生效」成立
       · 其餘 → cache-first（先找快取，沒有再連網並寫入快取）
         → 讓圖片 (images/) 第一次連網後即可離線使用
   - activate：清除舊版本快取
   更新版本時：把 CACHE_VERSION 改成新數字即可讓快取重建。
   ================================================================= */

var CACHE_VERSION = 'vpt-v3';

// 安裝時要預先快取的核心檔案（相對路徑，GitHub Pages 子目錄也適用）
var PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './data/guess-people.json',
  './data/charades.json',
  './data/playlists.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // 個別加入，單一檔案失敗不會讓整體安裝失敗
      return Promise.all(PRECACHE_URLS.map(function (url) {
        return cache.add(url).catch(function () { /* 忽略缺檔 */ });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_VERSION) return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// 把成功的回應複製一份寫入快取（只快取自家同源、200 的資源）
function putInCache(req, res) {
  if (res && res.status === 200 && res.type === 'basic') {
    var clone = res.clone();
    caches.open(CACHE_VERSION).then(function (cache) {
      cache.put(req, clone);
    });
  }
}

// data/ 底下的 .json 用 network-first；其餘 cache-first
function isDataJSON(url) {
  return /\/data\/[^/]+\.json(\?.*)?$/.test(url);
}

self.addEventListener('fetch', function (event) {
  var req = event.request;

  // 只處理 GET
  if (req.method !== 'GET') return;

  // network-first：題庫 JSON 先連網抓最新，離線才回舊快取
  if (isDataJSON(req.url)) {
    event.respondWith(
      fetch(req).then(function (res) {
        putInCache(req, res);
        return res;
      }).catch(function () {
        return caches.match(req);
      })
    );
    return;
  }

  // cache-first：其餘靜態資源與圖片
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;

      return fetch(req).then(function (res) {
        putInCache(req, res);
        return res;
      }).catch(function () {
        // 離線且無快取：導覽請求回首頁，其它就讓它失敗
        if (req.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
