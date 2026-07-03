# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案性質

iPad 直式派對主持工具（PWA）。純 HTML / CSS / vanilla JavaScript（ES5 風格、`var`、IIFE 模組），**無框架、無建置步驟、無後端、無資料庫、無 npm**。目標是部署到 GitHub Pages（root），所有資源皆用相對路徑，才能在子目錄 `https://<user>.github.io/<repo>/` 下運作。

工具本身只負責：出題、洗牌、計時、顯示圖片／文字、開啟外部歌單。**比賽規則、計分、隊伍、人數一律不寫死**，由主持人自行處理——修改功能時請維持這個界線。

## 本機執行與測試

PWA 與 `fetch` JSON 需透過 http，**不能用 `file://` 雙擊開啟**。

```powershell
python -m http.server 8000   # 然後開 http://localhost:8000
```

無自動化測試、無 lint、無 CI，驗證方式是瀏覽器手動操作。Service worker 是 cache-first，改動 JS/CSS/JSON 後若看到舊版，需硬重新整理或在 DevTools 清 service worker 快取（見下）。

## 架構

單頁應用，全部邏輯集中在 `script.js`，採「遊戲註冊表（registry）」模式：

- **路由 `Router`**：用 URL hash（`#home` / `#guess-people` / `#charades` / `#playlists`）切換 `index.html` 內的 `<section class="screen">`，靠 `.active` class 顯示。**不重新載入頁面，所以返回不會清掉遊戲進度**。切換時會呼叫前一個遊戲的 `onLeave()`、新遊戲的 `onEnter()`。
- **`GAMES` 陣列 + `GameRegistry`**：每個遊戲是一個 IIFE 物件，含 `id` / `title`，選用 `init`（DOMContentLoaded 時綁按鈕事件一次）/ `onEnter` / `onLeave`。首頁按鈕依 `GAMES` 順序動態產生。
- **共用工具 `Util`**：`shuffle`（Fisher–Yates 原地）、`loadJSON`（附記憶體快取的 `fetch`）、`storage`（`localStorage` 包 try/catch，防 Safari 無痕模式拋錯讓 app 掛掉）、`confirmReset`、`beep`（Web Audio）、`vibrate`、`q`/`qa`（用 `data-*` 屬性在 section 範圍內找元素）。

DOM 綁定一律透過 `data-*` 屬性（如 `data-gp-start`、`data-ch-timer`）而非 id/class，`Util.q(screen, attr)` 在該遊戲的 section 內查找——新增元素時沿用這個慣例。

三個遊戲各自的存檔 key：`vpt:guessPeople`、`vpt:charades`（猜歌名無狀態）。存檔只記 `{ order:[洗牌後的原始index], idx, ... }`，題庫內容仍從 JSON 載入後用 index 對應。比手畫腳重新整理後**不自動續倒數**（計時不可靠），回到待機由主持人重按。

## 資料驅動：日常改題只改 JSON，不動 JS

| 檔案 | 格式 |
| --- | --- |
| `data/guess-people.json` | `["images/xxx.jpg", ...]`（**純檔名字串陣列**；只顯示圖片、無公布答案功能）。載入時 `normalize()` 仍相容舊格式 `[{ "name", "image" }]`，故不會因舊檔壞掉 |
| `data/charades.json` | `["哈士奇", "牙刷", ...]`（純字串陣列） |
| `data/playlists.json` | `[{ "title": "...", "url": "https://music.youtube.com/playlist?list=..." }, ...]` |

猜人名圖片放 `images/`（此資料夾專用於猜人名；圖示在獨立的 `icons/`）。**不必手打檔名**：把照片丟進 `images/` 後執行 `python tools/gen_guess_people.py`，它會掃描資料夾、對含空格/中文的檔名做 URL 編碼，重新產生 `data/guess-people.json`。`data/*.json` 走 network-first，改完 push 後重整即生效、不必動版本號。

## 新增第 4、5 個遊戲

1. 在 `index.html` 新增 `<section class="screen" id="screen-你的id">`（沿用 lobby/play/done 的 `.hidden` 分區 + `data-*` 慣例）。
2. 在 `script.js` 寫一個 IIFE 遊戲模組物件（至少 `id`、`title`，視需要 `init`/`onEnter`/`onLeave`）。
3. `GAMES.push(你的模組);`——首頁自動多一顆按鈕。
4. 若要離線可用，把新的靜態檔加進 `service-worker.js` 的 `PRECACHE_URLS`。

核心路由不需更動。

## Service worker 與快取

`service-worker.js`：install 時 precache `PRECACHE_URLS`（HTML/CSS/JS/JSON/icons）。fetch 策略為**混合式**：`data/*.json` 走 **network-first**（先連網抓最新並更新快取、離線才回舊快取，讓「改完 JSON 重整即生效」成立），其餘靜態檔與圖片走 **cache-first**（圖片第一次連網後即離線可用）。**改動被 cache-first 快取的檔案（HTML/CSS/JS/圖片）後，若要強制使用者端重建快取，把 `CACHE_VERSION`（目前 `vpt-v3`）改成新值**，activate 會清掉舊版快取。

## 部署與更新疑難排解（GitHub Pages）

部署方式：push 到 `main`（root），GitHub Pages 自動 build + deploy。網址 `https://ziyi1114-bot.github.io/vip-party-tool/`。

- **改了 JS/CSS/HTML 一定要把 `service-worker.js` 的 `CACHE_VERSION` 加一號**（`vpt-v4`→`vpt-v5`…），否則已安裝的裝置會被 cache-first 卡在舊版。改 `data/*.json` 不用（network-first）。
- **發版時同步把 `script.js` 的 `APP_VERSION` 一起 +1**（與 `CACHE_VERSION` 對齊，例如 `v5` ↔ `vpt-v5`）。`APP_VERSION` 會顯示在首頁底部，讓使用者確認裝置吃到哪一版。
- **自動更新**：`registerServiceWorker()` 監聽 `controllerchange`，偵測到新版 SW 接管時自動 `location.reload()` 一次（僅在原本就有 SW 控制時，避免首次安裝多跳一次）。搭配 SW 的 `skipWaiting()`+`clients.claim()`，使用者**開一次 App 就會自動換到最新版**，不必再手動移除重加。
- **「推上去卻沒更新」先看 Actions 分頁**：Pages 的「pages build and deployment」有 `build` 與 `deploy` 兩段。曾發生 **build 成功、deploy 失敗**，此時 Pages 保留上一次成功版本、線上不會變。處理：到 Actions 對該筆按 **Re-run failed jobs**，或推一個（可空的）commit 重新觸發即可。
- **deploy 步驟失敗（訊息只顯示通用的 `Deployment failed, try again later.`）常見真兇是檔名**：`images/` 內含**空格、中文、或結尾空格**的檔名會讓 Pages 的 deploy 後端失敗（build 仍會過）。已由 `tools/gen_guess_people.py` 自動就地改名成安全 ASCII 名解決——新增圖片後務必跑一次產生器再 push，別手動塞怪檔名進 `images/`。用 `curl` 抓 `https://.../service-worker.js` 看 `CACHE_VERSION` 可快速判斷線上實際版本；用 `raw.githubusercontent.com/.../main/...` 則是看 repo（繞過 Pages CDN）。
- **iOS 已加入主畫面的 PWA 不會「一次重整」就更新**：標準行為是第一次開觸發下載新 SW、第二次開才生效；standalone 沒有重整鈕，最可靠是「從多工切換器關掉再開（兩次）」，或**移除主畫面圖示重新加入**（保證最新，只會清掉 localStorage 進度）。
