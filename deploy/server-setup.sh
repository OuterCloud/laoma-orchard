#!/usr/bin/env bash
#
# 老马苹果园 · 服务器一次性初始化
#
# 在服务器上执行（需要 root）：
#   git clone git@github.com:OuterCloud/laoma-orchard.git
#   cd laoma-orchard
#   sudo ./deploy/server-setup.sh
#
# 设计原则：**绝不影响服务器上已有的服务**
#   1. 不修改现有 nginx.conf 的任何一行，只在文件末尾追加我们自己的 server 块
#   2. 不重建现有容器 —— 用一份新生成的 compose 文件「并入」挂载后原地重建
#      nginx 服务（镜像不变、配置不变，只是多了两个只读挂载）
#   3. 所有改动前先备份；每一步可重复执行（幂等）
#   4. 现有配置用的是 server_name _（通配），我们用精确域名，不会抢请求
#
# 可通过环境变量覆盖：
#   SITE_DOMAIN   默认 laoma-apples.site
#   ACME_EMAIL    证书通知邮箱（**可选**，不填也能签发；见 6/7 步说明）
#   STACK_DIR     现有项目目录，默认 /home/admin/mizuno-ami-tiger

set -euo pipefail

SITE_DOMAIN="${SITE_DOMAIN:-laoma-apples.site}"
STACK_DIR="${STACK_DIR:-/home/admin/mizuno-ami-tiger}"
NGINX_CONF="${STACK_DIR}/nginx/nginx.conf"
SSL_DIR="${STACK_DIR}/nginx/ssl"
ACME_DIR="${STACK_DIR}/nginx/acme"
SITE_ROOT="${STACK_DIR}/laoma-apples"
COMPOSE_MERGED="${STACK_DIR}/docker-compose.effective.yml"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MARKER="老马苹果园配置"
NGINX_CONTAINER="mizuno-ami-tiger-nginx-1"

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "请用 root 执行：sudo ./deploy/server-setup.sh"

# ─────────────────────────────────────────────────────────────
log "0/7 检查前置条件"
# ─────────────────────────────────────────────────────────────
[[ -f "$NGINX_CONF" ]] || die "找不到现有 nginx 配置：$NGINX_CONF（用 STACK_DIR=... 指定正确目录）"
[[ -d "$SSL_DIR"   ]] || die "找不到证书目录：$SSL_DIR"
command -v docker >/dev/null || die "未安装 docker"
docker compose version >/dev/null 2>&1 || die "docker compose 插件不可用"
docker inspect "$NGINX_CONTAINER" >/dev/null 2>&1 || die "找不到容器 $NGINX_CONTAINER"

PUBLIC_IP="$(curl -fsS --max-time 10 https://ipinfo.io/ip 2>/dev/null || true)"
ok "现有配置：$NGINX_CONF"
ok "现有容器：$NGINX_CONTAINER"
[[ -n "$PUBLIC_IP" ]] && ok "本机公网 IP：$PUBLIC_IP"

# ─────────────────────────────────────────────────────────────
log "1/7 创建目录"
# ─────────────────────────────────────────────────────────────
mkdir -p "$ACME_DIR" "$SITE_ROOT"
ok "$ACME_DIR（证书校验用）"
ok "$SITE_ROOT（静态文件）"

# ─────────────────────────────────────────────────────────────
log "2/7 备份现有配置"
# ─────────────────────────────────────────────────────────────
STAMP="$(date +%Y%m%d-%H%M%S)"
if ! ls "$STACK_DIR"/nginx/nginx.conf.bak-* >/dev/null 2>&1; then
  cp "$NGINX_CONF" "${NGINX_CONF}.bak-${STAMP}"
  ok "已备份：nginx.conf.bak-${STAMP}"
else
  ok "已有备份，跳过（避免覆盖最早的那份）"
fi
if [[ -f "${STACK_DIR}/docker-compose.prod.yml" ]]; then
  cp "${STACK_DIR}/docker-compose.prod.yml" \
     "${STACK_DIR}/docker-compose.prod.yml.bak-${STAMP}" 2>/dev/null || true
  ok "已备份 docker-compose.prod.yml"
fi

# ─────────────────────────────────────────────────────────────
log "3/7 追加 Nginx 站点配置"
# ─────────────────────────────────────────────────────────────
python3 "${REPO_DIR}/deploy/patch_nginx.py" \
  "$NGINX_CONF" "${REPO_DIR}/deploy/nginx-laoma.conf"
ok "现有配置未被修改，仅追加"

# ─────────────────────────────────────────────────────────────
log "4/7 生成合并后的 compose 文件"
# ─────────────────────────────────────────────────────────────
# 合并逻辑放在 deploy/merge_compose.py（单独文件便于测试与维护）
if ! python3 -c 'import yaml' 2>/dev/null; then
  warn "缺少 python3-yaml，正在安装…"
  apt-get update -qq && apt-get install -y -qq python3-yaml >/dev/null
fi
python3 "${REPO_DIR}/deploy/merge_compose.py" \
  "${STACK_DIR}/docker-compose.prod.yml" "$COMPOSE_MERGED" "$SITE_ROOT" "$ACME_DIR"

# ─────────────────────────────────────────────────────────────
log "5/7 应用挂载（原地重建 nginx 服务）"
# ─────────────────────────────────────────────────────────────
cd "$STACK_DIR"
docker compose -f "$COMPOSE_MERGED" up -d nginx 2>&1 | sed 's/^/  /'
sleep 3
docker exec "$NGINX_CONTAINER" nginx -t 2>&1 | sed 's/^/  /' || {
  warn "配置校验失败，正在回滚 nginx.conf"
  cp "$(ls -t "$STACK_DIR"/nginx/nginx.conf.bak-* | tail -1)" "$NGINX_CONF"
  docker compose -f "$COMPOSE_MERGED" up -d nginx >/dev/null 2>&1
  die "已回滚。请把上面的错误信息发出来排查。"
}
ok "nginx 配置校验通过"
docker exec "$NGINX_CONTAINER" nginx -s reload 2>&1 | sed 's/^/  /' || true

# ─────────────────────────────────────────────────────────────
log "6/7 申请 HTTPS 证书"
# ─────────────────────────────────────────────────────────────
if [[ -f "${SSL_DIR}/laoma-fullchain.pem" ]]; then
  ok "证书已存在，跳过"
else
  command -v certbot >/dev/null || { apt-get update -qq && apt-get install -y -qq certbot >/dev/null; }

  # 邮箱是**可选**的。
  # Let's Encrypt 的证书到期提醒邮件服务已于 2025-06-26 停止
  # （https://letsencrypt.org/2025/06/26/expiration-notification-service-has-ended），
  # 因此不填邮箱没有任何实际损失：证书照常签发，自动续期也照常工作
  #（续期靠的是 certbot.timer，与邮箱无关）。
  # 邮箱只存在服务器本地 /etc/letsencrypt/，不会写进证书，也不会出现在网站上。
  if [[ -n "${ACME_EMAIL:-}" ]]; then
    EMAIL_ARGS=(--email "$ACME_EMAIL")
  else
    EMAIL_ARGS=(--register-unsafely-without-email)
    warn "未提供 ACME_EMAIL，将不注册邮箱（不影响签发与自动续期）"
  fi

  if certbot certonly --webroot -w "$ACME_DIR" \
      -d "$SITE_DOMAIN" -d "www.${SITE_DOMAIN}" \
      "${EMAIL_ARGS[@]}" --agree-tos --non-interactive --keep-until-expiring \
      2>&1 | sed 's/^/  /'; then
    LIVE="/etc/letsencrypt/live/${SITE_DOMAIN}"
    cp "${LIVE}/fullchain.pem" "${SSL_DIR}/laoma-fullchain.pem"
    cp "${LIVE}/privkey.pem"   "${SSL_DIR}/laoma-privkey.pem"
    chmod 644 "${SSL_DIR}/laoma-fullchain.pem"
    chmod 600 "${SSL_DIR}/laoma-privkey.pem"
    docker exec "$NGINX_CONTAINER" nginx -s reload
    ok "证书已安装并重载"
  else
    warn "证书申请失败。常见原因：DNS 尚未解析到本机、或防火墙未放行 80 端口"
    warn "处理好后重新执行本脚本即可（幂等，不会重复改动）"
  fi
fi

# 自动续期后需要重载容器内的 nginx
if [[ -d /etc/letsencrypt/renewal ]]; then
  mkdir -p /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/laoma-reload.sh <<EOF
#!/bin/sh
# 续期后把新证书同步进容器并重载
cp /etc/letsencrypt/live/${SITE_DOMAIN}/fullchain.pem ${SSL_DIR}/laoma-fullchain.pem
cp /etc/letsencrypt/live/${SITE_DOMAIN}/privkey.pem   ${SSL_DIR}/laoma-privkey.pem
docker exec ${NGINX_CONTAINER} nginx -s reload || true
EOF
  chmod +x /etc/letsencrypt/renewal-hooks/deploy/laoma-reload.sh
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
  ok "已配置自动续期钩子"
fi

# ─────────────────────────────────────────────────────────────
log "7/7 部署静态文件"
# ─────────────────────────────────────────────────────────────
if [[ -f "${REPO_DIR}/dist/index.html" ]]; then
  rsync -a --delete "${REPO_DIR}/dist/" "$SITE_ROOT/"
  chmod -R a+rX "$SITE_ROOT"
  ok "已从 dist/ 同步静态文件"
elif command -v node >/dev/null 2>&1; then
  # 服务器上已具备构建环境：直接构建（dist/ 在 .gitignore 里，克隆后不会有）
  warn "没有现成产物，改为在服务器上构建…"
  # 调用 publish.sh（它会构建、校验并同步到 SITE_ROOT；此处不递归回本脚本）
  if (cd "$REPO_DIR" && ./deploy/publish.sh) 2>&1 | sed 's/^/  /'; then
    ok "构建并发布完成"
  else
    warn "构建失败。请检查 Node 版本（需 >=22.12）后重跑本脚本"
  fi
else
  warn "未找到 ${REPO_DIR}/dist/index.html，且未安装 Node，无法构建"
  warn "两种做法："
  warn "  1) 服务器装 Node 22+ 后重跑本脚本（推荐，之后能自动部署）"
  warn "  2) 在本机执行：./deploy/publish.sh root@<公网IP>:${SITE_ROOT}"
fi

# ── 构建环境检查（服务器上要能构建，才谈得上「clone 后自动部署」）──
log "7.5/7 检查构建环境"
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$NODE_MAJOR" -ge 22 ]]; then
    ok "Node $(node -v) 满足要求（>=22.12）"
  else
    warn "Node $(node -v) 版本过低，项目要求 >=22.12"
    warn "升级：curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs"
  fi
  command -v pnpm >/dev/null 2>&1 && ok "pnpm $(pnpm -v)" || {
    warn "未安装 pnpm，尝试用 corepack 启用"
    corepack enable >/dev/null 2>&1 && corepack prepare pnpm@latest --activate >/dev/null 2>&1 \
      && ok "已通过 corepack 启用 pnpm" \
      || warn "请手动安装：npm install -g pnpm"
  }
else
  warn "未安装 Node.js —— 服务器上无法构建"
  warn "安装（Ubuntu）：curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs"
  warn "装好后重新执行本脚本即可"
fi

# systemd 单元：保证宿主机重启后容器自动拉起（compose 里已有 restart: always，
# 这里再补一层，避免 compose 项目未被 Docker 自动接管的情况）
cat > /etc/systemd/system/laoma-orchard.service <<EOF
[Unit]
Description=laoma-orchard static site (ensures nginx container is up)
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${STACK_DIR}
ExecStart=/usr/bin/docker compose -f ${COMPOSE_MERGED} up -d
ExecReload=/usr/bin/docker exec ${NGINX_CONTAINER} nginx -s reload

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable laoma-orchard.service >/dev/null 2>&1 || true
ok "已注册 systemd 单元 laoma-orchard.service"

# ─────────────────────────────────────────────────────────────
printf '\n\033[1;32m═══ 初始化完成 ═══\033[0m\n'
echo
echo "  站点地址：https://${SITE_DOMAIN}/"
[[ -n "$PUBLIC_IP" ]] && echo "  服务器 IP：${PUBLIC_IP}"
echo
echo "  ⚠️ 别忘了在阿里云控制台放行 80 和 443 端口（防火墙/安全组）"
echo "  ⚠️ 别忘了在 DNSPod 把 ${SITE_DOMAIN} 的 A 记录指向上面的 IP"
echo
echo "  日常更新代码后，只需执行："
echo "    cd ${REPO_DIR} && git pull && ./deploy/publish.sh"
echo
