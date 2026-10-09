/**
 * 导航行为：滚动状态、移动端抽屉、阅读进度。
 *
 * 导航栏**常驻显示**，不再随滚动收起。
 * （此前是「下滚隐藏、上滚恢复」，但那会让导航时有时无，
 *  用户在页面中部就找不到入口了。）
 */

function onScroll(nav: HTMLElement, bar: HTMLElement | null): void {
  const y = window.scrollY;
  // 滚过一点就换成浅底 + 深字，保证压在照片上也读得清
  nav.classList.toggle('is-scrolled', y > 24);

  if (bar) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = max > 0 ? `${Math.min(100, (y / max) * 100)}%` : '0%';
  }
}

export function initNav(): void {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const bar = document.getElementById('progressBar');

  let ticking = false;
  const handle = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      onScroll(nav, bar);
      ticking = false;
    });
  };

  window.addEventListener('scroll', handle, { passive: true });
  onScroll(nav, bar);

  /* ── 移动端抽屉 ── */
  const toggle = document.getElementById('navToggle');
  const drawer = document.getElementById('drawer');
  if (!toggle || !drawer) return;

  const setOpen = (open: boolean) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    document.body.classList.toggle('is-locked', open);

    if (open) {
      // 先取消 hidden 再加 class，保证淡入过渡生效；
      // 回调里复查状态，避免快速连点时被过期的帧重新打开。
      drawer.hidden = false;
      requestAnimationFrame(() => {
        if (toggle.getAttribute('aria-expanded') === 'true') drawer.classList.add('is-open');
      });
    } else {
      drawer.classList.remove('is-open');
      // 等淡出结束再真正隐藏，避免过渡被打断
      window.setTimeout(() => {
        if (toggle.getAttribute('aria-expanded') !== 'true') drawer.hidden = true;
      }, 400);
    }
  };

  toggle.addEventListener('click', () =>
    setOpen(toggle.getAttribute('aria-expanded') !== 'true')
  );

  drawer.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => setOpen(false))
  );

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });

  // 拖动窗口到桌面宽度时收起抽屉，避免状态卡住
  window.matchMedia('(min-width: 941px)').addEventListener('change', (e) => {
    if (e.matches) setOpen(false);
  });
}
