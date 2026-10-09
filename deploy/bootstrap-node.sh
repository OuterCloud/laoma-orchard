#!/usr/bin/env bash
#
# 安装 Node.js 22（官方预编译包，不经过 apt）
#
# 为什么不用 NodeSource 的 apt 源：
#   实测在目标服务器上 `curl -fsSL https://deb.nodesource.com/setup_22.x | bash -`
#   会因 apt update 拉取索引失败而中断（E: Some index files failed to download），
#   结果是 fallback 装了 Ubuntu 自带的 Node 18，而 18 不带 corepack，
#   后续构建直接失败。apt 源依赖仓库元数据，在国内网络下不稳定。
#
#   改为直接下载官方 tar.xz（单次 HTTPS 请求，依赖 nodejs.org 可达），
#   并用官方 SHASUMS256.txt 校验完整性。不动 apt、不覆盖系统包管理器记录，
#   要卸载只需删掉对应目录。
#
# 用法：
#   sudo ./deploy/bootstrap-node.sh              # 默认 Node 22
#   sudo NODE_VERSION=v24.21.0 ./deploy/bootstrap-node.sh
#
# 幂等：若已有满足要求的 Node（>=22.12）且带 corepack，则什么都不做。

set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v22.23.3}"
PREFIX="${PREFIX:-/usr/local}"
# 项目要求 engines.node >= 22.12.0
MIN_MAJOR=22
MIN_MINOR=12

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "请用 root 执行：sudo $0"

# ── 已装且满足要求就跳过 ──
if command -v node >/dev/null 2>&1; then
  V="$(node -v)"; MAJ="${V#v}"; MAJ="${MAJ%%.*}"
  REST="${V#v*.}"; MIN="${REST%%.*}"
  if [[ "$MAJ" -gt "$MIN_MAJOR" || ( "$MAJ" -eq "$MIN_MAJOR" && "$MIN" -ge "$MIN_MINOR" ) ]]; then
    if command -v corepack >/dev/null 2>&1; then
      ok "已有 Node ${V} 且带 corepack，无需安装"
      exit 0
    fi
    warn "Node ${V} 可用但缺少 corepack，继续安装官方包以补齐"
  else
    warn "现有 Node ${V} 低于要求（>=${MIN_MAJOR}.${MIN_MINOR}），将安装 ${NODE_VERSION}"
  fi
fi

# ── 识别架构 ──
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "不支持的架构：$(uname -m)" ;;
esac
ok "架构：$(uname -m) → ${ARCH}"

TARBALL="node-${NODE_VERSION}-linux-${ARCH}.tar.xz"
BASE="https://nodejs.org/dist/${NODE_VERSION}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log "1/4 下载 ${TARBALL}"
command -v curl >/dev/null || die "缺少 curl，请先安装：apt-get install -y curl"
if ! curl -fSL --retry 3 --connect-timeout 20 -o "${TMP}/${TARBALL}" "${BASE}/${TARBALL}"; then
  die "下载失败。若网络无法访问 nodejs.org，可改用镜像：
    NODE_MIRROR=https://npmmirror.com/mirrors/node 的情况请手动下载后放到 ${TMP}"
fi
ok "已下载 $(du -h "${TMP}/${TARBALL}" | cut -f1)"

log "2/4 校验完整性（官方 SHASUMS256.txt）"
if curl -fsSL --max-time 30 -o "${TMP}/SHASUMS256.txt" "${BASE}/SHASUMS256.txt"; then
  EXPECT="$(grep " ${TARBALL}\$" "${TMP}/SHASUMS256.txt" | awk '{print $1}')"
  if [[ -n "$EXPECT" ]]; then
    ACTUAL="$(sha256sum "${TMP}/${TARBALL}" | awk '{print $1}')"
    [[ "$EXPECT" == "$ACTUAL" ]] || die "校验失败：期望 ${EXPECT}，实际 ${ACTUAL}"
    ok "SHA256 校验通过"
  else
    warn "校验文件中没有 ${TARBALL} 的记录，跳过校验"
  fi
else
  warn "无法获取 SHASUMS256.txt，跳过校验（下载走 HTTPS，风险可控）"
fi

log "3/4 解压到 ${PREFIX}"
tar -xJf "${TMP}/${TARBALL}" -C "$TMP"
SRC="${TMP}/node-${NODE_VERSION}-linux-${ARCH}"
[[ -x "${SRC}/bin/node" ]] || die "解压结果异常，找不到 ${SRC}/bin/node"
# 同步到 PREFIX（先删旧的同名文件，避免残留不同版本的库）
rm -rf "${PREFIX}/include/node" "${PREFIX}/lib/node_modules/npm" "${PREFIX}/lib/node_modules/corepack"
cp -a "${SRC}/bin/."    "${PREFIX}/bin/"
cp -a "${SRC}/include/." "${PREFIX}/include/"
cp -a "${SRC}/lib/."    "${PREFIX}/lib/"
cp -a "${SRC}/share/."  "${PREFIX}/share/" 2>/dev/null || true
ok "已安装到 ${PREFIX}"

log "4/4 验证"
hash -r 2>/dev/null || true
NODE_BIN="${PREFIX}/bin/node"
[[ -x "$NODE_BIN" ]] || die "${NODE_BIN} 不存在"
ok "node $("$NODE_BIN" -v)"

COREPACK_BIN="${PREFIX}/bin/corepack"
if [[ -x "$COREPACK_BIN" ]]; then
  ok "corepack 可用"
  # 启用 pnpm。corepack 会把 shim 放在 node 同目录（/usr/local/bin），
  # 该目录在 PATH 中优先于 /usr/bin，因此会覆盖系统自带的 node 18。
  "${COREPACK_BIN}" enable >/dev/null 2>&1 || true
  if "${COREPACK_BIN}" prepare pnpm@latest --activate >/dev/null 2>&1; then
    ok "pnpm 已通过 corepack 激活"
  else
    warn "corepack 激活 pnpm 失败，可稍后手动执行：corepack prepare pnpm@latest --activate"
  fi
else
  warn "未找到 corepack"
fi

printf '\n\033[1;32m═══ Node 安装完成 ═══\033[0m\n'
echo "  node:     ${NODE_BIN} ($("$NODE_BIN" -v))"
echo "  PATH 优先级：${PREFIX}/bin 应先于 /usr/bin（当前 which node: $(command -v node || echo 未找到)）"
echo
echo "  若 which node 仍指向 /usr/bin/node，执行：hash -r"
echo "  或直接用绝对路径：${NODE_BIN}"
echo
