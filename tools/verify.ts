/**
 * 站点验证脚本（开发用，不参与构建）。
 *
 * 不只是截图，同时检查这些容易上线才发现的问题：
 *   - 图片 404 / 加载失败（自然宽度为 0）
 *   - 控制台报错与页面异常
 *   - 横向溢出（移动端最常见的问题）
 *   - 首屏加载体积
 *
 * 运行：node --experimental-strip-types tools/verify.ts [baseUrl]
 */
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4321/';
const OUT = new URL('../.verify/', import.meta.url).pathname;

/**
 * 复用本机已缓存的 Playwright 浏览器，避免为了验证再下载一份。
 * 版本与 playwright-core 不匹配时，直接指定可执行文件即可。
 */
function findExecutable(): string | undefined {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = `${homedir()}/Library/Caches/ms-playwright`;
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root)
    .filter((d) => d.startsWith('chromium_headless_shell-'))
    .sort()
    .reverse();
  for (const d of dirs) {
    const p = `${root}/${d}/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
    if (existsSync(p)) return p;
  }
  return undefined;
}

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1180, height: 800 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
];

mkdirSync(OUT, { recursive: true });

const executablePath = findExecutable();
if (executablePath) console.log(`使用浏览器：${executablePath}`);

const browser = await chromium.launch({
  args: ['--no-sandbox'],
  ...(executablePath ? { executablePath } : {}),
});
const results: string[] = [];
let failures = 0;

const log = (ok: boolean, msg: string) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  results.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) failures++;
};

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    isMobile: vp.name === 'mobile',
    hasTouch: vp.name === 'mobile',
  });
  const page = await ctx.newPage();

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  let transferred = 0;

  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('requestfailed', (r) => failedRequests.push(`${r.url()} :: ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    const len = Number(r.headers()['content-length'] ?? 0);
    if (Number.isFinite(len)) transferred += len;
  });

  console.log(`\n── ${vp.name} ${vp.width}×${vp.height} ──`);
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60_000 });

  // 滚到底触发懒加载，再回到顶部。
  // 注意：页面开了 scroll-behavior:smooth，必须临时关掉，否则这里是动画滚动、
  // 循环结束时根本没到底，懒加载和入场动效都不会被触发（会误判成页面空白）。
  await page.evaluate(async () => {
    const prev = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo(0, 0);
    document.documentElement.style.scrollBehavior = prev;
    await new Promise((r) => setTimeout(r, 400));
  });

  // 入场动效不应导致内容长期不可见
  const hidden = await page.evaluate(() => {
    const all = [...document.querySelectorAll<HTMLElement>('.reveal')];
    return {
      total: all.length,
      notShown: all.filter((el) => getComputedStyle(el).opacity === '0').length,
    };
  });
  log(
    hidden.notShown === 0,
    `入场动效后内容全部可见（${hidden.total} 个动效元素，不可见 ${hidden.notShown} 个）`
  );

  log(pageErrors.length === 0, `无 JS 异常${pageErrors.length ? `：${pageErrors[0]}` : ''}`);
  log(
    consoleErrors.length === 0,
    `无控制台报错${consoleErrors.length ? `：${consoleErrors.slice(0, 2).join(' | ')}` : ''}`
  );

  const realFails = failedRequests.filter((f) => !/net::ERR_ABORTED/.test(f));

  // 破图检测（灯箱的占位 img 初始 src 为空，不算破图）
  const imgStats = await page.evaluate(() => {
    const all = Array.from(document.images);
    const broken = all
      .filter((img) => (img.getAttribute('src') ?? img.currentSrc ?? '') !== '')
      .filter((img) => img.complete && img.naturalWidth === 0)
      .map((img) => img.currentSrc || img.src);
    return { total: all.length, broken };
  });
  log(
    imgStats.broken.length === 0,
    `图片全部加载成功（共 ${imgStats.total} 张）${imgStats.broken.length ? ` 破图：${imgStats.broken.slice(0, 3).join(', ')}` : ''}`
  );
  log(
    realFails.length === 0,
    `无失败请求${realFails.length ? `：${realFails[0]}` : ''}`
  );

  // 横向溢出：只需关注「是否真的能横向滚动」，
  // 首屏 Ken Burns 的 scale() 会被 overflow:hidden 裁掉，不算问题。
  const overflow = await page.evaluate(() => {
    const docW = document.documentElement.clientWidth;
    return {
      docW,
      scrollW: document.documentElement.scrollWidth,
      canScroll: document.documentElement.scrollWidth > docW + 1,
    };
  });
  log(
    !overflow.canScroll,
    `页面不可横向滚动（scrollWidth=${overflow.scrollW} / 视口 ${overflow.docW}）`
  );

  // 无障碍基础检查
  const a11y = await page.evaluate(() => ({
    h1: document.querySelectorAll('h1').length,
    imgsNoAlt: Array.from(document.images).filter((i) => !i.hasAttribute('alt')).length,
    lang: document.documentElement.lang,
    title: document.title,
  }));
  log(a11y.h1 === 1, `恰好一个 h1（实际 ${a11y.h1}）`);
  log(a11y.imgsNoAlt === 0, `所有 img 都有 alt（缺 ${a11y.imgsNoAlt} 个）`);
  log(a11y.lang === 'zh-CN', `html lang = ${a11y.lang}`);

  console.log(`  · 页面传输约 ${(transferred / 1024 / 1024).toFixed(2)} MB`);

  // 截图：首屏 + 整页
  await page.screenshot({ path: `${OUT}${vp.name}-top.png` });
  if (vp.name === 'desktop' || vp.name === 'mobile') {
    await page.screenshot({ path: `${OUT}${vp.name}-full.png`, fullPage: true });
  }

  await ctx.close();
}

// 灯箱交互验证（桌面）
{
  console.log('\n── 灯箱交互 ──');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const firstTile = page.locator('[data-lightbox]').first();
  await firstTile.scrollIntoViewIfNeeded();
  await firstTile.click();
  /*
   * 必须等图片真的加载完成再断言分辨率。
   * dev 模式下 Astro 是「按需生成」图片，大图要 3~4 秒才回；
   * 生产构建里图片是预先产出的，几乎瞬时。
   * 之前只等 600ms，在 dev 下必假失败（naturalWidth=0）。
   */
  await page
    .waitForFunction(
      () => {
        const img = document.getElementById('lbImg') as HTMLImageElement | null;
        return Boolean(img && img.complete && img.naturalWidth > 0);
      },
      { timeout: 20_000 }
    )
    .catch(() => {});
  await page.waitForTimeout(300);

  const opened = await page.evaluate(() => {
    const lb = document.getElementById('lightbox');
    const img = document.getElementById('lbImg');
    return {
      hidden: lb?.hidden,
      open: lb?.classList.contains('is-open'),
      src: img?.getAttribute('src')?.slice(0, 60),
      natural: (img as HTMLImageElement)?.naturalWidth,
      caption: document.getElementById('lbCaption')?.textContent,
      count: document.getElementById('lbCount')?.textContent,
      locked: document.body.classList.contains('is-locked'),
    };
  });
  log(opened.open === true && opened.hidden === false, `点击缩略图可打开灯箱`);
  log(
    (opened.natural ?? 0) >= 640,
    `灯箱大图分辨率足够（naturalWidth=${opened.natural}，需 ≥640）`
  );
  log(Boolean(opened.caption), `显示说明文字：「${opened.caption}」`);
  log(opened.locked === true, '打开时锁定页面滚动');
  await page.screenshot({ path: `${OUT}lightbox.png` });

  // 键盘：→ 翻页，Esc 关闭
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(350);
  const after = await page.textContent('#lbCount');
  log(after !== opened.count, `方向键可翻页（${opened.count} → ${after}）`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const closed = await page.evaluate(() => document.getElementById('lightbox')?.hidden);
  log(closed === true, 'Esc 可关闭灯箱');
  await ctx.close();
}

await browser.close();

console.log(`\n═══ 结果：${failures === 0 ? '全部通过' : `${failures} 项未通过`} ═══`);
console.log(`截图目录：${OUT}`);
process.exit(failures === 0 ? 0 : 1);
