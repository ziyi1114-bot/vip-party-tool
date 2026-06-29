# VIP Party Tool

iPad 派對主持工具（PWA）。純 HTML / CSS / JavaScript，無框架、無後端、無資料庫，可直接部署到 GitHub Pages。

工具只負責：**出題、洗牌、計時、顯示圖片或文字、開啟歌單**。比賽規則與計分由主持人自行處理（不寫死隊伍、人數、比分）。

## 三個遊戲

1. **猜人名** — 依 `data/guess-people.json` 洗牌出題，只顯示人物圖片（`name` 僅作 JSON 內部備註，畫面不顯示），記憶進度可續玩。
2. **比手畫腳** — 依 `data/charades.json` 洗牌出題，可設定秒數、倒數計時、答對／PASS、時間到顯示總結（含提示音與震動）。
3. **猜歌名** — 依 `data/playlists.json` 產生歌單按鈕，點擊開啟對應 YouTube Music 歌單。

## 我之後只要改 JSON（不用改 JS）

| 檔案 | 格式 |
| --- | --- |
| `data/guess-people.json` | `[{ "name": "周杰倫", "image": "images/jay.jpg" }, ...]` |
| `data/charades.json` | `["哈士奇", "牙刷", ...]` |
| `data/playlists.json` | `[{ "title": "KPOP", "url": "https://music.youtube.com/playlist?list=..." }, ...]` |

- 猜人名的圖片放在 `images/` 資料夾，檔名要與 JSON 的 `image` 欄位一致。
- 改完 JSON 後，若 PWA 已快取舊版，重新整理一次即可（service worker 會把新 JSON 寫入快取）。

## 本機測試

PWA 與讀取 JSON 需要透過 http（**不能**直接用 `file://` 雙擊開啟）。在專案資料夾啟動一個簡單伺服器：

```powershell
# 需要 Python
python -m http.server 8000
```

然後瀏覽器開 `http://localhost:8000`。

## 部署到 GitHub Pages

1. 把整個資料夾推到 GitHub repo。
2. repo → **Settings → Pages** → Source 選 `Deploy from a branch`，branch 選 `main`、資料夾選 `/ (root)`。
3. 等幾分鐘後即可用 `https://<帳號>.github.io/<repo>/` 開啟。
4. 在 iPad Safari 開啟該網址 → 分享 → **加入主畫面**，即可全螢幕直式使用。

所有路徑皆為相對路徑，部署在子目錄下也能正常運作。

## 如何新增第 4、第 5 個遊戲

架構採「遊戲註冊表」模式，新增遊戲不需改動核心路由：

1. 在 `index.html` 新增一個 `<section class="screen" id="screen-你的id">`。
2. 在 `script.js` 寫一個遊戲模組物件（至少含 `id`、`title`，視需要 `init` / `onEnter` / `onLeave`）。
3. `GAMES.push(你的模組);` —— 首頁會自動多一顆按鈕。

## 圖示

`icons/` 內為佔位圖示（純色底 + 「VIP」字樣）。可自行替換為同尺寸（180 / 192 / 512）的 PNG。
