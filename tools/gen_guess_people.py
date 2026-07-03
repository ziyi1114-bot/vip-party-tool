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

檔名中的空格、中文等字元會做 URL 編碼，否則瀏覽器 img.src 會抓不到。
"""

import json
import os
import sys
from urllib.parse import quote

# 支援的圖片副檔名（小寫比對）。.jfif/.jpe 都是 JPEG 變體，瀏覽器可正常顯示
IMAGE_EXTS = {".jpg", ".jpeg", ".jpe", ".jfif", ".png", ".gif", ".webp"}

# 專案根目錄 = 本檔案的上一層
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES_DIR = os.path.join(ROOT, "images")
OUTPUT = os.path.join(ROOT, "data", "guess-people.json")


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

    # 依檔名排序，讓輸出穩定
    names.sort()

    # 只對檔名做 URL 編碼，保留路徑分隔的斜線
    paths = ["images/" + quote(name) for name in names]

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(paths, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("已寫入 " + os.path.relpath(OUTPUT, ROOT) + "，共 " + str(len(paths)) + " 張圖片。")
    if not paths:
        print("（提醒：images/ 內目前沒有圖片，請先把照片丟進去。）")


if __name__ == "__main__":
    main()
