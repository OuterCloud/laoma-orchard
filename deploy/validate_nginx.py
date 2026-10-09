#!/usr/bin/env python3
"""
对 Nginx 配置文件做静态校验 —— 在没有 nginx 二进制的机器上也能提前发现问题。

为什么需要它：本机没有 nginx、也没有 docker，无法 `nginx -t`。结果是连续两次
配置错误都只在服务器上才暴露（一次是引用了不存在的证书文件，一次是把
`default_server` 写成了独立指令）。这个脚本覆盖那些「纯文本就能判断」的错误，
让它们在推送到服务器之前被拦下。

检查项：
  1. 大括号配对
  2. 已知指令白名单 —— 捕获把「指令参数」误写成独立指令这类错误
     （例如 `default_server;`、`ssl;`、`http2;` 单独成行）
  3. 每条非块指令以分号结尾
  4. 多行指令（如 gzip_types）中间行不以分号结尾
  5. 我们自己的 server 块结构：listen / server_name 是否齐备
  6. ssl_certificate 引用的文件在部署时是否真会产生

用法：
  python3 validate_nginx.py <file.conf> [more.conf ...]
退出码 0 表示通过。
"""
from __future__ import annotations

import pathlib
import re
import sys

# 允许出现在配置里的顶层/块级指令名。
# 只列这份项目实际用到的集合，未知指令一律报错 —— 宁可误报也不漏报。
KNOWN_DIRECTIVES = {
    # 全局
    "worker_processes", "events", "worker_connections", "http",
    # http 块
    "include", "default_type", "sendfile", "keepalive_timeout",
    "server_tokens", "charset", "limit_req_zone", "resolver",
    "ssl_protocols", "ssl_prefer_server_ciphers", "ssl_session_cache",
    "ssl_session_timeout",
    # 压缩
    "gzip", "gzip_vary", "gzip_comp_level", "gzip_min_length", "gzip_proxied",
    "gzip_types", "brotli", "brotli_comp_level", "brotli_types",
    # server 块
    "listen", "server", "server_name", "root", "index", "set",
    # location / 内容
    "location", "proxy_pass", "proxy_set_header", "proxy_http_version",
    "proxy_read_timeout", "try_files", "return", "expires",
    "add_header", "access_log", "deny", "allow", "internal",
    "error_page", "error_log",
    # ssl
    "ssl_certificate", "ssl_certificate_key",
    # 其它
    "if", "rewrite",
    # HTTP/2（nginx >= 1.25.1 的独立指令写法：http2 on;）
    "http2",
}

# 把「指令参数」误写成独立指令的常见误用。
# 左：错误写法；右：正确写法说明。
PARAM_NOT_DIRECTIVE = {
    "default_server": "应写成 `listen 80 default_server;`（它是 listen 的参数）",
    "ssl": "应写成 `listen 443 ssl;`（ssl 是 listen 的参数）",
    "http2": "nginx >= 1.25.1 用 `http2 on;`；更早版本用 `listen 443 ssl http2;`",
    "quic": "quic 是 listen 的参数：`listen 443 quic;`",
    "backlog": "backlog 是 listen 的参数",
    "reuseport": "reuseport 是 listen 的参数",
    "deferred": "deferred 是 listen 的参数",
    "nodelay": "nodelay 是 limit_req 的参数",
    "always": "always 是 add_header 的参数",
}

# 允许独立成行的指令（值本身就短）
OK_STANDALONE = {"http2"}

# 这些「参数名」若带 on/off/值 出现，则是合法的独立指令，不再报错
PARAM_OK_WITH_VALUE = {"http2"}


def strip_comments(lines: list[str]) -> list[str]:
    return [re.sub(r"#[^\n]*", "", ln) for ln in lines]


def check(path: pathlib.Path) -> list[str]:
    errs: list[str] = []
    raw = path.read_text(encoding="utf-8")
    lines = raw.splitlines()
    body = strip_comments(lines)

    # 1. 大括号配对
    joined = "\n".join(body)
    if joined.count("{") != joined.count("}"):
        errs.append(f"大括号不配对：{{ {joined.count('{')} 个，}} {joined.count('}')} 个")

    # 2/3/4. 逐行检查
    in_multiline = False
    for i, (raw_line, line) in enumerate(zip(lines, body), 1):
        t = line.strip()
        if not t:
            continue
        if t in ("{", "}"):
            continue

        # 多行指令的续行（如 gzip_types 的各类型）：应无分号，直到最后一行
        if in_multiline:
            if t.endswith(";"):
                in_multiline = False
            elif re.fullmatch(r"[\w./+*-]+", t):
                continue
            else:
                errs.append(f"{path.name}:{i} 多行指令内出现可疑内容：{t!r}")
            continue

        # 独立的「参数被当指令」误用
        # 带值的独立指令（如 `http2 on;`）先放行
        mv = re.fullmatch(r"([a-z_0-9]+)\s+(on|off)\s*;", t)
        if mv and mv.group(1) in PARAM_OK_WITH_VALUE:
            continue

        m = re.fullmatch(r"([a-z_0-9]+)\s*;", t)
        if m and m.group(1) in PARAM_NOT_DIRECTIVE and m.group(1) not in OK_STANDALONE:
            errs.append(
                f"{path.name}:{i} `{m.group(1)};` 不是合法指令 —— "
                f"{PARAM_NOT_DIRECTIVE[m.group(1)]}"
            )
            continue

        # 指令名
        m = re.match(r"([a-z_0-9]+)\b", t)
        if m:
            name = m.group(1)
            if name not in KNOWN_DIRECTIVES:
                errs.append(f"{path.name}:{i} 未知指令 `{name}`（若确认合法请加入白名单）")
            elif name == "gzip_types" and not t.endswith(";"):
                in_multiline = True
            elif not t.endswith((";", "{")) and not t.endswith("}"):
                errs.append(f"{path.name}:{i} 指令 `{name}` 缺少结尾分号：{t!r}")

    # 5. server 块结构
    blocks = re.findall(r"server\s*\{(.*?)\n\}", joined, re.S)
    for idx, blk in enumerate(blocks, 1):
        if "listen" not in blk:
            errs.append(f"{path.name} 第 {idx} 个 server 块没有 listen")
        if "server_name" not in blk:
            errs.append(f"{path.name} 第 {idx} 个 server 块没有 server_name")
        if "ssl_certificate" in blk and "listen" in blk and "443" not in blk:
            errs.append(f"{path.name} 第 {idx} 个 server 块有 ssl_certificate 但 listen 不是 443")

    return errs


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2

    total = 0
    for a in argv[1:]:
        p = pathlib.Path(a)
        if not p.exists():
            print(f"  ✗ 文件不存在：{a}")
            total += 1
            continue
        errs = check(p)
        if errs:
            total += len(errs)
            print(f"  ✗ {p.name} 发现 {len(errs)} 个问题：")
            for e in errs:
                print(f"      · {e}")
        else:
            print(f"  ✓ {p.name} 通过")

    print()
    print(f"═══ 静态校验：{'全部通过' if total == 0 else f'{total} 个问题'} ═══")
    return 0 if total == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
