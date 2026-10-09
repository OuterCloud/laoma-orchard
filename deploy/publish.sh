#!/usr/bin/env bash
#
# 把 dist/ 部署到自己的服务器（例如阿里云香港节点）。
#
# 用法：
#   ./deploy/publish.sh <用户>@<服务器IP> [站点目录]
#
# 例：
#   ./deploy/publish.sh root@47.xx.xx.xx
#   ./deploy/publish.sh ubuntu@47.xx.xx.xx /var/www/laoma-apples
#
# 前置条件：
#   1. 本机能用 SSH 免密登录该服务器（推荐用密钥，不要用密码）
#   2. 服务器已装好 Nginx，并已放置 deploy/nginx.conf
#   3. 服务器的站点目录存在且当前用户有写权限
#
# 脚本只做三件事：本地构建 → 校验产物 → rsync 同步 → reload nginx。
# 不做任何服务器初始化，避免弄乱你已有的环境。

set -euo pipefail

TARGET="${1:-}"
REMOTE_DIR="${2:-/var/www/laoma-apples}"

if [[ -z "$TARGET" ]]; then
  echo "用法: $0 <用户>@<服务器IP> [站点目录]" >&2
  echo "例:   $0 root@47.xx.xx.xx /var/www/laoma-apples" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
echo "▸ 项目目录: $(pwd)"

# ── 1. 构建 ──
echo "▸ 构建…"
pnpm build

if [[ ! -f dist/index.html ]]; then
  echo "✗ 构建产物缺失 dist/index.html" >&2
  exit 1
fi

# ── 2. 校验产物 ──
echo "▸ 校验产物…"

# 2.1 不能残留占位域名，否则 canonical/sitemap 会指向错误地址
if grep -rl "example\.com" dist >/dev/null 2>&1; then
  echo "✗ dist 里仍有 example.com，请检查 astro.config.mjs 的 site" >&2
  grep -rl "example\.com" dist | head -5 >&2
  exit 1
fi

# 2.2 _astro 下必须全部是带哈希的文件名，否则不能使用 immutable 长期缓存
UNHASHED=$(find dist/_astro -type f -printf '%f\n' 2>/dev/null \
  | grep -vE '\.[A-Za-z0-9_-]{8,}\.' | wc -l | tr -d ' ')
if [[ "$UNHASHED" != "0" ]]; then
  echo "✗ dist/_astro 下有 $UNHASHED 个文件未带内容哈希，immutable 缓存不安全" >&2
  exit 1
fi

echo "  ✓ 无占位域名，_astro 全部带哈希"

# ── 3. 同步 ──
#
# --delete 让服务器与本地完全一致，删掉旧版本残留的哈希文件（否则会越积越多）。
# 先传后删：--delete 在 rsync 内部保证目录级一致性，出错不会留下半截状态。
echo "▸ 同步到 $TARGET:$REMOTE_DIR …"
rsync -az --delete --human-readable \
  --chmod=D755,F644 \
  -e "ssh -o StrictHostKeyChecking=accept-new" \
  dist/ "$TARGET:$REMOTE_DIR/"

# ── 4. 权限与 reload ──
echo "▸ 修正属主并重载 Nginx…"
ssh -o StrictHostKeyChecking=accept-new "$TARGET" bash -s <<EOF
set -euo pipefail
DIR="$REMOTE_DIR"

# Nginx 默认以 www-data 运行；不同发行版可能是 nginx 用户
OWNER="www-data"
id -u www-data >/dev/null 2>&1 || OWNER="nginx"
chown -R "\$OWNER:\$OWNER" "\$DIR"
find "\$DIR" -type d -exec chmod 755 {} +
find "\$DIR" -type f -exec chmod 644 {} +

nginx -t
systemctl reload nginx
echo "  ✓ Nginx 已重载"
EOF

echo ""
echo "✓ 部署完成：http://$(echo "$TARGET" | cut -d@ -f2)/"
echo "  若已配 HTTPS，请访问 https://laoma-apples.site/"
