/**
 * 移动端体验审计（开发用，不参与构建）。
 *
 * 专门针对手机做的一轮检查，覆盖常见但容易忽略的问题：
 *   1. 极窄屏（320px，iPhone SE 一代 / 老安卓）是否还能正常阅读与点击
 *   2. 横向溢出（移动端最常见的缺陷）
 *   3. 固定导航是否遮挡内容（anchor 跳转后标题被盖住是高频问题）
 *   4. 触控目标是否 ≥44×44 且彼此不重叠
 *   5. 文字是否 ≥12px、行高是否够
 *   6. 一处一屏的排版：是否有元素超出视口、图片是否变形
 *   7. 抽屉菜单：打开后能否正常关闭、内容是否可滚
 *
 * 运行：node --experimental-strip-types tools/mobile.ts [baseUrl]
 */
import { chromium } from 'playwright-core';
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4321/';
const OUT = new URL('../.verify/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

function findExecutable(): string | undefined {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = `${homedir()}/Library/Caches/ms-playwright`;
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)
    .filter((x) => x.startsWith('chromium_headless_shell-'))
    .sort()
    .reverse()) {
    const p = `${root}/${d}/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
    if (existsSync(p)) return p;
  }
  return undefined;
}

const exe = findExecutable();
const browser = await chromium.launch({
  args: ['--no-sandbox'],
  ...(exe ? { executablePath: exe } : {}),
});

let blockers = 0;
const note = (ok: boolean, msg: string, warnOnly = false) => {
  if (!ok && !warnOnly) blockers++;
  console.log(`  ${ok ? '✓' : warnOnly ? '⚠' : '✗'} ${msg}`);
};

/** 常见手机尺寸，含极窄屏 */
const DEVICES: [string, number, number][] = [
  ['iPhone SE 一代 / 老安卓', 320, 568],
  ['iPhone 12 mini', 360, 780],
  ['iPhone 14 / 15', 390, 844],
  ['iPhone Pro Max', 430, 932],
  ['安卓大屏', 412, 915],
];

for (const [name, w, h] of DEVICES) {
  console.log(`\n── ${name}  ${w}×${h} ──`);
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(2200);

  /* 1. 横向溢出（最容易出问题的一项，320px 下尤其常见） */
  const of = await page.evaluate(() => {
    const docW = document.documentElement.clientWidth;
    const offenders: string[] = [];
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      if (r.width < 2) return;
      if (r.right > docW + 1 || r.left < -1) {
        /*
         * 只要任一祖先用了 overflow: hidden/clip 把溢出裁掉，就不算问题。
         * 首屏图就是这种情况：它被 .hero { overflow: hidden } 裁切，
         * 加上 heroDrift 的 scale(1.06)，自身 rect 必然略宽于视口，
         * 但页面实际不可横向滚动（scrollWidth === clientWidth）。
         */
        let p = el.parentElement;
        let clipped = false;
        while (p && p !== document.body) {
          const pcs = getComputedStyle(p);
          if (pcs.overflowX !== 'visible' || pcs.overflowY !== 'visible') {
            clipped = true;
            break;
          }
          p = p.parentElement;
        }
        if (!clipped) offenders.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`);
      }
    });
    return {
      docW,
      scrollW: document.documentElement.scrollWidth,
      canScroll: document.documentElement.scrollWidth > docW + 1,
      offenders: [...new Set(offenders)].slice(0, 4),
    };
  });
  note(!of.canScroll, of.canScroll ? `可横向滚动（${of.scrollW} > ${of.docW}）：${of.offenders.join(', ')}` : '不可横向滚动');

  /* 2. 锚点跳转后标题是否被固定导航盖住 */
  const anchor = await page.evaluate(async () => {
    const nav = document.getElementById('nav');
    const navH = nav ? nav.getBoundingClientRect().height : 0;
    const out: string[] = [];
    for (const id of ['story', 'year', 'gallery', 'why', 'visit', 'contact']) {
      const el = document.getElementById(id);
      if (!el) continue;
      location.hash = '#' + id;
      await new Promise((r) => setTimeout(r, 260));
      const target = el.querySelector('h2') ?? el;
      const top = target.getBoundingClientRect().top;
      if (top < navH) out.push(`${id}(顶部${Math.round(top)} < 导航${Math.round(navH)})`);
    }
    history.replaceState(null, '', location.pathname);
    window.scrollTo(0, 0);
    return out;
  });
  note(anchor.length === 0, anchor.length ? `锚点跳转后被导航遮挡：${anchor.join(' ')}` : '锚点跳转标题不被导航遮挡', true);

  /* 3. 触控目标：尺寸 + 是否互相重叠 */
  const touch = await page.evaluate(() => {
    const items: { label: string; r: DOMRect }[] = [];
    document.querySelectorAll<HTMLElement>('a, button, [role="button"]').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      if (!el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      items.push({ label: (el.textContent || '').trim().slice(0, 12) || el.getAttribute('aria-label') || el.tagName, r });
    });
    const small = items.filter((i) => i.r.width < 44 || i.r.height < 44).map((i) => `${i.label}(${Math.round(i.r.width)}×${Math.round(i.r.height)})`);
    // 重叠检测：任意两个目标重叠面积超过较小者的 40%
    const overlaps: string[] = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!.r;
        const b = items[j]!.r;
        const ow = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ow <= 0 || oh <= 0) continue;
        const area = ow * oh;
        const minArea = Math.min(a.width * a.height, b.width * b.height);
        if (area / minArea > 0.4) overlaps.push(`${items[i]!.label} ∩ ${items[j]!.label}`);
      }
    }
    return { total: items.length, small, overlaps: [...new Set(overlaps)].slice(0, 4) };
  });
  note(touch.small.length === 0, touch.small.length ? `触控目标偏小：${touch.small.join(', ')}` : `触控目标全部 ≥44×44（共 ${touch.total} 个）`);
  note(touch.overlaps.length === 0, touch.overlaps.length ? `触控目标重叠：${touch.overlaps.join(', ')}` : '触控目标互不重叠', true);

  /* 4. 文字：最小字号与行高 */
  const typo = await page.evaluate(() => {
    let minSize = 99;
    let minLabel = '';
    let tightLine = '';
    document.querySelectorAll<HTMLElement>('p, li, h1, h2, h3, span, dd, figcaption, a').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (!t) return;
      if (Array.from(el.children).some((c) => (c.textContent || '').trim())) return;
      if (!el.checkVisibility({ checkVisibilityCSS: true })) return;
      const cs = getComputedStyle(el);
      const px = parseFloat(cs.fontSize);
      if (px < minSize) {
        minSize = px;
        minLabel = `${(el.className || el.tagName).toString().split(' ')[0]}「${t.slice(0, 12)}」`;
      }
      // 正文行高低于 1.5 会显得拥挤
      const lh = parseFloat(cs.lineHeight);
      if (!tightLine && px >= 14 && px <= 18 && Number.isFinite(lh) && lh / px < 1.5) {
        tightLine = `${(el.className || el.tagName).toString().split(' ')[0]}（${(lh / px).toFixed(2)}）`;
      }
    });
    return { minSize, minLabel, tightLine };
  });
  note(typo.minSize >= 12, `最小字号 ${typo.minSize}px ${typo.minSize >= 12 ? '' : '（应 ≥12）'} — ${typo.minLabel}`);
  note(!typo.tightLine, typo.tightLine ? `正文行高偏紧：${typo.tightLine}` : '正文行高充足', true);

  /* 5. 图片是否变形 / 是否超出视口 */
  const imgs = await page.evaluate(() => {
    const bad: string[] = [];
    document.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
      if (!img.checkVisibility({ checkVisibilityCSS: true })) return;
      const r = img.getBoundingClientRect();
      if (r.width < 2) return;
      // 同样只在「没有被祖先裁掉」时才算溢出
      if (r.right > document.documentElement.clientWidth + 1 || r.left < -1) {
        let clipped = false;
        let par: HTMLElement | null = img.parentElement;
        while (par && par !== document.body) {
          const pcs = getComputedStyle(par);
          if (pcs.overflowX !== 'visible' || pcs.overflowY !== 'visible') {
            clipped = true;
            break;
          }
          par = par.parentElement;
        }
        if (!clipped) bad.push(`溢出:${img.className || 'img'}`);
      }
      if (img.naturalWidth > 0) {
        const shown = r.width / r.height;
        const natural = img.naturalWidth / img.naturalHeight;
        // object-fit: cover 允许变形比例差，只提示极端情况
        const cs = getComputedStyle(img);
        if (cs.objectFit === 'fill' && Math.abs(shown - natural) / natural > 0.05) {
          bad.push(`拉伸:${img.className || 'img'}`);
        }
      }
    });
    return [...new Set(bad)];
  });
  note(imgs.length === 0, imgs.length ? `图片问题：${imgs.join(', ')}` : '图片无溢出/变形');

  /* 6. 抽屉菜单：能否打开并关闭 */
  const drawerOk = await page.evaluate(async () => {
    const toggle = document.getElementById('navToggle');
    const drawer = document.getElementById('drawer');
    if (!toggle || !drawer) return { ok: false, reason: '缺少元素' };
    (toggle as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 500));
    const opened = drawer.classList.contains('is-open') && getComputedStyle(drawer).visibility === 'visible';
    const linkCount = drawer.querySelectorAll('a').length;
    const firstLinkTop = drawer.querySelector('a')?.getBoundingClientRect().top ?? 0;
    (toggle as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 600));
    const closed = !drawer.classList.contains('is-open');
    return { ok: opened && closed, opened, closed, linkCount, firstLinkTop: Math.round(firstLinkTop) };
  });
  note(drawerOk.ok, `抽屉菜单：打开 ${drawerOk.opened ? '✓' : '✗'} / 关闭 ${drawerOk.closed ? '✓' : '✗'}，${drawerOk.linkCount ?? 0} 个链接`);

  /* 7. 首屏是否能在常见手机高度内看到关键信息 */
  const hero = await page.evaluate(() => {
    const title = document.getElementById('heroTitle');
    const actions = document.querySelector('.hero__actions');
    const vh = window.innerHeight;
    const t = title?.getBoundingClientRect();
    const a = actions?.getBoundingClientRect();
    return { titleTop: t ? Math.round(t.top) : -1, btnTop: a ? Math.round(a.top) : -1, vh };
  });
  note(hero.titleTop >= 0 && hero.titleTop < hero.vh, `首屏标题在首屏内（top=${hero.titleTop}）`);
  note(hero.btnTop > 0 && hero.btnTop < hero.vh * 1.6, `首屏按钮位置 ${hero.btnTop}（视口高 ${hero.vh}）`, true);

  note(errors.length === 0, errors.length ? `JS 报错：${errors[0]}` : '无 JS 报错');

  await page.screenshot({ path: `${OUT}m-${w}-top.png` });
  await ctx.close();
}

await browser.close();
console.log(`\n═══ 移动端审计：${blockers === 0 ? '全部通过' : `${blockers} 项未通过`} ═══`);
process.exit(blockers === 0 ? 0 : 1);
