#!/usr/bin/env python3
"""
校验「导航标签」与「各区块 kicker」是否一致。

起因：导航写「为什么套袋」，而对应区块的 kicker 写「为什么值得」，
两处描述同一区块却用词不同，用户一眼就看出不一致。

这份映射散落在 src/lib/links.ts（导航）与各组件（kicker）里，
靠人工维护容易漂移，所以加一条自动检查。

用法：python3 tools/check-labels.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# 锚点 → 对应组件
ANCHOR_COMPONENT = {
    "story": "Story",
    "year": "Year",
    "gallery": "Gallery",
    "why": "Why",
    "visit": "Visit",
}

def main() -> int:
    links = (ROOT / "src/lib/links.ts").read_text(encoding="utf-8")
    nav = re.findall(r"\{ href: '#(\w+)', label: '([^']+)' \}", links)
    if not nav:
        print("✗ 没能从 src/lib/links.ts 解析出导航项")
        return 1

    problems = []
    print(f"  {'锚点':<10} {'导航标签':<12} {'区块 kicker':<12} 一致")
    print("  " + "-" * 46)
    for anchor, label in nav:
        comp = ANCHOR_COMPONENT.get(anchor)
        if not comp:
            print(f"  {anchor:<10} {label:<12} {'(未映射)':<12} —")
            continue
        f = ROOT / f"src/components/{comp}.astro"
        if not f.exists():
            problems.append(f"{anchor}: 找不到组件 {comp}.astro")
            continue
        m = re.search(r'class="kicker[^"]*"><span>[^<]*</span>([^<]+)<',
                      f.read_text(encoding="utf-8"))
        kicker = m.group(1).strip() if m else ""
        same = kicker == label
        if not same:
            problems.append(f"{anchor}: 导航「{label}」≠ kicker「{kicker or '(无)'}」")
        print(f"  {anchor:<10} {label:<12} {kicker or '(无)':<12} {'✓' if same else '✗'}")

    print()
    if problems:
        print("✗ 发现不一致：")
        for p in problems:
            print(f"    · {p}")
        print()
        print("  修法：改 src/lib/links.ts 的 label 或对应组件的 kicker，使两处一致。")
        return 1
    print("═══ 标签一致性：全部通过 ═══")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
