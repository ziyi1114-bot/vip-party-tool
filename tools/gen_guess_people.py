#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
掃描 images/ 資料夾，自動產生 data/guess-people.json。

用法（在專案根目錄執行）：
    python tools/gen_guess_people.py

主持人日常流程：把照片丟進 images/ → 跑這行 → git commit / push。
不必手打任何檔名，也不必維護名字對照（畫面只顯示圖片）。

輸出格式為純檔名陣列（相對路徑，供 GitHub Pages 子目錄使用）：
    ["images/xxx.jpg", "images/yyy.jpg", ...]

重要：GitHub Pages 的部署後端對含空格、中文、或結尾空格的檔名會失敗
（build 會過但 deploy 掛掉）。因此本工具會先把「不安全」的檔名
就地改名成安全的 ASCII 檔名（只留 A-Z a-z 0-9 . _ -），再產生清單，
讓「隨便丟圖」都不會卡部署。
"""

import json
import os
import re
import sys
from urllib.parse import quote

# Windows 主控台預設可能是 cp950，印出含特殊字元的舊檔名會 UnicodeEncodeError。
# 改用 UTF-8 並對無法編碼者以替代字元輸出，避免因「印報告」而崩潰。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# 支援的圖片副檔名（小寫比對）。.jfif/.jpe 都是 JPEG 變體，瀏覽器可正常顯示
IMAGE_EXTS = {".jpg", ".jpeg", ".jpe", ".jfif", ".png", ".gif", ".webp"}

# 安全檔名：只允許 ASCII 英數與 . _ - （GitHub Pages 部署後端可靠支援）
SAFE_STEM_RE = re.compile(r"[^A-Za-z0-9._-]")

# 專案根目錄 = 本檔案的上一層
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES_DIR = os.path.join(ROOT, "images")
OUTPUT = os.path.join(ROOT, "data", "guess-people.json")


def safe_name(name):
    """把單一檔名轉成安全 ASCII 名（保留副檔名）。已安全者原樣回傳。"""
    stem, ext = os.path.splitext(name)
    ext = ext.lower()
    # 非允許字元（空白、中文…）一律換成底線，再收斂多餘的底線與前後雜點
    stem = SAFE_STEM_RE.sub("_", stem)
    stem = re.sub(r"_+", "_", stem).strip("._-")
    if not stem:
        stem = "img"
    return stem + ext


def sanitize_dir(names):
    """就地改名不安全的檔案，回傳（最終要收錄的）安全檔名清單。"""
    existing = set(names)          # 目前資料夾內所有圖片檔名
    result = []
    renamed = []
    for name in names:
        target = safe_name(name)
        if target == name:
            result.append(name)
            continue
        # 處理改名衝突：若 target 已存在，補上 -1 / -2 …
        if target in existing and target != name:
            stem, ext = os.path.splitext(target)
            n = 1
            while (stem + "-" + str(n) + ext) in existing:
                n += 1
            target = stem + "-" + str(n) + ext
        os.rename(os.path.join(IMAGES_DIR, name),
                  os.path.join(IMAGES_DIR, target))
        existing.discard(name)
        existing.add(target)
        renamed.append((name, target))
        result.append(target)
    return result, renamed


def main():
    if not os.path.isdir(IMAGES_DIR):
        print("找不到 images/ 資料夾：" + IMAGES_DIR)
        sys.exit(1)

    names = []
    for name in os.listdir(IMAGES_DIR):
        # 略過隱藏檔（. 開頭）與非檔案
        if name.startswith("."):
            continue
        if not os.path.isfile(os.path.join(IMAGES_DIR, name)):
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext not in IMAGE_EXTS:
            continue
        names.append(name)

    # 先把不安全的檔名就地改名，避免 GitHub Pages 部署失敗
    names, renamed = sanitize_dir(names)

    # 依檔名排序，讓輸出穩定
    names.sort()

    # 檔名此時已是安全 ASCII；quote 對安全字元不會改動（保險起見仍套）
    paths = ["images/" + quote(name) for name in names]

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(paths, f, ensure_ascii=False, indent=2)
        f.write("\n")

    if renamed:
        print("已將 " + str(len(renamed)) + " 個不安全檔名改名（避免部署失敗）：")
        for old, new in renamed:
            print("  " + old + "  ->  " + new)
    print("已寫入 " + os.path.relpath(OUTPUT, ROOT) + "，共 " + str(len(paths)) + " 張圖片。")
    if not paths:
        print("（提醒：images/ 內目前沒有圖片，請先把照片丟進去。）")


if __name__ == "__main__":
    main()
