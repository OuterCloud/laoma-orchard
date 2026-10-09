#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
只重做首屏裁切（不跑整条管线）。

用法：python3 tools/make_hero.py
改 src/data/hero.json 里的源文件 slug / 取景后运行即可。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from PIL import Image
from process_images import HERO, HERO_TALL, cover, grade  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = Path.home() / "Downloads" / "老马苹果园"
OUT = ROOT / "src" / "assets" / "crops"

cfg = json.loads((ROOT / "src" / "data" / "hero.json").read_text("utf-8"))
meta = json.loads((ROOT / "tools" / "photos.json").read_text("utf-8"))["photos"]
src = SRC_DIR / meta[cfg["from"]]["file"]

im = grade(Image.open(src))
focus = cfg.get("focus", 0.5)

for name, size, quality in (("hero", HERO, 80), ("hero-tall", HERO_TALL, 80)):
    out = OUT / f"{name}.jpg"
    cover(im, size, focus).save(out, "JPEG", quality=quality, optimize=True, progressive=True)
    print(f"  ✓ {out.relative_to(ROOT)}  {size[0]}x{size[1]}  "
          f"{out.stat().st_size / 1024:.0f} KB")

print(f"\n首屏来源：{cfg['from']} -> {meta[cfg['from']]['file']}")
print(f"取景 focus={focus}（0=顶部 1=底部）")
