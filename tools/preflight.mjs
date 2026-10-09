#!/usr/bin/env node
/**
 * 构建前置检查。
 *
 * 为什么需要它：本机（macOS + Apple Silicon）可能同时存在多个 Node，
 *   - 官方/nvm 的 Node 带 com.apple.security.cs.disable-library-validation，能加载原生模块；
 *   - 某些运行时自带的 Node 带 hardened runtime 但缺少该权限，
 *     加载 rolldown（Vite 8 的打包器）的 .node 时会报 ERR_DLOPEN_FAILED / "different Team IDs"。
 * 结果就是同一个工程换个 Node 就跑不起来，且报错完全看不懂。
 * 这里提前检查并给出明确指引。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MIN = [22, 12, 0];
const [maj, min, pat] = process.versions.node.split('.').map(Number);

const ok = maj > MIN[0] || (maj === MIN[0] && (min > MIN[1] || (min === MIN[1] && pat >= MIN[2])));
if (!ok) {
  console.error(
    `\n✗ Node 版本过低：当前 v${process.versions.node}，需要 ≥ v${MIN.join('.')}\n  nvm 用户可执行：nvm use\n`
  );
  process.exit(1);
}

/**
 * 从 astro 自身的解析路径去找 rolldown。
 * 不能直接 require('rolldown') —— pnpm 严格模式下它是 astro 的传递依赖，
 * 顶层的 node_modules 里并没有它。
 */
function resolveRolldownEntry() {
  try {
    const astroEntry = require.resolve('astro');
    const rolldownEntry = require.resolve('rolldown', { paths: [astroEntry] });
    return { ok: true, entry: rolldownEntry };
  } catch (e) {
    return { ok: false, error: e };
  }
}

const resolved = resolveRolldownEntry();
if (!resolved.ok) {
  console.error(
    `\n✗ 找不到构建依赖（rolldown），依赖可能没装好。\n` +
      `  请执行：pnpm install\n` +
      `  原始错误：${String(resolved.error?.message).split('\n')[0]}\n`
  );
  process.exit(1);
}

// 真正加载一次，确认原生二进制可用（这一步才会暴露签名/架构问题）
try {
  require(resolved.entry);
} catch (e) {
  console.error(
    `\n✗ 无法加载构建依赖的原生模块（rolldown）。\n` +
      `  这通常不是「缺包」，而是当前 Node 是启用 hardened runtime 的构建，\n` +
      `  却没有 com.apple.security.cs.disable-library-validation 权限，\n` +
      `  于是 macOS 拒绝加载签名 Team ID 不一致的 .node 文件。\n\n` +
      `  当前 Node：${process.execPath}\n` +
      `  错误：${String(e?.message).split('\n')[0]}\n\n` +
      `  解决办法（macOS）：换用官方 Node，例如\n` +
      `    nvm use            # 读取本工程 .nvmrc\n` +
      `    node -v            # 应显示 v${MIN.join('.')} 或更高\n` +
      `    pnpm build\n`
  );
  process.exit(1);
}

console.log(`✓ Node v${process.versions.node}、原生构建依赖均可用`);
