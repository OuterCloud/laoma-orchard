/**
 * 首屏与滚动入场动效。
 * 用 IntersectionObserver 而非滚动监听，避免主线程抖动。
 */

const REDUCED = '(prefers-reduced-motion: reduce)';

/**
 * 兜底：入场动效只应该是「锦上添花」。
 * 任何情况下内容都不能长期不可见，所以设定一个时限，
 * 到点仍未进入视口的元素直接显示（例如锚点跳转、异常环境、观察器未触发）。
 */
const FALLBACK_MS = 2600;

export function initReveal(): void {
  const items = Array.from(document.querySelectorAll<HTMLElement>('.reveal'));
  if (!items.length) return;

  const showAll = () => items.forEach((el) => el.classList.add('is-in'));

  // 尊重系统设置：直接显示，不做动效
  if (window.matchMedia(REDUCED).matches) {
    showAll();
    return;
  }

  const reveal = (el: Element) => {
    el.classList.add('is-in');
    io.unobserve(el);
  };

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) reveal(entry.target);
      });
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.05 }
  );

  // 首屏内的元素立即进入，制造错落的开场
  const fold = window.innerHeight * 0.92;
  const deferred: HTMLElement[] = [];
  items.forEach((el) => {
    if (el.getBoundingClientRect().top < fold) el.classList.add('is-in');
    else deferred.push(el);
  });

  deferred.forEach((el) => io.observe(el));

  window.setTimeout(() => {
    deferred.forEach((el) => {
      if (!el.classList.contains('is-in')) reveal(el);
    });
  }, FALLBACK_MS);
}
