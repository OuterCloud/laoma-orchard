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
    // execCommand 已废弃，但仍是 http 源（非安全上下文）下唯一的兜底方案
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const ok = document.execCommand('copy');
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
