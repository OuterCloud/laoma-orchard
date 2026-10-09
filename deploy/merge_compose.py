#!/usr/bin/env python3
"""
生成「现有 compose + 老马苹果园挂载」的合并文件。

为什么用文本插入而不是解析 YAML：
  1. 服务器上不一定装了 python3-yaml，为一个两行的改动引入依赖不划算；
  2. 解析后再 dump 会重写整个文件（引号风格、缩进、注释都可能变），
     对用户正在运行的 compose 文件来说是不必要的风险。
  文本插入只增加两行，原文件其余部分逐字保留。

为什么不用 docker-compose.override.yml：
  用户命令行显式指定 `-f docker-compose.prod.yml` 时，Compose 不会自动
  加载 override 文件；而列表型字段（volumes）的合并规则在各版本间也不一致。
  直接产出最终文件，结果确定。

用法：
  python3 merge_compose.py <源 compose> <输出文件> <站点目录> <ACME 目录>
"""
import pathlib
import re
import sys


def main() -> int:
    if len(sys.argv) != 5:
        print(__doc__, file=sys.stderr)
        return 2

    src, dst, site_root, acme_dir = sys.argv[1:5]
    text = pathlib.Path(src).read_text(encoding="utf-8")
    lines = text.splitlines()

    # 定位 `  nginx:` 服务块
    nginx_at = None
    for i, line in enumerate(lines):
        if re.fullmatch(r"\s{2}nginx:\s*", line):
            nginx_at = i
            break
    if nginx_at is None:
        print("✗ 源 compose 里找不到 nginx 服务块", file=sys.stderr)
        return 1

    # 该服务块的结束位置：下一个缩进 <= 2 且非空的行
    block_end = len(lines)
    for j in range(nginx_at + 1, len(lines)):
        line = lines[j]
        if line.strip() and not line.startswith((" ", "\t")):
            block_end = j
            break
        if line.strip() and len(line) - len(line.lstrip()) <= 2:
            block_end = j
            break

    # 在块内找 `    volumes:`；没有则新建
    vol_at = None
    for j in range(nginx_at + 1, block_end):
        if re.fullmatch(r"\s{4}volumes:\s*", lines[j]):
            vol_at = j
            break

    entries = [
        f"      - {site_root}:/usr/share/nginx/laoma-apples:ro",
        f"      - {acme_dir}:/var/www/acme:ro",
    ]

    if vol_at is None:
        # 没有 volumes 段：在块末插入一个
        insert = ["    volumes:"] + entries
        lines[block_end:block_end] = insert
    else:
        # 已有 volumes 段：插到该段已有条目之后
        ins = vol_at + 1
        while ins < block_end and re.match(r"\s{6}-\s", lines[ins]):
            ins += 1
        # 幂等：已存在就不重复添加
        existing = "\n".join(lines[vol_at:block_end])
        add = [e for e in entries if e.strip().lstrip("- ") not in existing]
        lines[ins:ins] = add

    header = (
        "# ⚠️ 由 deploy/server-setup.sh 自动生成，请勿手工编辑。\n"
        "# 来源：docker-compose.prod.yml + 老马苹果园的只读挂载。\n"
        "# 要调整请改 deploy/merge_compose.py 或原 compose 后重新生成。\n"
    )
    pathlib.Path(dst).write_text(header + "\n".join(lines) + "\n", encoding="utf-8")
    print(f"  ✓ 已生成 {pathlib.Path(dst).name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
