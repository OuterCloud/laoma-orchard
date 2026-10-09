#!/usr/bin/env python3
"""
在现有 nginx.conf 中「追加 / 替换」老马苹果园的 server 块。

设计要点：
  * server 块必须位于 http {} 内部，因此插到最后一个右花括号之前。
  * 绝不修改文件里任何既有行 —— 只做插入（或替换我们自己的那一块）。
  * 幂等：重复执行不会累积重复配置；每次用最新的片段替换旧片段。
  * 通过开始/结束标记识别自己写过的内容，不会误删用户其它配置。

用法：
  python3 patch_nginx.py <nginx.conf> <片段文件> <开始标记> <结束标记>
"""
import pathlib
import re
import sys

# 用短的 ASCII 标记，且按「整行」匹配。
# 教训：先前用 `#  老马苹果园 · 静态站点` 作为开始标记，但片段里这一行后面
# 还有「（第一阶段：仅有 HTTP）」等内容，正则要求行尾即结束，导致匹配不到、
# 旧块无法被移除，阶段 1 升级到阶段 2 时会累积出重复配置。
BEGIN_MARK = "LAOMA-ORCHARD-BEGIN"
END_MARK = "LAOMA-ORCHARD-END"


def strip_previous(text: str) -> str:
    """移除上一次插入的整块（若存在）。整行匹配，不受行内其它文字影响。"""
    # 标记区间必须自包含：片段的第一行就是 BEGIN、最后一行就是 END，
    # 区间之外的任何装饰性注释都放在标记内部，否则移除后会残留。
    pattern = re.compile(
        r"\n*[^\n]*" + BEGIN_MARK + r"[^\n]*\n.*?[^\n]*" + END_MARK + r"[^\n]*\n",
        re.S,
    )
    return pattern.sub("\n", text)


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2

    conf_path, snippet_path = (pathlib.Path(a) for a in sys.argv[1:3])
    text = conf_path.read_text(encoding="utf-8")
    snippet = snippet_path.read_text(encoding="utf-8").rstrip("\n")

    original = text
    text = strip_previous(text)
    replaced = text != original

    # 定位 http {} 的收尾花括号
    stripped = text.rstrip()
    if not stripped.endswith("}"):
        print("✗ nginx.conf 结构异常：结尾不是右花括号", file=sys.stderr)
        return 1
    idx = stripped.rfind("}")

    head = stripped[:idx].rstrip("\n")
    new_text = f"{head}\n\n{snippet}\n{stripped[idx:]}\n"
    conf_path.write_text(new_text, encoding="utf-8")

    verb = "替换" if replaced else "追加"
    print(f"  ✓ 已{verb} {len(snippet.splitlines())} 行配置（原有内容未改动）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
