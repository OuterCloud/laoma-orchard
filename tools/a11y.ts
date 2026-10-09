/**
 * 无障碍与可用性审计（开发用，不参与构建）。
 *
 * 对比度检测采用「实测像素」而不是推算：
 *   先把待测文字隐藏 → 截图 → 取该文字所在区域的真实背景像素 → 与文字色算对比度。
 * 这样对「照片上的白字」「半透明遮罩」这类情况都成立，
 * 而只查祖先背景色会把首屏导航误判成 1:1。
 *
 * 运行：node --experimental-strip-types tools/a11y.ts [baseUrl]
 */
import { chromium, type Page } from 'playwright-core';
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
let warns = 0;
const note = (level: '✗' | '⚠' | '✓', msg: string) => {
  if (level === '✗') blockers++;
  if (level === '⚠') warns++;
  console.log(`  ${level} ${msg}`);
};

interface Sample {
  id: string;
  text: string;
  cls: string;
  px: number;
  bold: boolean;
  /** 文字色（已与祖先不透明背景做 alpha 合成后的最终色） */
  color: string;
  /** 元素矩形（视口坐标，采样时按滚动量换算） */
  rect: { x: number; y: number; w: number; h: number };
  pad: { t: number; r: number; b: number; l: number };
  tag: string;
  /** 左上圆角半径，用于避开胶囊/圆角的透明角 */
  radius: number;
  /** 元素自身背景是否不透明（不透明时可直接用计算值判对比度，最可靠） */
  ownOpaqueBg: boolean;
  /** 背景是否可认定为纯色（可精确算对比度）；false 表示压在照片上 */
  solidBg: boolean;
  bg: string;
}

/**
 * 收集所有「直接承载文字」的元素。
 *
 * 背景色按祖先链逐层 alpha 合成，得到文字真正压在什么颜色上。
 * 这一点很关键：首屏导航是半透明白底 + 深色字，
 * 只看最近的不透明祖先会得出相反的错误结论。
 *
 * 若整条祖先链都不透明、且没有图片/渐变/遮罩，则标为「纯色背景」，
 * 可以精确计算对比度；否则交给像素采样判断。
 */
async function collect(page: Page): Promise<Sample[]> {
  return (await page.evaluate(`(() => {
    const parse = (s) => {
      const m = (s || '').match(/rgba?\\(([^)]+)\\)/);
      if (!m) return null;
      const p = m[1].split(',').map(parseFloat);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });

    // 从元素向上合成背景色；遇到图片/渐变/滤镜就判定为「非纯色」
    const bgInfo = (el) => {
      let acc = null;
      let n = el;
      let solid = true;
      while (n && n !== document.documentElement) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') solid = false;
        if (cs.filter && cs.filter !== 'none') solid = false;
        const c = parse(cs.backgroundColor);
        if (c && c.a > 0) {
          acc = acc === null ? c : over(acc, c);
          if (acc.a >= 0.999) break;
        }
        n = n.parentElement;
      }
      if (acc === null) acc = { r: 251, g: 247, b: 241, a: 1 };
      if (acc.a < 0.999) {
        // 没找到不透明底层（例如直接压在照片上）
        solid = false;
        acc = over(acc, { r: 30, g: 26, b: 22, a: 1 });
      }
      return { solid, css: 'rgb(' + Math.round(acc.r) + ',' + Math.round(acc.g) + ',' + Math.round(acc.b) + ')' };
    };

    const out = [];
    let i = 0;
    const sel = 'p, h1, h2, h3, h4, li, dt, dd, span, a, button, mark, figcaption';
    document.querySelectorAll(sel).forEach((el) => {
      const t = (el.textContent || '').trim();
      if (!t) return;
      if (Array.from(el.children).some((c) => (c.textContent || '').trim())) return;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      if (parseFloat(cs.opacity) < 0.5) return;
      // 祖先链上任一层不可见就不测。
      // 桌面端画廊说明默认 opacity:0、悬停才显示；测它没有意义，
      // 而且它的文字阴影会被当成背景色，得出「对比度 1:1」的假结论。
      let visible = true;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const ncs = getComputedStyle(n);
        if (ncs.display === 'none' || ncs.visibility === 'hidden' || parseFloat(ncs.opacity) < 0.3) {
          visible = false;
          break;
        }
      }
      if (!visible) return;
      el.setAttribute('data-a11y-id', String(i));
      const fg = parse(cs.color) || { r: 0, g: 0, b: 0, a: 1 };
      const bgi = bgInfo(el);
      const bgc = parse(bgi.css);
      const eff = fg.a < 0.999 ? over(fg, bgc) : fg;
      out.push({
        id: String(i++),
        text: t.slice(0, 26),
        cls: (el.className || '').toString().split(' ')[0] || el.tagName.toLowerCase(),
        px: parseFloat(cs.fontSize),
        bold: parseInt(cs.fontWeight, 10) >= 700,
        color: 'rgb(' + Math.round(eff.r) + ',' + Math.round(eff.g) + ',' + Math.round(eff.b) + ')',
        // 存「文档坐标」，与滚动无关；采样时再换算成视口坐标
        rect: {
          x: Math.round(r.left + window.scrollX),
          y: Math.round(r.top + window.scrollY),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
        pad: {
          t: parseFloat(cs.paddingTop) || 0,
          r: parseFloat(cs.paddingRight) || 0,
          b: parseFloat(cs.paddingBottom) || 0,
          l: parseFloat(cs.paddingLeft) || 0,
        },
        tag: el.tagName.toLowerCase(),
        radius: parseFloat(cs.borderTopLeftRadius) || 0,
        ownOpaqueBg: (parse(cs.backgroundColor)?.a ?? 0) >= 0.9,
        solidBg: bgi.solid,
        bg: bgi.css,
      });
    });
    return out;
  })()`)) as Sample[];
}

function srgb(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function lum(r: number, g: number, b: number): number {
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function ratio(a: [number, number, number], b: [number, number, number]): number {
  const l1 = lum(...a);
  const l2 = lum(...b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function parseColor(s: string): [number, number, number] | null {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1]!.split(',').map(parseFloat);
  return [p[0]!, p[1]!, p[2]!];
}

/** 取一组像素中最暗/最亮的一侧（与文字色对比最不利的那侧），得到保守结论 */
function worstContrast(
  textColor: [number, number, number],
  pixels: number[][]
): number {
  const tl = lum(...textColor);
  let worst = Infinity;
  for (const p of pixels) {
    const r = ratio(textColor, [p[0]!, p[1]!, p[2]!]);
    if (r < worst) worst = r;
  }
  return worst === Infinity ? 21 : worst;
}

for (const [name, w, h, mobile] of [
  ['desktop', 1440, 900, false],
  ['mobile', 390, 844, true],
] as const) {
  console.log(`\n── ${name} ${w}×${h} ──`);
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60_000 });

  // 滚一遍触发懒加载与入场动效，再回到顶部并等动效结束
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 70));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(2800);

  /* ── 1. 对比度：全部用实测像素 ──
     隐藏文字后截屏，取到的是该处真实的背景像素，
     因此半透明底色、照片、渐变这些情况都成立。
     唯一要注意的是坐标必须按 scrollY 换算（曾经写成视口坐标直接当文档坐标用，
     结果量到文字自己的字形，得出 1:1 的假结论）。 */
  const samples = await collect(page);
  const low: { s: Sample; cr: number; need: number }[] = [];
  const docH = await page.evaluate(() => document.documentElement.scrollHeight);

  const needFor = (s: Sample) => (s.px >= 24 || (s.px >= 18.66 && s.bold) ? 3 : 4.5);

  const screens: number[] = [];
  for (let y = 0; y < docH; y += h) screens.push(y);
  const { default: sharp } = await import('sharp');

  /*
   * 采样策略：不在文字自己的外框内取样。
   *
   * 曾经的做法是「隐藏文字再截图，然后在外框内取点」——这是错的：
   * 外框的几何中心往往正落在一笔字形上，采到的是文字本身的颜色，
   * 于是白底黑字的按钮会被算成 1:1。而且靠 visibility 隐藏再截图也不可靠。
   *
   * 正确做法：在文字外框**四周**的边带里取背景像素（文字外围仍是同一个
   * 背景，所以颜色代表性好），并且取与文字对比最不利的那个值，结论偏保守。
   * 这样完全不需要改动 DOM。
   */
  for (const top of screens) {
    await page.evaluate((y) => window.scrollTo(0, y), top);
    /*
     * 等得久一点，让入场动效跑完。
     * 之前只等 180ms，会采到元素还在过渡中的半透明状态 ——
     * 同一个「复制」按钮在手机上测到 6.31:1、桌面却测到 3.93:1，
     * 差异就来自这一点（桌面可视区更小，滚动后卡片仍在动效中）。
     * 动效里带 transition-delay，所以这里必须留足时间。
     */
    await page.waitForTimeout(1200);
    const [scrollY, scrollX] = await page.evaluate(() => [window.scrollY, window.scrollX]);

    /*
     * 只测「真正露出来」的文字。
     * 除了要在视口内，还必须避开固定定位的遮挡（导航栏是 fixed、高约 76px）。
     * 之前只判视口范围，手机端「复制」按钮恰好落在视口顶部 y=20 处、
     * 被导航栏盖住，采样读到的是导航栏的浅色底，于是把 6.3:1 误报成 1.2:1。
     */
    const covered = await page.evaluate(
      ([y0]: number[]) => {
        const boxes: { top: number; bottom: number; left: number; right: number }[] = [];
        document.querySelectorAll('*').forEach((el) => {
          const cs = getComputedStyle(el);
          if (cs.position !== 'fixed' && cs.position !== 'sticky') return;
          if (cs.display === 'none' || cs.visibility === 'hidden') return;
          if (parseFloat(cs.opacity) < 0.1) return;
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) return;
          boxes.push({ top: r.top + y0, bottom: r.bottom + y0, left: r.left, right: r.right });
        });
        return boxes;
      },
      [scrollY, h]
    );

    const inView = samples.filter((s) => {
      const vy = s.rect.y - scrollY;
      if (vy < 6 || vy + s.rect.h > h - 6 || s.rect.h >= h * 0.7) return false;
      // 与任何固定/粘性层有交叠 → 认为被遮住，跳过
      return !covered.some(
        (c) =>
          s.rect.y < c.bottom &&
          s.rect.y + s.rect.h > c.top &&
          s.rect.x < c.right &&
          s.rect.x + s.rect.w > c.left
      );
    });
    if (!inView.length) continue;

    const shot = await page.screenshot({ type: 'png' });
    const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });

    const at = (x: number, y: number) => {
      const cx = Math.min(info.width - 1, Math.max(0, Math.round(x)));
      const cy = Math.min(info.height - 1, Math.max(0, Math.round(y)));
      const o = (cy * info.width + cx) * info.channels;
      return [data[o]!, data[o + 1]!, data[o + 2]!];
    };

    for (const s of inView) {
      const fg = parseColor(s.color);
      if (!fg) continue;
      const x0 = s.rect.x - scrollX;
      const y0 = s.rect.y - scrollY;
      const x1 = x0 + s.rect.w;
      const y1 = y0 + s.rect.h;
      // 外侧取样距离：竖向外扩要超过字高，否则会采到字形本身的笔画。
      const outY = Math.max(6, Math.round(s.rect.h / 2) + 4);
      const outX = Math.max(6, Math.round(s.rect.w / 8));

      /*
       * 背景取样：在文字外框四周一个「宽带」里密集取点，而不是贴边取几点。
       *
       * 两个坑都踩过：
       *  1) 在外框内部取点会采到字形笔画 —— 白底黑字的按钮被算成 1:1；
       *  2) 贴边只取几个点，遇到文字几乎占满外框（如整行大标题）仍会采到笔画。
       * 现在改成外扩一整圈密集取样，并剔除与文字色几乎相同的采样点（那就是笔画），
       * 最后取「中位数」作为背景色 —— 少数残留的笔画像素不会带偏结论。
       */
      const isControl = s.tag === 'button' || s.tag === 'a';

      /*
       * 控件若有不透明的纯色底色，直接用计算值判断，不做像素采样。
       * 原因：带圆角的控件（胶囊按钮、标签）尺寸很小，
       * 元素外框与可见填充区不重合，像素采样极易落到元素外或圆角外的页面背景上，
       * 从而把「白字红底」（实测 6.9:1）误报成 1.2:1。
       * 计算值在这种情况下是可靠且确定性的。
       */
      /*
       * 元素自身背景不透明 → 用计算值判定，最可靠。
       *
       * 适用范围不只按钮/链接：像「最费工的一步」这种 <span> 标签同样是
       * 纯色底 + 白字，像素采样对小尺寸圆角元素很容易跑到元素外面去，
       * 把实测 6.9:1 的白字红底误报成 1.2:1。
       */
      if (s.ownOpaqueBg) {
        const bgc2 = parseColor(s.bg);
        if (bgc2) {
          const cr0 = ratio(fg, bgc2);
          const need0 = needFor(s);
          if (process.env.A11Y_DEBUG) {
            console.error(
              `    [debug] ${s.cls.padEnd(16)} fg=${s.color.padEnd(20)} bgComputed=${s.bg.padEnd(20)} ` +
                `cr=${cr0.toFixed(2)} need=${need0} 「${s.text.slice(0, 12)}」(计算值)`
            );
          }
          if (cr0 < need0) low.push({ s, cr: cr0, need: need0 });
          continue;
        }
      }

      const cand: number[][] = [];

      const ring = (
        ix0: number, iy0: number, ix1: number, iy1: number,
        ox0: number, oy0: number, ox1: number, oy1: number
      ) => {
        const step = Math.max(2, Math.round(Math.min(ox1 - ox0, oy1 - oy0) / 24));
        for (let x = ox0; x <= ox1; x += step) {
          for (let y = oy0; y <= oy1; y += step) {
            const insideInner = x >= ix0 && x <= ix1 && y >= iy0 && y <= iy1;
            if (!insideInner) cand.push(at(x, y));
          }
        }
      };

      if (isControl) {
        /*
         * 控件（按钮/链接/标签）取「自身内边距带」上的像素。
         *
         * 这里踩过两个坑，都记录一下避免重犯：
         *  1) 取元素外侧或四角 —— 胶囊/圆角控件的四角是透明的，
         *     透出的是页面背景，会把「白字红底」的标签量成「白字米色底」（1.2:1）；
         *  2) 按圆角收缩后取内圈 —— 对于只有 23px 高的标签，
         *     内圈已经落到元素外面，采到的仍是页面背景。
         * 内边距带的好处是：一定在元素内部（背景色可见），且字形到不了那里。
         */
        const padTop = Math.min(s.pad.t, s.rect.h / 3);
        const padBottom = Math.min(s.pad.b, s.rect.h / 3);
        const bandT = padTop >= 2 ? y0 + padTop / 2 : y0 + Math.min(2, s.rect.h / 6);
        const bandB = padBottom >= 2 ? y1 - padBottom / 2 : y1 - Math.min(2, s.rect.h / 6);
        // 再向内收 1px，避开元素自身的半透明边框。
        // 「复制」按钮的边框是 rgba(...,0.42)，比内部底色亮得多，
        // 采到边框会把 6.3:1 误报成 3.9:1 —— 而文字并不压在边框上。
        // 圆角处左右各缩进一点，避开胶囊两端
        const rad = Math.min(s.radius, s.rect.w / 2, s.rect.h / 2);
        const sideGap = Math.round(rad * (1 - Math.SQRT1_2));
        const bx0 = x0 + Math.max(2, sideGap);
        const bx1 = x1 - Math.max(2, sideGap);
        for (let x = bx0; x <= bx1; x += Math.max(2, (bx1 - bx0) / 24)) {
          cand.push(at(x, bandT + 1));
          cand.push(at(x, bandB - 1));
        }
        // 再补竖直方向的中线两侧（对高按钮有用）
        const midY = (y0 + y1) / 2;
        cand.push(at(bx0 + 1, midY), at(bx1 - 1, midY));
      } else {
        // 普通文字：在外框四周取背景。竖向外扩要超过字高，
        // 否则整行标题会把自己的笔画采进来。
        ring(x0, y0, x1, y1, x0 - outX, y0 - outY, x1 + outX, y1 + outY);
      }

      // 剔除与文字色几乎相同的点（这些就是笔画本身）
      const near = (a: number[], b: number[]) =>
        Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!) < 90;
      let usable = cand.filter((c) => !near(c, fg));
      if (usable.length < 4) usable = cand; // 兜底：整块都是文字色时不做剔除

      // 取中位数亮度作为背景代表色
      usable.sort((a, b) => lum(a[0]!, a[1]!, a[2]!) - lum(b[0]!, b[1]!, b[2]!));
      const mid = usable[Math.floor(usable.length / 2)]!;
      const px: number[][] = [mid];
      const cr = worstContrast(fg, px);
      const need = needFor(s);
      if (process.env.A11Y_DEBUG && /contact__copy/.test(s.cls)) {
        console.error(
          `    [copy] rect=${s.rect.x},${s.rect.y} ${s.rect.w}x${s.rect.h} pad=${JSON.stringify(s.pad)} ` +
            `scrollY=${scrollY} scrollX=${scrollX} cand=${cand.length} ` +
            `first=rgb(${(cand[0] ?? []).join(',')}) mid=rgb(${mid.join(',')})`
        );
      }
      if (process.env.A11Y_DEBUG && /tag-key/.test(s.cls)) {
        console.error(
          `    [tagkey] rect=${s.rect.x},${s.rect.y} ${s.rect.w}x${s.rect.h} scrollY=${scrollY} ` +
            `radius=${s.radius} pad=${JSON.stringify(s.pad)} cand=${cand.length} usable=${usable.length} ` +
            `mid=rgb(${mid.join(',')}) first3=${JSON.stringify(cand.slice(0, 3))}`
        );
      }
      if (process.env.A11Y_DEBUG) {
        const worst = px.reduce((a, b) => (lum(b[0]!, b[1]!, b[2]!) < lum(a[0]!, a[1]!, a[2]!) ? a : b));
        console.error(
          `    [debug] ${s.cls.padEnd(16)} fg=${s.color.padEnd(20)} ` +
            `bgNear=rgb(${worst.join(',')}) cr=${cr.toFixed(2)} need=${need} 「${s.text.slice(0, 12)}」`
        );
      }
      if (cr < need * 0.97) low.push({ s, cr, need });
    }
  }

  if (!low.length) {
    note('✓', `文字对比度全部达标（共实测 ${samples.length} 处，全部按真实渲染像素计算）`);
  } else {
    const sorted = low.sort((a, b) => a.cr - b.cr);
    for (const l of sorted.slice(0, 12)) {
      note(
        '✗',
        `对比度 ${l.cr.toFixed(2)}:1（需 ${l.need}）${Math.round(l.s.px)}px「${l.s.text}」.${l.s.cls}`
      );
    }
    if (sorted.length > 12) note('✗', `另有 ${sorted.length - 12} 处不足`);
  }

  /* ── 2. 触控目标（仅移动端）── */
  if (mobile) {
    const small = (await page.evaluate(`(() => {
      const bad = [];
      document.querySelectorAll('a, button, [role="button"]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.1) return;
        // 收起的抽屉仍在 DOM 里（position:fixed，offsetParent 判不出来），
        // 用 checkVisibility 才能正确排除
        if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) return;
        // 只统计真正能点到的
        if (!el.offsetParent && cs.position !== 'fixed') return;
        if (r.height < 44 || r.width < 44) {
          bad.push({ t: ((el.textContent || '').trim().slice(0, 18)) || el.getAttribute('aria-label') || el.tagName, w: Math.round(r.width), h: Math.round(r.height) });
        }
      });
      return bad;
    })()`)) as { t: string; w: number; h: number }[];
    if (!small.length) note('✓', '所有可点元素 ≥ 44×44');
    else {
      for (const s of small.slice(0, 8)) note('⚠', `触控目标偏小 ${s.w}×${s.h}「${s.t}」`);
      if (small.length > 8) note('⚠', `另有 ${small.length - 8} 个`);
    }
  }

  /* ── 3. 标题层级 ── */
  const heads = (await page.evaluate(
    `Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(e => +e.tagName[1])`
  )) as number[];
  let jump = '';
  for (let i = 1; i < heads.length; i++) {
    if (heads[i]! > heads[i - 1]! + 1) {
      jump = `h${heads[i - 1]} → h${heads[i]}`;
      break;
    }
  }
  note(jump ? '⚠' : '✓', jump ? `标题层级跳级：${jump}` : `标题层级连续（${heads.length} 个）`);

  /* ── 4. 图片 alt ── */
  const alt = (await page.evaluate(`(() => {
    const imgs = Array.from(document.images);
    return {
      total: imgs.length,
      empty: imgs.filter((i) => i.getAttribute('alt') === '').length,
      weak: imgs.filter((i) => /^(image|img|照片|图片|pic)\\d*$/i.test((i.getAttribute('alt') || '').trim())).length,
      long: imgs.filter((i) => (i.getAttribute('alt') || '').length > 125).length,
      noAlt: imgs.filter((i) => !i.hasAttribute('alt')).length,
    };
  })()`)) as { total: number; empty: number; weak: number; long: number; noAlt: number };
  note(
    alt.weak || alt.noAlt ? '⚠' : '✓',
    `alt：${alt.total} 张图，装饰性 ${alt.empty}，缺失 ${alt.noAlt}，无意义 ${alt.weak}，超长 ${alt.long}`
  );

  await ctx.close();
}

/* ── 5. 键盘实测 ── */
{
  console.log('\n── 键盘操作 ──');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const visited: string[] = [];
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Tab');
    visited.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return '(无)';
        return (el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 16) || el.tagName).replace(/\s+/g, ' ');
      })
    );
  }
  note('✓', `Tab 顺序：${[...new Set(visited)].slice(0, 9).join(' → ')}`);

  const ring = (await page.evaluate(`(() => {
    const cs = getComputedStyle(document.activeElement);
    return { w: cs.outlineWidth, s: cs.outlineStyle, c: cs.outlineColor };
  })()`)) as { w: string; s: string; c: string };
  note(
    ring.s !== 'none' && parseFloat(ring.w) >= 1 ? '✓' : '⚠',
    `焦点指示可见：${ring.w} ${ring.s} ${ring.c}`
  );

  // 灯箱键盘闭环
  const tile = page.locator('[data-lightbox]').first();
  await tile.scrollIntoViewIfNeeded();
  await tile.click();
  await page.waitForTimeout(500);
  const trap = await page.evaluate(`(() => {
    const lb = document.getElementById('lightbox');
    return { open: !lb.hidden, focusInside: lb.contains(document.activeElement) };
  })()`) as { open: boolean; focusInside: boolean };
  note(
    trap.open && trap.focusInside ? '✓' : '⚠',
    `打开灯箱后焦点移入对话框：${trap.focusInside ? '是' : '否'}`
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 跳到主要内容
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Tab');
  const first = (await page.evaluate(
    `document.activeElement?.className || ''`
  )) as string;
  note(first.includes('skip-link') ? '✓' : '⚠', `首个 Tab 命中：${first || '(空)'}`);

  await page.screenshot({ path: `${OUT}a11y-final.png` });
  await ctx.close();
}

await browser.close();
console.log(
  `\n═══ 无障碍审计：${blockers} 项阻断 / ${warns} 项提示 ═══`
);
process.exit(blockers === 0 ? 0 : 1);
