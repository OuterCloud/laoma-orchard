#!/usr/bin/env bash
#
# 老马苹果园 · 构建并发布
#
# 两种用法：
#
#   1) 在服务器上（推荐，自动化部署走这条）
#      cd ~/laoma-orchard && git pull && ./deploy/publish.sh
#      → 构建后把 dist/ 同步到站点目录，并重载 Nginx
#
#   2) 在本机推送到远程服务器（临时/应急用）
#      ./deploy/publish.sh root@<公网IP>:/var/www/laoma-apples
#      → 本机构建后 rsync 过去，不依赖服务器上的 Node 环境
#
# 第 1 种模式下，站点目录与容器名可用环境变量覆盖：
#   SITE_ROOT        默认 /home/admin/mizuno-ami-tiger/laoma-apples
#   NGINX_CONTAINER  默认 mizuno-ami-tiger-nginx-1

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

SITE_ROOT="${SITE_ROOT:-/home/admin/mizuno-ami-tiger/laoma-apples}"
NGINX_CONTAINER="${NGINX_CONTAINER:-mizuno-ami-tiger-nginx-1}"
REMOTE="${1:-}"
[[ "$REMOTE" == --no-build ]] && REMOTE=""

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────
log "1/4 构建"
# ─────────────────────────────────────────────────────────────
# 支持跳过构建（部署已有产物时用）：
#   ./deploy/publish.sh --no-build
NO_BUILD=0
for arg in "$@"; do
  [[ "$arg" == "--no-build" ]] && NO_BUILD=1
done

if [[ "$NO_BUILD" == "1" ]]; then
  printf '  跳过构建（--no-build）\n'
elif command -v pnpm >/dev/null 2>&1; then
  pnpm build
else
  # 服务器上可能只有 corepack，它能按 package.json 拉取正确的 pnpm
  corepack enable >/dev/null 2>&1 || true
  corepack pnpm build
fi

[[ -f dist/index.html ]] || die "构建产物缺失 dist/index.html（若已有产物，加 --no-build）"

# ─────────────────────────────────────────────────────────────
log "2/4 校验产物"
# ─────────────────────────────────────────────────────────────
if grep -rlq "example\.com" dist 2>/dev/null; then
  die "dist 里仍有 example.com，请检查 astro.config.mjs 的 site"
fi
ok "无占位域名"

UNHASHED=$(find dist/_astro -type f -printf '%f\n' 2>/dev/null \
  | grep -vcE '\.[A-Za-z0-9_-]{8,}\.' || true)
if [[ "${UNHASHED:-0}" != "0" ]]; then
  die "dist/_astro 下有 ${UNHASHED} 个文件未带内容哈希，immutable 缓存不安全"
fi
ok "_astro 下全部带内容哈希（可安全使用长期缓存）"

[[ -f dist/404.html ]] || printf '  ! 未生成 404.html\n'
ok "产物大小：$(du -sh dist | cut -f1)"

# ─────────────────────────────────────────────────────────────
log "3/4 发布"
# ─────────────────────────────────────────────────────────────
if [[ -n "$REMOTE" ]]; then
  # 模式 2：本机推送到远程
  TARGET_DIR="${REMOTE#*:}"
  [[ "$TARGET_DIR" == "$REMOTE" ]] && TARGET_DIR="/var/www/laoma-apples"
  HOST="${REMOTE%%:*}"
  rsync -az --delete --human-readable --chmod=D755,F644 \
    -e "ssh -o StrictHostKeyChecking=accept-new" \
    dist/ "${HOST}:${TARGET_DIR}/"
  ok "已同步到 ${HOST}:${TARGET_DIR}"

  ssh -o StrictHostKeyChecking=accept-new "$HOST" bash -s <<EOF
set -euo pipefail
DIR="${TARGET_DIR}"
if id -u www-data >/dev/null 2>&1; then OWNER=www-data; else OWNER=nginx; fi
chown -R "\$OWNER:\$OWNER" "\$DIR" 2>/dev/null || true
find "\$DIR" -type d -exec chmod 755 {} +
find "\$DIR" -type f -exec chmod 644 {} +
if command -v nginx >/dev/null 2>&1; then nginx -t && systemctl reload nginx; fi
EOF
  ok "远程权限与 Nginx 已处理"
else
  # 模式 1：在服务器上就地发布
  [[ -d "$SITE_ROOT" ]] || die "站点目录不存在：$SITE_ROOT（请先跑 deploy/server-setup.sh）"

  # 用 --delete 清掉旧版本残留的哈希文件，避免目录无限膨胀
  rsync -a --delete dist/ "$SITE_ROOT/"
  chmod -R a+rX "$SITE_ROOT"
  ok "已同步到 $SITE_ROOT"

  if docker inspect "$NGINX_CONTAINER" >/dev/null 2>&1; then
    docker exec "$NGINX_CONTAINER" nginx -t >/dev/null
    docker exec "$NGINX_CONTAINER" nginx -s reload
    ok "容器内 Nginx 已重载"
  elif command -v nginx >/dev/null 2>&1; then
    # 万一容器名变了，退回宿主机 Nginx
    nginx -t && systemctl reload nginx
    ok "宿主机 Nginx 已重载"
  else
    printf '  ! 未找到 Nginx（容器 %s 或宿主机），静态文件已就位但未重载\n' "$NGINX_CONTAINER"
  fi
fi

# ─────────────────────────────────────────────────────────────
log "4/4 完成"
# ─────────────────────────────────────────────────────────────
printf '\n\033[1;32m═══ 发布成功 ═══\033[0m\n'
if [[ -z "$REMOTE" ]]; then
  echo "  自检：curl -sI https://laoma-apples.site/ | head -1"
fi
echo
