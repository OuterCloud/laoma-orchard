#!/usr/bin/env bash
#
# 修复服务器上「已有站点」的 HTTPS 证书
#
# 为什么要单独一个脚本、而不是用 server-setup.sh 里的 webroot 方式：
#
#   现有 nginx.conf 的 80 端口块是 `server_name _;`（通配）且只做 301 跳转，
#   没有 ACME 校验的 location。它同时是 80 端口的默认 server，所以对
#   mizunoamitiger.me 的 /.well-known/acme-challenge/ 请求会被它接走 → 301 到
#   HTTPS → certbot 拿不到校验文件 → 申请失败。
#
#   而我们新加的 laoma-apples.site 块用的是精确域名，匹配优先，所以它那条
#   webroot 通道是通的（server-setup.sh 里已实测验证）。
#
#   结论：修已有域名的证书只能用 standalone 模式，需要**短暂**腾出 80 端口。
#
# 影响面（如实说明）：
#   停容器 → 申请证书 → 启容器，通常 10~30 秒。期间已有站点会短暂不可用。
#   证书申请**失败也会自动把容器拉起来**（trap 保证），不会留下停服状态。
#
# 用法：
#   sudo EXISTING_DOMAIN=mizunoamitiger.me ./deploy/fix-existing-cert.sh
#   sudo EXISTING_DOMAIN=mizunoamitiger.me ACME_EMAIL=you@example.com ./deploy/fix-existing-cert.sh
#
# 幂等：证书仍有效时直接退出，不做任何改动。

set -euo pipefail

EXISTING_DOMAIN="${EXISTING_DOMAIN:-}"
STACK_DIR="${STACK_DIR:-/home/admin/mizuno-ami-tiger}"
COMPOSE_FILE="${COMPOSE_FILE:-${STACK_DIR}/docker-compose.prod.yml}"
SSL_DIR="${STACK_DIR}/nginx/ssl"
NGINX_CONTAINER="${NGINX_CONTAINER:-mizuno-ami-tiger-nginx-1}"

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "请用 root 执行"
[[ -n "$EXISTING_DOMAIN" ]] || die "请指定域名：sudo EXISTING_DOMAIN=mizunoamitiger.me $0"
[[ -f "$COMPOSE_FILE" ]] || die "找不到 compose 文件：$COMPOSE_FILE"
[[ -d "$SSL_DIR" ]] || die "找不到证书目录：$SSL_DIR"

# ─────────────────────────────────────────────────────────────
log "1/5 检查现有证书"
# ─────────────────────────────────────────────────────────────
command -v openssl >/dev/null || { apt-get update -qq && apt-get install -y -qq openssl >/dev/null; }
CURRENT="${SSL_DIR}/fullchain.pem"
if [[ -f "$CURRENT" ]]; then
  END="$(openssl x509 -enddate -noout -in "$CURRENT" 2>/dev/null | cut -d= -f2 || true)"
  if [[ -n "$END" ]] && openssl x509 -checkend 604800 -noout -in "$CURRENT" >/dev/null 2>&1; then
    ok "证书 7 天内不会过期（$END），无需修复"
    exit 0
  fi
  warn "证书已过期或即将过期：${END:-未知}"
else
  warn "没有找到现有证书文件"
fi

# ─────────────────────────────────────────────────────────────
log "2/5 确认域名解析指向本机"
# ─────────────────────────────────────────────────────────────
PUBLIC_IP="$(curl -fsS --max-time 10 https://ipinfo.io/ip 2>/dev/null || true)"
RESOLVED="$(getent hosts "$EXISTING_DOMAIN" | awk '{print $1; exit}' || true)"
printf '  域名解析：%s\n' "${RESOLVED:-解析失败}"
printf '  本机公网：%s\n' "${PUBLIC_IP:-未知}"
if [[ -n "$PUBLIC_IP" && -n "$RESOLVED" && "$RESOLVED" != "$PUBLIC_IP" ]]; then
  warn "解析地址与本机公网 IP 不一致，证书申请可能失败"
fi

command -v certbot >/dev/null || { apt-get update -qq && apt-get install -y -qq certbot >/dev/null; }

# ─────────────────────────────────────────────────────────────
log "3/5 临时停止 Nginx 容器（腾出 80 端口给 standalone 校验）"
# ─────────────────────────────────────────────────────────────
# 无论后续成败，都要把容器拉起来，避免留下停服状态
CONTAINER_STOPPED=0
restore() {
  if [[ "$CONTAINER_STOPPED" == "1" ]]; then
    printf '\n  正在恢复 Nginx 容器…\n'
    docker compose -f "$COMPOSE_FILE" up -d nginx >/dev/null 2>&1 || \
      docker start "$NGINX_CONTAINER" >/dev/null 2>&1 || true
    sleep 2
    printf '  容器已恢复\n'
  fi
}
trap restore EXIT

docker compose -f "$COMPOSE_FILE" stop nginx 2>&1 | sed 's/^/  /'
CONTAINER_STOPPED=1
# 等端口真正释放
for _ in $(seq 1 15); do
  ss -lnt 2>/dev/null | grep -q ':80 ' || break
  sleep 1
done
ok "80 端口已释放"

# ─────────────────────────────────────────────────────────────
log "4/5 申请证书（standalone 模式）"
# ─────────────────────────────────────────────────────────────
if [[ -n "${ACME_EMAIL:-}" ]]; then
  EMAIL_ARGS=(--email "$ACME_EMAIL")
else
  EMAIL_ARGS=(--register-unsafely-without-email)
  warn "未提供 ACME_EMAIL，将不注册邮箱（不影响签发与续期）"
fi

CERT_OK=0
if certbot certonly --standalone \\
    -d "$EXISTING_DOMAIN" \\
    "${EMAIL_ARGS[@]}" --agree-tos --non-interactive --keep-until-expiring \\
    2>&1 | sed 's/^/  /'; then
  CERT_OK=1
fi

if [[ "$CERT_OK" != "1" ]]; then
  warn "证书申请失败。常见原因："
  warn "  · 域名未解析到本机：dig +short ${EXISTING_DOMAIN}"
  warn "  · 阿里云防火墙未放行 80 端口"
  warn "容器会被自动恢复，站点不受持续影响。处理后可重新执行本脚本。"
  exit 1
fi

# ─────────────────────────────────────────────────────────────
log "5/5 安装证书并恢复服务"
# ─────────────────────────────────────────────────────────────
LIVE="/etc/letsencrypt/live/${EXISTING_DOMAIN}"
# 现有 nginx.conf 写死了 ssl/fullchain.pem 与 ssl/privkey.pem，沿用原文件名
cp "${LIVE}/fullchain.pem" "${SSL_DIR}/fullchain.pem"
cp "${LIVE}/privkey.pem"   "${SSL_DIR}/privkey.pem"
chmod 644 "${SSL_DIR}/fullchain.pem"
chmod 600 "${SSL_DIR}/privkey.pem"
ok "已更新 fullchain.pem / privkey.pem"

# 续期钩子：与 laoma 的钩子分开命名，互不覆盖
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
HOOK="/etc/letsencrypt/renewal-hooks/deploy/sync-${EXISTING_DOMAIN//./-}.sh"
cat > "$HOOK" <<EOF
#!/bin/sh
# ${EXISTING_DOMAIN} 续期后同步证书并重载容器内 nginx
cp /etc/letsencrypt/live/${EXISTING_DOMAIN}/fullchain.pem ${SSL_DIR}/fullchain.pem
cp /etc/letsencrypt/live/${EXISTING_DOMAIN}/privkey.pem   ${SSL_DIR}/privkey.pem
docker exec ${NGINX_CONTAINER} nginx -s reload || true
EOF
chmod +x "$HOOK"
systemctl enable --now certbot.timer >/dev/null 2>&1 || true
ok "已注册自动续期钩子：$(basename "$HOOK")"

restore
CONTAINER_STOPPED=0
trap - EXIT

docker exec "$NGINX_CONTAINER" nginx -t >/dev/null
docker exec "$NGINX_CONTAINER" nginx -s reload
ok "Nginx 已重载"

# 等容器真正开始服务再验证
sleep 3
NEW_END="$(openssl x509 -enddate -noout -in "$CURRENT" 2>/dev/null | cut -d= -f2 || true)"
printf '\n\033[1;32m═══ 修复完成 ═══\033[0m\n'
printf '  新证书有效期至：%s\n' "${NEW_END:-未知}"
printf '  自查：curl -sSI https://%s/ | head -1\n\n' "$EXISTING_DOMAIN"
