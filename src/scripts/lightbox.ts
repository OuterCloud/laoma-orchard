/**
 * 画廊灯箱。
 * 目标尺寸的大图在构建期由 Astro 生成 srcset，这里只负责交互与状态，
 * 不在客户端做任何图片转换（v6 起客户端调用 getImage() 会直接抛错）。
 */

interface Tile {
  full: string;
  srcset: string;
  sizes: string;
  width: number;
  height: number;
  caption: string;
  alt: string;
}

const FOCUSABLE = 'button, [href], input, [tabindex]:not([tabindex="-1"])';

export function initLightbox(): void {
  const box = document.getElementById('lightbox');
  const img = document.getElementById('lbImg') as HTMLImageElement | null;
  const cap = document.getElementById('lbCaption');
  const count = document.getElementById('lbCount');
  if (!box || !img || !cap || !count) return;
  // 避免重复初始化（视图过渡或二次调用时）
  if (box.dataset.bound === 'true') return;
  box.dataset.bound = 'true';

  const tiles: Tile[] = Array.from(
    document.querySelectorAll<HTMLElement>('[data-lightbox]')
  ).map((el) => {
    const img = el.querySelector('img');
    return {
      full: el.dataset.full ?? img?.currentSrc ?? img?.src ?? '',
      srcset: el.dataset.srcset ?? img?.getAttribute('srcset') ?? '',
      sizes: el.dataset.sizes ?? img?.getAttribute('sizes') ?? '',
      width: Number(el.dataset.width ?? 0),
      height: Number(el.dataset.height ?? 0),
      caption: el.dataset.caption ?? '',
      alt: img?.alt ?? '',
    };
  });

  if (!tiles.length) return;

  let index = 0;
  let lastFocus: HTMLElement | null = null;

  const render = (i: number) => {
    index = (i + tiles.length) % tiles.length;
    const t = tiles[index]!;
    img.src = t.full;
    if (t.srcset) img.srcset = t.srcset;
    else img.removeAttribute('srcset');
    if (t.sizes) img.sizes = t.sizes;
    if (t.width) img.width = t.width;
    if (t.height) img.height = t.height;
    img.alt = t.alt;
    cap.textContent = t.caption;
    count.textContent = `${index + 1} / ${tiles.length}`;
  };

  const open = (i: number) => {
    lastFocus = document.activeElement as HTMLElement;
    render(i);
    box.hidden = false;
    document.body.classList.add('is-locked');
    requestAnimationFrame(() => {
      box.classList.add('is-open');
      // 必须把焦点移进对话框：否则键盘用户 Tab 会跑到背后的页面内容上，
      // 屏幕阅读器也不会播报对话框内容。
      const closeBtn = box.querySelector<HTMLElement>('.lightbox__close');
      closeBtn?.focus({ preventScroll: true });
    });
  };

  const close = () => {
    box.classList.remove('is-open');
    document.body.classList.remove('is-locked');
    window.setTimeout(() => {
      box.hidden = true;
      img.removeAttribute('srcset');
      lastFocus?.focus({ preventScroll: true });
    }, 300);
  };

  // 通过事件委托绑定，容忍画廊后续被动态替换
  document.addEventListener('click', (e) => {
    const trigger = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-lightbox]'
    );
    if (!trigger) return;
    e.preventDefault();
    const idx = Number(trigger.dataset.index ?? 0);
    open(Number.isFinite(idx) ? idx : 0);
  });

  document.getElementById('lbClose')?.addEventListener('click', close);
  document.getElementById('lbPrev')?.addEventListener('click', () => render(index - 1));
  document.getElementById('lbNext')?.addEventListener('click', () => render(index + 1));

  // 点击空白处关闭（不误伤图片本身）
  box.addEventListener('click', (e) => {
    if (e.target === box || (e.target as HTMLElement).classList.contains('lightbox__stage')) {
      close();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    switch (e.key) {
      case 'Escape': close(); break;
      case 'ArrowLeft': render(index - 1); break;
      case 'ArrowRight': render(index + 1); break;
      case 'Tab': {
        // 焦点锁在灯箱内部
        const nodes = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!nodes.length) return;
        const first = nodes[0]!;
        const last = nodes[nodes.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        break;
      }
    }
  });

  // 触屏左右滑动翻页
  let startX = 0;
  box.addEventListener('touchstart', (e) => {
    startX = e.changedTouches[0]?.clientX ?? 0;
  }, { passive: true });
  box.addEventListener('touchend', (e) => {
    const dx = (e.changedTouches[0]?.clientX ?? 0) - startX;
    if (Math.abs(dx) > 48) render(index + (dx < 0 ? 1 : -1));
  }, { passive: true });
}
