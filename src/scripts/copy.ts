/**
 * 一键复制（微信号等）。
 * 优先用 Clipboard API；非安全上下文（http 局域网预览）下回退到 execCommand。
 */

const RESET_DELAY = 1800;

async function copy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 落到下面的兜底方案 */
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    /*
     * execCommand 已被 DOM 规范废弃，但它是**非安全上下文**（http，例如局域网
     * 预览、部分内嵌浏览器）下唯一可用的复制方案 —— Clipboard API 在这些环境
     * 里要么不存在，要么被拒绝。所以这个兜底必须保留，不能为消除告警而删掉。
     *
     * 用一个自定义类型来调用，绕开 DOM 类型定义上的 @deprecated 标记：
     * 运行时行为完全不变（调用的仍是原生 execCommand），但 astro check 不再
     * 报 ts(6387)。这比另外两种常见写法可靠 ——
     *   · eslint-disable：astro check 走 TypeScript 诊断，不读 eslint 注释
     *   · @ts-expect-error：只作用于 error 级，而废弃属于 hint 级，
     *     反而会因「未使用该指令」直接报错
     */
    type LegacyDocument = {
      execCommand?: (commandId: string, showUI?: boolean, value?: string) => boolean;
    };
    const ok = (document as LegacyDocument).execCommand?.('copy') ?? false;
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function initCopy(): void {
  document.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-copy]');
    if (!btn || btn.dataset.busy === 'true') return;

    const card = btn.closest('.contact__card');
    const text = card?.querySelector('[data-copy-text]')?.textContent?.trim() ?? '';
    if (!text) return;

    btn.dataset.busy = 'true';
    const ok = await copy(text);

    const original = btn.textContent;
    btn.textContent = ok ? '已复制' : '请手动复制';
    if (ok) btn.dataset.copied = 'true';

    window.setTimeout(() => {
      btn.textContent = original;
      delete btn.dataset.busy;
      delete btn.dataset.copied;
    }, RESET_DELAY);
  });
}
