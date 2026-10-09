#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信二维码处理。

原图是「微信个人名片」截图：头像 + 昵称 + 二维码 + 提示文字，二维码中间还压着微信 logo。
名片信息由页面用文字呈现，所以这里只需要精确裁出二维码本身。

裁切边界不靠眼估、也不靠「深色像素包围盒」（那样会把头像和昵称一起框进去），
而是检测二维码三个角上的**定位图形**（1:1:3:1:1 的方块），
用它们的中心反推码的范围与模块尺寸，再按规范补足静区。

输出 PNG 而非 JPEG：二维码最怕压缩伪影，糊一点就可能扫不出来。

用法：python3 tools/make_qr.py [--debug]
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = Path.home() / "Downloads" / "老马苹果园" / "微信二维码.jpg"
OUT = ROOT / "src" / "assets" / "wechat-qr.png"

TARGET = 880          # 输出边长；页面显示约 180 CSS px，给足余量
QUIET_MODULES = 4     # 二维码规范要求的静区宽度（模块数）
BOTTOM_SAFETY_PX = 3      # 与下方提示文字之间至少留的余量（像素）
RATIO_TOL = 0.55      # 1:1:3:1:1 的比例容差
MIN_MODULE_PX = 1.5   # 比这更小的「模块」不可能是真的


def otsu(gray: Image.Image) -> int:
    hist = gray.histogram()
    total = sum(hist)
    sum_all = sum(i * hist[i] for i in range(256))
    sum_b = 0.0
    w_b = 0
    best, thresh = -1.0, 128
    for i in range(256):
        w_b += hist[i]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += i * hist[i]
        m_b = sum_b / w_b
        m_f = (sum_all - sum_b) / w_f
        var = w_b * w_f * (m_b - m_f) ** 2
        if var > best:
            best, thresh = var, i
    return thresh


def encode_runs(seq: list[bool]) -> tuple[list[int], list[int], list[bool]]:
    """
    一维游程编码。
    返回 (起点列表, 长度列表, 每段的颜色)。
    先编好整行整列，再做模式匹配——比在窗口里现取游程可靠得多。
    """
    starts: list[int] = []
    lengths: list[int] = []
    colors: list[bool] = []
    n = len(seq)
    i = 0
    while i < n:
        j = i
        while j < n and seq[j] == seq[i]:
            j += 1
        starts.append(i)
        lengths.append(j - i)
        colors.append(seq[i])
        i = j
    return starts, lengths, colors


def check_ratio(seg: list[int], tol: float = RATIO_TOL) -> float | None:
    """校验 5 段是否满足 1:1:3:1:1，通过则返回单元宽度。"""
    if len(seg) != 5:
        return None
    unit = (seg[0] + seg[1] + seg[3] + seg[4]) / 4
    if unit < MIN_MODULE_PX:
        return None
    t = unit * tol
    if any(abs(seg[k] - unit) > t for k in (0, 1, 3, 4)):
        return None
    if not (2.0 * unit <= seg[2] <= 4.0 * unit):
        return None
    return unit


def finders_1d(
    starts: list[int], lengths: list[int], colors: list[bool]
) -> list[tuple[int, int, float]]:
    """
    在一条已编码的扫描线上找定位图形。
    返回 [(中心坐标, 第五段结束坐标, 单元宽度)]，
    即模式应为 深-浅-深-浅-深，中心落在第 3 段（索引 2）。
    """
    hits: list[tuple[int, int, float]] = []
    for k in range(len(lengths) - 4):
        if not colors[k]:          # 必须从深色段开始
            continue
        if colors[k + 1] or not colors[k + 2] or colors[k + 3] or not colors[k + 4]:
            continue
        unit = check_ratio(lengths[k : k + 5])
        if unit is None:
            continue
        center = starts[k + 2] + lengths[k + 2] // 2
        hits.append((center, starts[k + 4] + lengths[k + 4], unit))
    return hits


def cluster(points: list[tuple[int, int, float]]) -> list[tuple[int, int, float, int]]:
    """把多行/多列命中的同一定位图形合并；返回 (cx, cy, unit, 命中次数)。"""
    groups: list[list[tuple[int, int, float]]] = []
    for p in points:
        for g in groups:
            gx = sum(q[0] for q in g) / len(g)
            gy = sum(q[1] for q in g) / len(g)
            if abs(p[0] - gx) < 12 and abs(p[1] - gy) < 12:
                g.append(p)
                break
        else:
            groups.append([p])
    merged = []
    for g in groups:
        merged.append(
            (
                int(round(sum(q[0] for q in g) / len(g))),
                int(round(sum(q[1] for q in g) / len(g))),
                sum(q[2] for q in g) / len(g),
                len(g),
            )
        )
    return merged


def main() -> None:
    debug = "--debug" in sys.argv
    if not SRC.exists():
        raise SystemExit(f"✗ 找不到二维码原图：{SRC}")

    src = Image.open(SRC).convert("RGB")
    gray = src.convert("L")
    w, h = gray.size
    thresh = otsu(gray)
    px = gray.load()
    mask = [[px[x, y] < thresh for x in range(w)] for y in range(h)]
    dark_ratio = sum(r.count(True) for r in mask) / (w * h)
    print(f"  原图 {w}x{h}，Otsu 阈值 {thresh}，深色像素占比 {dark_ratio:.1%}")

    # 逐行找，得到 (x, y, unit)
    row_hits: list[tuple[int, int, float]] = []
    for y in range(h):
        for cx, _end, unit in finders_1d(*encode_runs(mask[y])):
            row_hits.append((cx, y, unit))

    # 逐列找，得到 (x, y, unit)
    col_hits: list[tuple[int, int, float]] = []
    for x in range(w):
        col = [mask[y][x] for y in range(h)]
        for cy, _end, unit in finders_1d(*encode_runs(col)):
            col_hits.append((x, cy, unit))

    print(f"  逐行命中 {len(row_hits)} 次，逐列命中 {len(col_hits)} 次")

    # 定位图形必须同时通过横向与纵向校验
    combined: list[tuple[int, int, float]] = []
    for rx, ry, ru in row_hits:
        for cx, cy, cu in col_hits:
            if abs(rx - cx) <= 4 and abs(ry - cy) <= 4:
                combined.append(((rx + cx) // 2, (ry + cy) // 2, (ru + cu) / 2))
    print(f"  横纵交叉校验后：{len(combined)} 次命中")

    cands = [c for c in cluster(combined) if c[3] >= 3]
    cands.sort(key=lambda c: -c[3])
    print(f"  定位图形候选：{len(cands)} 个")
    for i, (cx, cy, u, n) in enumerate(cands[:6]):
        print(f"    #{i + 1} 中心 ({cx}, {cy})  模块 {u:.1f}px  命中 {n}")

    if len(cands) < 3:
        raise SystemExit(
            "\n✗ 未找到 3 个定位图形，无法可靠裁切二维码。\n"
            "  请换一张更清晰的二维码原图（建议直接从微信「保存图片」，不要转发压缩）。\n"
        )

    # 选三个：模块尺寸接近，且两两距离足够远（避免把同一图形的偏移当两个）
    unit = cands[0][2]
    picked: list[tuple[int, int, float, int]] = []
    for c in cands:
        if abs(c[2] - unit) / unit > 0.35:
            continue
        if all((c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 > (6 * unit) ** 2 for p in picked):
            picked.append(c)
        if len(picked) == 3:
            break
    if len(picked) < 3:
        picked = cands[:3]
    print(f"  选定 {len(picked)} 个定位图形，模块尺寸 {unit:.1f}px")

    unit = sum(c[2] for c in picked) / len(picked)
    xs = [c[0] for c in picked]
    ys = [c[1] for c in picked]

    # 三个定位图形中心围成的正方形边长 = (N - 7) * unit，N 为模块数。
    # QR 规范的 N 必须是 21 + 4k（21/25/29/33/37…），所以先按边长估 N，
    # 再吸附到最近合法值，然后反解 module —— 这样能消掉游程取整带来的 ±1px 偏差。
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    est = round(span / unit) + 7
    modules = min((n for n in range(21, 178, 4)), key=lambda n: abs(n - est))
    unit = span / (modules - 7)
    print(f"  估计模块数 {est} → 吸附到合法值 {modules}x{modules}，校正后模块尺寸 {unit:.2f}px")

    # 定位图形中心 → 码边界，各方向外扩 3.5 个模块
    half = 3.5 * unit
    l, t = int(round(min(xs) - half)), int(round(min(ys) - half))
    r, b = int(round(max(xs) + half)), int(round(max(ys) + half))
    print(f"  码范围 x {l}..{r}  y {t}..{b}  （{r - l}x{b - t}）")

    # 静区：规范要求 ≥4 个模块。同时以「该边到画面边缘的余量」为上限，避免越界。
    want = int(round(unit * QUIET_MODULES))
    quiet = {
        "left": min(want, l),
        "top": min(want, t),
        "right": min(want, w - r),
        "bottom": min(want, h - b),
    }
    # 名片上二维码正下方紧跟着「扫二维码，添加我为朋友」一行字（实测起于 y≈747，
    # 而码的底边在 y≈698），可用白边只有约 49px。留一点余量，避免贴到文字上。
    bottom_room = h - b
    if bottom_room > 0:
        quiet["bottom"] = min(quiet["bottom"], max(0, bottom_room - BOTTOM_SAFETY_PX))
    # 四边取相同宽度，成品才对称
    q = min(quiet.values())
    quiet = {k: q for k in quiet}

    box = (l - quiet["left"], t - quiet["top"], r + quiet["right"], b + quiet["bottom"])
    crop = src.crop(box)
    print(
        f"  含静区裁切 {crop.size[0]}x{crop.size[1]}"
        f"（四边静区 {q}px ≈ {q / unit:.1f} 模块）"
    )
    if q < unit * 3:
        print("  ⚠ 静区不足 3 个模块，可能影响扫码成功率")

    # 把静区显式刷成纯白。
    # 原始名片是 JPEG，码下方的文字会在邻近像素上留下振铃；静区本来就该是纯白，
    # 刷白只是去掉噪点，不触碰任何码模块。
    cpx_ = crop.load()
    for y in range(crop.size[1]):
        for x in range(crop.size[0]):
            if x < q or x >= crop.size[0] - q or y < q or y >= crop.size[1] - q:
                cpx_[x, y] = (255, 255, 255)

    if debug:
        dbg = ROOT / ".verify"
        dbg.mkdir(exist_ok=True)
        crop.save(dbg / "qr-crop-raw.png")
        print("  [debug] 裁切原样保存到 .verify/qr-crop-raw.png")

    # ── 自检①：静区必须是纯白 ──
    # 在「裁切原样」上按静区实际的像素宽度检查（不是按成品外框的比例，
    # 否则会检查到码本身的模块上）。
    qmin = min(quiet.values())
    g = crop.convert("L")
    gp = g.load()
    dirty = 0
    for y in range(g.size[1]):
        for x in range(g.size[0]):
            if (x < qmin or x >= g.size[0] - qmin or y < qmin or y >= g.size[1] - qmin) and gp[x, y] < 200:
                dirty += 1
    if dirty:
        print(f"  ✗ 静区不干净：{qmin}px 边带内有 {dirty} 个非白像素（可能裁进了文字/头像）")
    else:
        print(f"  ✓ 静区自检通过：{qmin}px 边带（≈{qmin / unit:.1f} 模块）全白")

    # 放大：二维码是硬边色块，NEAREST 保持边缘干脆；LANCZOS 会引入灰边
    side_src = max(crop.size)
    scale = TARGET / side_src
    if scale > 1.001:
        crop = crop.resize(
            (int(round(crop.size[0] * scale)), int(round(crop.size[1] * scale))),
            Image.NEAREST,
        )
    side = max(crop.size)
    canvas = Image.new("RGB", (side, side), (255, 255, 255))
    canvas.paste(crop, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT, "PNG", optimize=True)

    # ── 自检②：成品最外圈必须全白（客户端缩放到约 180px 时，静区才不会被吃掉）──
    cpx = canvas.convert("L").load()
    band = max(2, int(round(side * 0.012)))
    dirty2 = sum(
        1
        for y in range(side)
        for x in range(side)
        if (x < band or x >= side - band or y < band or y >= side - band) and cpx[x, y] < 200
    )
    print(f"  ✓ 成品最外圈 {band}px 全白" if not dirty2 else f"  ✗ 成品最外圈有 {dirty2} 个非白像素")

    disp = 180
    print(
        f"\n  ✓ {OUT.relative_to(ROOT)}  {side}x{side}  {OUT.stat().st_size / 1024:.0f} KB"
        f"\n    显示约 {disp} CSS px，余量 {side / disp:.1f} 倍；"
        f"模块 {unit * scale:.1f}px（放大前 {unit:.1f}px）"
        f"\n    扫码参考：模块 ≥4px 即可，当前 {unit * scale:.1f}px"
        f"\n    模块数 {modules}x{modules}（版本 {(modules - 17) // 4}）\n"
    )


if __name__ == "__main__":
    main()
