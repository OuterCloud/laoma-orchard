#!/usr/bin/env bash
#
# 一键恢复 + 诊断
#
# 适用场景：laoma-apples.site 或 mizunoamitiger.me 无法访问时。
#
#   sudo ./deploy/recover.sh
#
# 这个脚本会依次：
#   1. 收集诊断信息（容器状态、挂载、路径、端口、磁盘）
#   2. 安装已签发的证书（若磁盘上有比现用更新的）
#   3. 确保 nginx 容器在运行
#   4. 自检：容器内能否看到站点文件、nginx 的 root 是否与挂载一致
#   5. 从外部（本机）验证两个域名
#
# 设计原则：每一步都先判断再做，且把判断依据打印出来 ——
# 因为开发者无法直连这台服务器，诊断输出是唯一的排查依据。
# 全程幂等，可反复执行。

set -uo pipefail   # 注意：不用 -e，诊断脚本要尽量跑完每一步

SITE_DOMAIN="${SITE_DOMAIN:-laoma-apples.site}"
EXISTING_DOMAIN="${EXISTING_DOMAIN:-mizunoamitiger.me}"
STACK_DIR="${STACK_DIR:-/home/admin/mizuno-ami-tiger}"
SITE_ROOT="${SITE_ROOT:-${STACK_DIR}/laoma-apples}"
SSL_DIR="${SSL_DIR:-${STACK_DIR}/nginx/ssl}"
NGINX_CONTAINER="${NGINX_CONTAINER:-mizuno-ami-tiger-nginx-1}"
COMPOSE_MERGED="${STACK_DIR}/docker-compose.effective.yml"
COMPOSE_ORIG="${STACK_DIR}/docker-compose.prod.yml"
CONTAINER_SITE_PATH="/usr/share/nginx/laoma-apples"

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }

[[ $EUID -eq 0 ]] || { printf '请用 root 执行：sudo %s\n' "$0" >&2; exit 1; }

# ═══════════════════════════════════════════════════════════
log "1/6 诊断信息"
# ═══════════════════════════════════════════════════════════
info "容器状态："
docker ps -a --filter "name=${NGINX_CONTAINER}" --format '    {{.Names}}  {{.Status}}' || true

info "容器挂载："
docker inspect "$NGINX_CONTAINER" --format '{{range .Mounts}}    {{.Source}} -> {{.Destination}} (RW:{{.RW}}){{"\n"}}{{end}}' 2>/dev/null || warn "无法读取（容器可能不存在）"

info "宿主机站点目录：$SITE_ROOT"
if [[ -d "$SITE_ROOT" ]]; then
  info "  文件数 $(find "$SITE_ROOT" -type f 2>/dev/null | wc -l | tr -d ' ')，体积 $(du -sh "$SITE_ROOT" 2>/dev/null | cut -f1)"
  [[ -f "$SITE_ROOT/index.html" ]] && ok "index.html 存在（$(wc -c < "$SITE_ROOT/index.html" | tr -d ' ') 字节）" || bad "index.html 缺失"
else
  bad "目录不存在"
fi
if [[ -d "${SITE_ROOT}.prev" ]]; then
  info "  备份目录存在：${SITE_ROOT}.prev（$(du -sh "${SITE_ROOT}.prev" 2>/dev/null | cut -f1)）"
fi

info "端口监听："
ss -lntp 2>/dev/null | grep -E ':(80|443) ' | sed 's/^/    /' || info "  80/443 均无监听"

info "磁盘："
df -h / /home 2>/dev/null | grep -vE 'tmpfs|^Filesystem' | sed 's/^/    /'

# ═══════════════════════════════════════════════════════════
log "2/6 安装已签发的证书"
# ═══════════════════════════════════════════════════════════
# 判断「新证书是否比当前使用的更晚过期」，只用 openssl -checkend，
# 不依赖 date -d（那是 GNU 专有，BSD/macOS 不支持；且解析失败会静默变成 0，
# 让比较逻辑失效 —— 这里曾因此踩过坑）。
more_lasting() {
  local new_cert="$1" cur_cert="$2"
  local cur_secs=0 step
  for step in 31536000 15552000 7776000 2592000 864000 86400; do
    if openssl x509 -checkend "$step" -noout -in "$cur_cert" >/dev/null 2>&1; then
      cur_secs=$step; break
    fi
  done
  # 当前证书已失效或不存在时 cur_secs=0，新证书只要有效就会覆盖它
  openssl x509 -checkend "$((cur_secs + 86400))" -noout -in "$new_cert" >/dev/null 2>&1
}

install_cert() {
  local dom="$1" dest_cert="$2" dest_key="$3"
  local live="/etc/letsencrypt/live/${dom}"
  info "${dom}"
  if [[ ! -f "${live}/fullchain.pem" ]]; then
    warn "  /etc/letsencrypt 下没有该域名的证书，跳过"
    return
  fi
  local new_end
  new_end="$(openssl x509 -enddate -noout -in "${live}/fullchain.pem" 2>/dev/null | cut -d= -f2)"
  info "  letsencrypt 证书有效期至：${new_end:-未知}"

  if [[ ! -f "$dest_cert" ]]; then
    info "  当前无证书文件 → 安装"
  elif more_lasting "${live}/fullchain.pem" "$dest_cert"; then
    info "  新证书更晚过期 → 覆盖"
  else
    ok "  当前使用的证书不旧于它，保持不变"
    return
  fi

  cp "${live}/fullchain.pem" "$dest_cert"
  cp "${live}/privkey.pem"   "$dest_key"
  chmod 644 "$dest_cert"; chmod 600 "$dest_key"
  ok "  已安装到 $(basename "$dest_cert")"
}

install_cert "$EXISTING_DOMAIN" "${SSL_DIR}/fullchain.pem" "${SSL_DIR}/privkey.pem"
install_cert "$SITE_DOMAIN"     "${SSL_DIR}/laoma-fullchain.pem" "${SSL_DIR}/laoma-privkey.pem"

# ═══════════════════════════════════════════════════════════
log "3/6 确保容器在运行"
# ═══════════════════════════════════════════════════════════
COMPOSE_TO_USE="$COMPOSE_MERGED"
[[ -f "$COMPOSE_TO_USE" ]] || COMPOSE_TO_USE="$COMPOSE_ORIG"
info "使用 compose 文件：$COMPOSE_TO_USE"

cd "$STACK_DIR" || { bad "无法进入 $STACK_DIR"; exit 1; }
docker compose -f "$COMPOSE_TO_USE" up -d nginx 2>&1 | sed 's/^/    /'
sleep 3

if docker ps --filter "name=${NGINX_CONTAINER}" --format '{{.Status}}' | grep -q '^Up'; then
  ok "容器运行中"
else
  bad "容器未能启动，以下是日志："
  docker logs --tail 30 "$NGINX_CONTAINER" 2>&1 | sed 's/^/    /'
  printf '\n  请把以上日志发给开发者\n'
  exit 1
fi

# ═══════════════════════════════════════════════════════════
log "4/6 自检：容器内是否能看到站点文件"
# ═══════════════════════════════════════════════════════════
INSIDE_COUNT="$(docker exec "$NGINX_CONTAINER" sh -c "find ${CONTAINER_SITE_PATH} -type f 2>/dev/null | wc -l" 2>/dev/null | tr -d ' ')"
info "容器内 ${CONTAINER_SITE_PATH} 的文件数：${INSIDE_COUNT:-读取失败}"

if [[ "${INSIDE_COUNT:-0}" -gt 0 ]]; then
  ok "容器能看到站点文件，挂载正常"
else
  bad "容器内看不到站点文件 —— 挂载路径不一致，这是 404 的直接原因"
  info "宿主机目录：$SITE_ROOT"
  info "容器内路径：$CONTAINER_SITE_PATH"
  info "容器挂载："
  docker inspect "$NGINX_CONTAINER" --format '{{range .Mounts}}      {{.Source}} -> {{.Destination}}{{"\n"}}{{end}}' 2>/dev/null | sed 's/^/  /'
  printf '\n  修复方向：让 compose 把 %s 挂载到 %s（见 deploy/merge_compose.py）\n' "$SITE_ROOT" "$CONTAINER_SITE_PATH"
fi

info "nginx 中 laoma 块的 root 指向："
docker exec "$NGINX_CONTAINER" nginx -T 2>/dev/null \
  | grep -B 2 -A 6 "server_name ${SITE_DOMAIN}" \
  | grep -E "root|server_name|listen" | sed 's/^/    /' || warn "  未找到该 server 块"

# ═══════════════════════════════════════════════════════════
log "5/6 nginx 配置校验与重载"
# ═══════════════════════════════════════════════════════════
if docker exec "$NGINX_CONTAINER" nginx -t 2>&1 | sed 's/^/    /'; then
  docker exec "$NGINX_CONTAINER" nginx -s reload 2>&1 | sed 's/^/    /' || true
  ok "配置有效"
else
  bad "配置校验失败，未重载"
fi

# ═══════════════════════════════════════════════════════════
log "6/6 外部验证"
# ═══════════════════════════════════════════════════════════
PUBLIC_IP="$(curl -fsS --max-time 10 https://ipinfo.io/ip 2>/dev/null || true)"
for d in "$SITE_DOMAIN" "$EXISTING_DOMAIN"; do
  printf '  %-24s ' "$d"
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://${d}/" 2>/dev/null)"
  printf 'https=%s  ' "${code:-连接失败}"
  code2="$(curl -sSk -o /dev/null -w '%{http_code}' --max-time 20 --resolve "${d}:443:${PUBLIC_IP}" "https://${d}/" 2>/dev/null)"
  printf '忽略证书=%s\n' "${code2:-?}"
done

printf '\n\033[1;32m═══ 完成 ═══\033[0m\n'
printf '若两个域名 https 均返回 200，说明都恢复了。\n'
printf '若 .site 仍为 404，请看第 4 步的输出 —— 那里会指出挂载问题。\n\n'
