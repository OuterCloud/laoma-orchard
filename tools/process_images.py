#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
老马苹果园 —— 照片管线（整批）

从原始手机照片（~/Downloads/老马苹果园）产出 Astro 工程真正使用的图片：

  src/assets/photos/*.jpg  调色后的整图，交给 Astro 生成响应式尺寸与格式
  src/assets/crops/*.jpg   预裁图（首屏 / 宽幅）

为什么需要预裁：原片是竖幅 1279x1706，首屏和宽幅区块要横构图；
Astro 的 <Image> 只能对整图按比例缩放，没法按版式换取景，所以这几张在这里裁好。

只改首屏选片的话，用 tools/make_hero.py 更快（不用跑整批）。

用法：pnpm photos       （等价于 python3 tools/process_images.py）
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = Path.home() / "Downloads" / "老马苹果园"
META = ROOT / "tools" / "photos.json"
PHOTOS_OUT = ROOT / "src" / "assets" / "photos"
CROPS_OUT = ROOT / "src" / "assets" / "crops"

# ---------------------------------------------------------------- 调色参数
# 这批照片是逆光手机拍摄：整体发灰、通透度不足，套袋反光强。
# 参数是逐张核对出来的，改动前请重新核对整组照片。
GRADE = dict(
    autocontrast_cut=1,       # 自动色阶裁切的极端像素比例
    contrast=1.13,            # 对比度
    color=1.16,               # 饱和度（还原果实粉红）
    brightness=1.06,          # 整体提亮
    shadow_lift=0.13,         # 暗部抬升，找回树冠内部细节
    shadow_pivot=105,         # 暗部抬升的作用上限
    warmth=1.012,             # 极轻微暖调（红通道）
    cool=0.994,               # 极轻微冷调（蓝通道）
    sharpen_radius=1.6,
    sharpen_percent=115,
    sharpen_threshold=3,
)

# ---------------------------------------------------------------- 尺寸规格
# 原图仅 1279x1706，放大倍率控制在 1.6x 以内以保住清晰度。
PHOTO_SIZE = (1150, 1438)   # 整图 4:5（Astro 从这里再生成各档尺寸）
HERO = (1920, 1080)         # 首屏横版 16:9（桌面）
HERO_TALL = (1100, 1650)    # 首屏竖版 2:3（手机，竖幅原图几乎不裁切）
WIDE = (1600, 1000)         # 宽幅区块 16:10
WIDE_TALL = (1000, 1250)    # 竖幅宽块 4:5

QUALITY = dict(photo=80, hero=80, wide=78)


def grade(im: Image.Image) -> Image.Image:
    """对单张照片做统一的、克制的调色。不做任何改变事实的修饰。"""
    im = ImageOps.exif_transpose(im).convert("RGB")

    im = ImageOps.autocontrast(im, cutoff=GRADE["autocontrast_cut"])
    im = ImageEnhance.Contrast(im).enhance(GRADE["contrast"])
    im = ImageEnhance.Color(im).enhance(GRADE["color"])
    im = ImageEnhance.Brightness(im).enhance(GRADE["brightness"])

    # 暗部抬升：out = in + k * (1 - in/pivot) * in
    pivot, k = GRADE["shadow_pivot"], GRADE["shadow_lift"]
    lut = [
        min(255, int(round(v + (k * (1.0 - v / pivot) * v if v < pivot else 0.0))))
        for v in range(256)
    ]
    im = im.point(lut * 3)

    # 白平衡微调
    r, g, b = im.split()
    r = r.point(lambda v: min(255, int(v * GRADE["warmth"])))
    b = b.point(lambda v: min(255, int(v * GRADE["cool"])))
    im = Image.merge("RGB", (r, g, b))

    # 锐化（带阈值，避免放大噪点与套袋反光的死白边缘）
    return im.filter(
        ImageFilter.UnsharpMask(
            radius=GRADE["sharpen_radius"],
            percent=GRADE["sharpen_percent"],
            threshold=GRADE["sharpen_threshold"],
        )
    )


def cover(im: Image.Image, size: tuple[int, int], focus: float = 0.5) -> Image.Image:
    """按 cover 方式裁切缩放；focus 是纵向取景位置（0 顶 1 底）。"""
    tw, th = size
    sw, sh = im.size
    scale = max(tw / sw, th / sh)
    nw, nh = max(tw, int(round(sw * scale))), max(th, int(round(sh * scale)))
    im = im.resize((nw, nh), Image.LANCZOS)
    left = (nw - tw) // 2
    top = int(round((nh - th) * focus))
    return im.crop((left, top, left + tw, top + th))


def save(im: Image.Image, path: Path, quality: int) -> tuple[int, int]:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "JPEG", quality=quality, optimize=True, progressive=True)
    return im.size


def kb(p: Path) -> str:
    return f"{p.stat().st_size / 1024:.0f} KB"


def main() -> None:
    photos = json.loads(META.read_text("utf-8"))["photos"]
    hero_cfg = json.loads((ROOT / "src" / "data" / "hero.json").read_text("utf-8"))

    # 整批重来，避免残留已删除的照片
    for d in (PHOTOS_OUT, CROPS_OUT):
        if d.exists():
            shutil.rmtree(d)

    print(f"原片目录：{SRC_DIR}\n")

    for slug, info in photos.items():
        src = SRC_DIR / info["file"]
        if not src.exists():
            raise SystemExit(f"✗ 缺少源文件：{src}")

        im = grade(Image.open(src))
        focus = info.get("focus", 0.5)

        # 1) 整图（Astro 的输入）
        out = PHOTOS_OUT / f"{slug}.jpg"
        save(cover(im, PHOTO_SIZE, focus), out, QUALITY["photo"])
        print(f"  ✓ photos/{slug}.jpg".ljust(46) + kb(out))

        # 2) 宽幅预裁
        if info.get("wide"):
            size = WIDE_TALL if info.get("wide_vertical") else WIDE
            out = CROPS_OUT / f"wide-{slug}.jpg"
            save(cover(im, size, focus), out, QUALITY["wide"])
            print(f"  ✓ crops/wide-{slug}.jpg".ljust(46) + kb(out))

    # 3) 首屏（来源由 src/data/hero.json 决定，可能与上面不同）
    if hero_cfg["from"] not in photos:
        raise SystemExit(f"✗ hero.json 里的 from='{hero_cfg['from']}' 不在 tools/photos.json 中")
    hero_src = SRC_DIR / photos[hero_cfg["from"]]["file"]
    hero_im = grade(Image.open(hero_src))
    hf = hero_cfg.get("focus", 0.5)

    print()
    for name, size in (("hero", HERO), ("hero-tall", HERO_TALL)):
        out = CROPS_OUT / f"{name}.jpg"
        save(cover(hero_im, size, hf), out, QUALITY["hero"])
        print(f"  ✓ crops/{name}.jpg".ljust(46) + kb(out))

    print(
        f"\n首屏来源：{hero_cfg['from']}（focus={hf}）"
        f"\n整图 {len(photos)} 张 → src/assets/photos/"
        f"\n预裁 → src/assets/crops/"
        f"\n\n下一步：pnpm build（Astro 会据此生成各档响应式尺寸与 avif/webp）"
    )


if __name__ == "__main__":
    main()
