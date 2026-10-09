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
# 发布后自检用的地址（可用 SITE_URL 覆盖）
SITE_URL="${SITE_URL:-https://laoma-apples.site}"
REMOTE="${1:-}"
[[ "$REMOTE" == --no-build ]] && REMOTE=""

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }
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

# ── 发布前的硬性门禁 ──
# 教训：第 3 步用的是 `rsync --delete`。若构建失败或产物为空，
# 它会把服务器上的站点目录**整个删空**（线上曾因此变成 404）。
# 所以在任何同步动作之前，先确认产物是完整可用的。
[[ -f dist/index.html ]] || die "构建产物缺失 dist/index.html（若已有产物，加 --no-build）"

INDEX_BYTES=$(wc -c < dist/index.html | tr -d ' ')
[[ "$INDEX_BYTES" -ge 5000 ]] || \
  die "dist/index.html 只有 ${INDEX_BYTES} 字节，明显不完整，拒绝发布"

ASSET_COUNT=$(find dist/_astro -type f 2>/dev/null | wc -l | tr -d ' ')
[[ "$ASSET_COUNT" -ge 50 ]] || \
  die "dist/_astro 只有 ${ASSET_COUNT} 个文件，产物不完整，拒绝发布"
ok "产物门禁通过（index ${INDEX_BYTES} 字节，_astro ${ASSET_COUNT} 个文件）"

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

  # 用 --delete 清掉旧版本残留的哈希文件，避免目录无限膨胀。
  # 先把当前线上内容备份一份（只留最近一次），万一新产物有问题可以立刻回滚。
  PREV="${SITE_ROOT}.prev"
  if [[ -d "$SITE_ROOT" ]] && [[ -n "$(ls -A "$SITE_ROOT" 2>/dev/null)" ]]; then
    rm -rf "$PREV"
    cp -a "$SITE_ROOT" "$PREV"
    ok "已备份上一版到 $(basename "$PREV")"
  fi
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

  # ───────────────────────────────────────────────────────────
  # 发布后自检 —— 不通过就自动回滚
  #
  # 起因：曾出现「脚本报告发布成功，但线上实际是 404」，直到人工发现。
  # 这类静默失败最危险，所以每次发布后主动验证，失败即用 .prev 回滚。
  #
  # 仅检查本机站点目录的 index.html（文件系统层面，确定性最高），
  # 再去访问一次线上地址作为补充。网络不通不算发布失败，只提示。
  # ───────────────────────────────────────────────────────────
  log "3.5/4 发布后自检"

  verify_site() {
    local ok_all=1
    if [[ ! -f "${SITE_ROOT}/index.html" ]]; then
      bad "站点目录缺少 index.html"; ok_all=0
    else
      local sz; sz="$(wc -c < "${SITE_ROOT}/index.html" | tr -d ' ')"
      if [[ "$sz" -lt 5000 ]]; then
        bad "index.html 仅 ${sz} 字节，内容不完整"; ok_all=0
      else
        ok "index.html ${sz} 字节"
      fi
      # 页面里引用的 _astro 资源必须真实存在，否则线上会大面积 404
      local missing=0 ref
      for ref in $(grep -oE '/_astro/[A-Za-z0-9_.\-]+' "${SITE_ROOT}/index.html" | sort -u | head -40); do
        [[ -f "${SITE_ROOT}${ref}" ]] || { missing=$((missing+1)); }
      done
      if [[ "$missing" -gt 0 ]]; then
        bad "有 ${missing} 个页面引用的资源在站点目录中不存在"; ok_all=0
      else
        ok "页面引用的资源均存在"
      fi
    fi

    # 线上可访问性（失败只提示，不触发回滚 —— 可能是网络/DNS 问题）
    if command -v curl >/dev/null 2>&1; then
      local code
      code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$SITE_URL/" 2>/dev/null || echo 000)"
      if [[ "$code" == "200" ]]; then
        ok "线上返回 200（$SITE_URL）"
      else
        warn "线上返回 $code（$SITE_URL）—— 可能是网络或 DNS 问题，未因此回滚"
      fi
    fi

    [[ "$ok_all" == "1" ]]
  }

  if verify_site; then
    ok "自检通过"
  else
    bad "自检未通过，站点内容可能不完整"
    if [[ -d "$PREV" ]]; then
      warn "正在从 $(basename "$PREV") 回滚…"
      rm -rf "$SITE_ROOT"
      mv "$PREV" "$SITE_ROOT"
      chmod -R a+rX "$SITE_ROOT"
      if docker inspect "$NGINX_CONTAINER" >/dev/null 2>&1; then
        docker exec "$NGINX_CONTAINER" nginx -s reload >/dev/null 2>&1 || true
      fi
      printf '\n\033[1;33m═══ 已回滚到上一版 ═══\033[0m\n'
      printf '  线上站点保持为发布前的状态。请检查上方自检输出后重试。\n\n'
      exit 1
    else
      bad "没有可用的备份（$(basename "$PREV") 不存在），无法回滚"
      printf '\n  站点目录当前内容不完整，请检查 %s\n\n' "$SITE_ROOT"
      exit 1
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────
log "4/4 完成"
# ─────────────────────────────────────────────────────────────
printf '\n\033[1;32m═══ 发布成功 ═══\033[0m\n'
if [[ -z "$REMOTE" ]]; then
  echo "  回滚上一版（如需）：rm -rf ${SITE_ROOT} && mv ${SITE_ROOT}.prev ${SITE_ROOT}"
fi
echo
