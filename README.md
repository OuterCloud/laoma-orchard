# 老马苹果园 · 官方网站

山东聊城高唐县自家果园的官网。核心表达就一句话：**苹果是老马在果子还小的时候一个一个套的袋，整个生长季不打一滴农药。**

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/README.md](docs/README.md) | **上线全流程总览** + 费用清单（含一笔白花的钱） |
| [docs/01-买域名与解析.md](docs/01-买域名与解析.md) | 注册域名、实名认证、加解析记录、备案说明 |
| [docs/02-服务器部署.md](docs/02-服务器部署.md) | 部署到已有业务的服务器，不影响现有项目 |
| [docs/03-edgeone-为什么放弃.md](docs/03-edgeone-为什么放弃.md) | 免费托管方案的 401 与备案限制 |
| [docs/04-日常维护与排障.md](docs/04-日常维护与排障.md) | 更新网站、证书续期、故障排查 |
| [docs/05-踩坑记录.md](docs/05-踩坑记录.md) | 12 个实际踩过的坑，含原因与修法 |

线上地址：**<https://laoma-apples.site/>**

## 一、日常改内容（最常见）

**只需要改两个文件，不用碰任何代码。**

| 想改什么 | 改哪个文件 |
| --- | --- |
| 微信号、二维码、开放进园时间、方便联系的时间 | `src/data/site.json` |
| 照片的说明文字、图片替换 | `src/data/photos.json` + `src/assets/photos/` |
| 首屏用哪张照片 | `src/data/hero.json` |
| 页面大段文案（果园故事、套袋工序、为什么套袋…） | 对应组件，见下表 |

改完执行：

```bash
pnpm build      # 产出到 dist/
```

### 1. 填联系方式

打开 `src/data/site.json`，找到 `contact`。**当前状态**：

**联系信息已全部填好，页面上没有占位块了：**

| 字段 | 值 |
| --- | --- |
| `wechat` 微信昵称 | 天天开心（取自二维码名片） |
| `wechatQr` 微信二维码 | `wechat-qr.png` |
| `visitNote` 开放进园时间 | 10—11月 |
| `hours` 方便联系的时间 | 早 8 点—晚 5 点 |
| `place` 地址 | 山东省聊城市高唐县汇鑫办事处杨老村16号 |

改成别的内容直接编辑 `src/data/site.json` 对应字段即可：

```json
"visitNote": { "label": "开放进园", "value": "10—11月" },
"hours":     { "label": "方便联系的时间", "value": "早 8 点—晚 5 点" }
```

- `value` 有值就正常展示，留空则显示红色占位提示（不会把空值伪装成真信息）。
- 地址拆成了 `province / city / county / village / full` 五段：
  正文与页脚用 `full`，结构化数据用省市县加 `village`（门牌级），
  这样搜索引擎看到的地址不会把完整地址重复一遍。
- **只放微信、不放电话**：页面里没有电话入口。若以后想加，在 `site.json` 加一项，
  再到 `src/components/Contact.astro` 里加一张卡片。（电话容易被爬虫抓取，农业类客户通常只留微信。）

> ⚠️ 「天天开心」是微信**昵称**，不是微信号。昵称可以重名，如果你知道老马的微信号
> （wxid 或自定义 ID），填进 `wechat.value` 会更可靠，二维码则不受影响。

### 2. 换微信二维码

把新的二维码图片放到 `~/Downloads/老马苹果园/` 下、命名 `微信二维码.jpg`，然后：

```bash
pnpm qr
```

脚本会自动完成这些事：

1. 检测二维码三个角上的**定位图形**，据此算出码的边界与模块尺寸（不靠肉眼估）
2. 按二维码规范补足静区，并**把静区刷成纯白**（原始截图是 JPEG，下方文字的压缩伪影会蹭到边缘）
3. 放大到 880px 并用 **PNG** 保存 —— 二维码由纯色方块构成，最怕有损压缩伪影
4. 自检：静区必须全白、模块必须够大，不通过会直接报错

输出到 `src/assets/wechat-qr.png`。页面上按原分辨率加载（不经过 Astro 的有损转换），
显示约 200px，余量约 4.4 倍。

**二维码会出现两个位置**，共用同一张图（`src/lib/wechat-qr.ts` 统一解析）：

1. **联系区卡片**——页面底部，正常文档流内；
2. **右下角悬浮窗**——随页面滚动常驻，悬停或点击展开。
   鼠标设备悬停展开、移开收起；触屏点击展开、点别处收起；键盘 Tab 聚焦展开、Esc 收起。
   滚到联系区时**自动淡出**，因为那里已有同一张二维码，且避免在
   1200~1280px 这类桌面宽度下压住联系卡片。
   手机端（≤860px）不显示浮窗，避免遮挡正文。

### 3. 换果园照片

- 替换：把新照片覆盖 `src/assets/photos/<名字>.jpg` 即可，文件名别改。
- 新增：照片放进 `src/assets/photos/`，然后在 `src/data/photos.json` 里加一条：

```json
{ "id": "新照片名", "order": 14, "file": "新照片名.jpg",
  "caption": "卡片上显示的小标题", "alt": "给看不见图片的人 / 搜索引擎的描述" }
```

`order` 决定在画廊里的顺序。

> 照片必须放在 `src/assets/`。放在 `public/` 的图片**不会**被压缩、转格式，
> 也不会有响应式尺寸，这是 Astro 的既定行为。

### 4. 首屏照片

原片是竖幅手机照，首屏需要横构图，所以要单独裁一份。改 `src/data/hero.json`：

```json
{ "from": "tall-tree", "focus": 0.34 }
```

- `from`：用 `tools/photos.json` 里的 slug
- `focus`：纵向取景，`0` 顶部、`1` 底部

改完执行：

```bash
pnpm hero
```

会重新生成 `src/assets/crops/hero.jpg`（横版）和 `hero-tall.jpg`（竖版）。

### 5. 大段文案在哪

| 区块 | 文件 |
| --- | --- |
| 顶部导航、手机抽屉菜单 | `src/components/SiteNav.astro` |
| 首屏 | `src/components/Hero.astro` |
| 三句承诺（文案在 site.json） | `src/components/Trust.astro` |
| 这座园子 | `src/components/Story.astro` |
| 果园的一年（七道工序） | `src/components/Year.astro` |
| 果园实拍 | `src/components/Gallery.astro` |
| 为什么值得（四条理由） | `src/components/Why.astro` |
| 宽幅果园全貌 | `src/components/Feature.astro` |
| 采摘与发货 | `src/components/Harvest.astro` |
| 到园来 | `src/components/Visit.astro` |
| 联系老马 | `src/components/Contact.astro` |
| 页脚 | `src/components/Footer.astro` |

---

## 二、技术选型

| 项 | 选择 | 版本 |
| --- | --- | --- |
| 框架 | **Astro** | 7.3.8 |
| 语言 | TypeScript（strict） | 6.0.3 |
| 图片 | Astro 内置 `astro:assets` + sharp | 0.35.5 |
| 站点地图 | `@astrojs/sitemap` | 3.7.4 |
| 包管理 | pnpm | 11.7.0 |
| Node | **≥ 22.12**（本机用 24.12） | — |

**为什么是 Astro**：内容型官网的当前标准做法。默认零 JavaScript
（首屏传输约 0.5 MB，整页滚完约 1.5 MB），内置图片响应式与格式转换，
SEO 与 Lighthouse 表现最好；比 Next.js 承担更少的运行时负担，
又比手写 HTML 好维护、好升级。

**样式**：全局设计令牌（`src/styles/global.css`）+ 组件内 scoped `<style>`。
没有引入 Tailwind —— 这个站点视觉高度定制，原子类反而更难读。
如果以后要加页面且需要统一工具类，可以再引入。

**动效**：只用 CSS + IntersectionObserver，没有动效库。

---

## 三、本地运行

```bash
nvm use 24         # 或任意 ≥22.12 的版本；仓库不再带 .nvmrc（原因见下）
pnpm install
pnpm dev           # 开发服务器（热更新）
pnpm build         # 类型检查 + 构建到 dist/
pnpm preview       # 预览构建产物
pnpm verify        # 无头浏览器实测：截图 + 破图/报错/横向溢出/动效可见性
pnpm a11y          # 无障碍审计：对比度/触控目标/标题层级/键盘操作
pnpm labels        # 导航标签与区块 kicker 的一致性
pnpm mobile        # 移动端审计：5 种手机尺寸 × 溢出/触控/字号/锚点/抽屉
pnpm lh            # Lighthouse 性能/可访问性/最佳实践/SEO 四项评分
```

`pnpm verify`、`pnpm a11y`、`pnpm lh` 都需要先起 `pnpm preview`。产物输出在 `.verify/`。

`pnpm lh` 刻意保留 Lighthouse 的**模拟限速**：不限速时入场动效早已跑完，
会漏掉「文字在动效期间不可见」这类只在慢设备上暴露的问题 —— 本项目确实踩到过。

`pnpm a11y` 的对比度检测按**真实渲染像素**判断，能覆盖「白字压在照片上」这类
无法从 CSS 推算的情况；元素自身背景不透明时则直接用计算色，保证结论确定。

### ⚠️ Node 版本很关键（仅限本机）

本机有两个 Node，**只有 nvm 的那个能构建**：

- nvm 的 Node 带 `com.apple.security.cs.disable-library-validation` 权限，能加载
  rolldown（Vite 8 的打包器）的原生模块；
- 某些运行时自带的 Node 带 hardened runtime 但缺这项权限，
  加载时会报 `ERR_DLOPEN_FAILED` / `different Team IDs`。

`pnpm build` 已内置前置检查（`tools/preflight.mjs`），会直接告诉你该用哪个 Node。
这项检查只在 macOS 上有意义，云构建环境会直接通过。

> **仓库里刻意不放 `.nvmrc`。** 它会让云构建平台去下载指定版本，
> 而平台预装的版本是固定几个（EdgeOne 为 14.21.3 / 16.20.2 / 18.20.4 /
> 20.18.0 / 22.11.0 / 22.17.1 / 24.5.0）。写了 `.nvmrc` 反而会去下载
> 一个平台没有的版本并因此失败。项目 `engines` 只要求 `>=22.12.0`，
> 平台的 22.17.1 或 24.5.0 都满足。

---

## 四、部署上线

**线上地址：<https://laoma-apples.site/>**（2026-10-09 上线，阿里云香港节点，免备案）


产物是纯静态文件（`dist/`），任何静态托管都能放。

```bash
nvm use && pnpm build
```

代码仓库：<https://github.com/OuterCloud/laoma-orchard>

### 站点域名

**已经配好了**，指向正式域名 `https://laoma-apples.site`。

canonical、og:url、JSON-LD、sitemap、robots.txt 全部从 `astro.config.mjs`
的 `site` 一处派生，不存在改了一处忘另一处的问题。

以后换域名，**只改 `astro.config.mjs` 里的 `site` 这一行**，重新构建即可。
也支持用环境变量 `PUBLIC_SITE_URL` 覆盖，但默认值已可直接用于生产，不配也行。

> 注意：`site` 若停留在占位域名，canonical 会指向别处，
> 等于告诉搜索引擎「这个页面在别处」，比不写 canonical 更糟。

### 关于「免费 + 国内可访问 + 不买域名」

先说结论：**免费子域名 + 不备案可以做到国内能访问，但拿不到大陆节点速度。**

原因是政策性的，不是技术问题：任何指向中国大陆服务器的域名都必须 ICP 备案，
而备案要求你拥有一个可备案的域名（免费子域名无法备案）。
所以「大陆节点 + 免费域名 + 不备案」这三件事无法同时成立。

**推荐做法：腾讯云 EdgeOne Pages（免费版永久提供）**

- 官方支持 Astro，直接连 GitHub 仓库，推代码自动构建部署
- 免费版自带全球 CDN 与默认子域名（形如 `xxx.edgeone.app`），不需要自己买域名
- 免备案；免费版走海外节点，实测国内延迟约 200ms 上下，
  比 Cloudflare 免费版（晚高峰常见 800ms+ 或丢包）明显好
- 中文控制台，国内可用

构建配置：

| 项 | 值 |
| --- | --- |
| 构建命令 | `pnpm build` |
| 输出目录 | `dist` |
| Node 版本 | `22.12` 或更高（项目 `engines` 要求） |

**已实测的构建兼容性**（模拟平台环境，干净检出后执行）：

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile`（pnpm 9.15.9） | exit 0 |
| `pnpm build`（pnpm 9） | exit 0，产出 dist/ |
| 仓库内本机路径 / `.npmrc` | 无 |
| `.nvmrc` | **已移除**，改用平台预装 Node |

两点容易踩的坑，都已处理：

1. **不要放 `.nvmrc`。** 平台会尝试下载它指定的版本；若该版本不在平台预装列表里，
   构建会在「安装依赖」阶段直接失败（`Switching error: Failed to switch to Node.js …`）。
   本项目用平台预装的 22.17.1 或 24.5.0 都满足 `engines`。
2. **不要保留空的 `pnpm-workspace.yaml`。** 有些 pnpm 版本会因缺少 `packages`
   字段而报 `packages field missing or empty`。本项目是单包，已删除该文件。

**如果以后想要真正的大陆速度**，只有一条路：买一个域名（`.cn` 或 `.com` 都行，
首年通常几十元）并完成 ICP 备案，再上国内节点或国内 CDN。
到那时把上面三处域名改掉重新构建即可，代码不需要动。

### 部署到自己的服务器（当前方案）

站点部署在阿里云香港服务器上，与服务器上已有的 Docker 项目共存，**免备案**。

```bash
# 服务器上（一次性）
git clone git@github.com:OuterCloud/laoma-orchard.git
cd laoma-orchard
sudo ACME_EMAIL=你的邮箱 ./deploy/server-setup.sh

# 日常更新
git pull && ./deploy/publish.sh
```

完整说明（含「如何保证不影响现有项目」的七条措施、排障、自动续期）见
[`deploy/README.md`](deploy/README.md)。

### 其他托管选项

| 方案 | 国内访问 | 说明 |
| --- | --- | --- |
| EdgeOne Pages 免费版 | 约 200ms，免备案 | 推荐，见上 |
| GitHub Pages | 不稳定，时常打不开 | 国内访问 GitHub 本身就不稳 |
| Cloudflare Pages | 联通线路晚高峰差 | 免费，但体验波动大 |
| Vercel / Netlify | 不稳定 | 默认域名常被干扰 |
| 国内云主机 / 对象存储 + CDN | 最快 | **必须备案**，需要域名 |

## 五、目录说明

```
src/
  assets/
    photos/        16 张调色后的实拍原图（画廊用；Astro 从这里生成所有尺寸）
    crops/         首屏与宽幅用的预裁图（竖幅原图无法靠组件裁出想要的横构图）
    wechat-qr.png  微信二维码（由 tools/make_qr.py 生成，不做有损压缩）
  components/      各区块组件（每个自带 scoped 样式）
  data/
    site.json      ★ 全站内容单一数据源（联系方式、承诺、事实清单）
    photos.json    画廊照片顺序与文案
    hero.json      首屏选片
  layouts/
    BaseLayout.astro   <head>、SEO、结构化数据
  lib/
    photos.ts      照片静态导入表（图片改名会在构建期报错，不会上线才发现裂图）
    site.ts        读取站点信息
    wechat-qr.ts   二维码解析（联系区与悬浮浮窗共用）
  pages/
    index.astro    首页，组装各区块
  scripts/         客户端交互（入场动效、导航、灯箱、一键复制）
  styles/
    global.css     设计令牌与基础排版
  content.config.ts  内容集合定义（Astro 6+ 必须是这个文件名）

tools/
  process_images.py  照片管线：调色 + 多尺寸输出（首次整批处理用）
  make_hero.py       只重做首屏裁切
  make_qr.py         微信二维码：定位、裁切、补静区、自检
  photos.json        照片元数据（slug、说明、取景）
  preflight.mjs      构建前置检查（Node 兼容性）
  verify.ts          无头浏览器实测脚本（功能/性能）
  a11y.ts            无障碍审计脚本（对比度/触控/键盘）
  mobile.ts          移动端专项审计（5 种手机尺寸）
  lighthouse.mjs     Lighthouse 评分脚本（性能/无障碍/最佳实践/SEO）

public/            不做处理的静态文件：favicon、robots.txt、og 封面
dist/              构建产物（可直接部署）
```

---

## 六、质量实测结果

以下都是本机可复现的数字，不是估计值。

### Lighthouse 13.5.0（含模拟限速）

| 分类 | 桌面 | 手机（4G + CPU 降速） |
| --- | --- | --- |
| 性能 Performance | **100** | **96** |
| 无障碍 Accessibility | **100** | **100** |
| 最佳实践 Best Practices | **100** | **100** |
| SEO | **100** | **100** |

| 指标 | 桌面 | 手机 |
| --- | --- | --- |
| 首屏内容绘制 FCP | 0.3 s | 1.1 s |
| 最大内容绘制 LCP | 0.6 s | 2.7 s |
| 总阻塞时间 TBT | 0 ms | 0 ms |
| 累积布局偏移 CLS | 0 | 0 |
| 总传输 | **298 KiB** | **342 KiB** |

> 桌面预设不含网络限速，只看桌面会严重低估问题：
> 手机端最初是 **83 分 / LCP 4.7 s**，修完后才到 96 分 / 2.7 s。
> 所以 `pnpm lh` 保留模拟限速，移动端另有 `pnpm mobile` 专项审计。

### 自查脚本

`pnpm verify` 覆盖功能与响应式，`pnpm a11y` 覆盖无障碍，`pnpm lh` 覆盖性能与规范。
三者都通过时输出如下（节选）：

```
✓ 入场动效后内容全部可见（68 个动效元素，不可见 0 个）
✓ 图片全部加载成功（共 20 张）    ✓ 无失败请求    ✓ 无控制台报错
✓ 页面不可横向滚动                ✓ 恰好一个 h1  ✓ 所有 img 都有 alt
✓ 文字对比度全部达标（桌面 136 处、移动 141 处）
✓ 所有可点元素 ≥ 44×44            ✓ 灯箱键盘可操作、焦点锁在对话框内
```

### 两个值得记住的坑

**1. 不要用透明度做入场动效。**
最初 `reveal` 用 `opacity: 0 → 1`。不限速跑 Lighthouse 时无障碍 100 分，
一旦加上模拟限速就冒出来 **27 处对比度不合格** —— 因为观察器触发前，
整段正文的 `opacity` 还是 0，等于完全看不见，实测对比度自然是 0。
慢设备、后台标签页、CPU 繁忙时都会出现同样的窗口期。
现在动效只做位移（`translateY`），文字从一开始就是完全不透明的。

**2. 自动化审计要在「不利条件」下跑。**
上面这个问题只在限速下暴露。如果只在不限速下跑一次就宣布达标，会漏掉它。

**3. 手机端不要用「两张图 + CSS 显隐」做艺术方向。**
首屏桌面用横构图、手机用竖构图，最初写成两个 `<img>` 互相 `display: none` ——
浏览器**两张都会下载**，手机端白白多下 210KB 的横版。
改用原生 `<picture><source media>` 后浏览器只下命中的那一版。
另外首屏图是 LCP 元素，quality 从 68 降到 52（目视无差别、体积少约 40%），
手机端 LCP 从 4.7s 降到 2.7s。

## 七、无障碍与质量（实现说明）

已做的处理：

- 语义化标签、`h1` 唯一、所有图片有 `alt`、`html lang="zh-CN"`
- 键盘可达：导航、画廊、灯箱（`←` `→` 翻页、`Esc` 关闭、焦点锁在灯箱内）
- 尊重 `prefers-reduced-motion`：关闭全部动效
- 入场动效有兜底：任何情况下内容都不会长期不可见（禁用 JS 也能看）
- 禁用 JS 时页面内容完整可读

`pnpm verify` 每次会实测这些：JS 异常、控制台报错、破图、失败请求、
横向溢出、动效可见性、`h1` 数量、`alt` 完整性、灯箱交互。

`pnpm a11y` 会实测这些，并给出可复现的数字：

| 项目 | 当前结果 |
| --- | --- |
| 文字对比度 | 桌面 133 处、移动 138 处，全部达到 WCAG AA |
| 触控目标 | 移动端可点元素全部 ≥ 44×44 |
| 标题层级 | 连续，无跳级 |
| 图片 alt | 20 张，无缺失、无无意义文本 |
| 键盘 | Tab 顺序可达全部交互；焦点环可见；灯箱焦点锁在对话框内并有还原 |
| 跳转链接 | 首个 Tab 命中「跳到主要内容」 |

调色板里的次级文字色就是按这个审计反推的：
`--ink-3` 在纸色底上 7.5:1，`--ink-4` 4.9:1（AA 下限 4.5:1）。
深色区块上的文字不透明度也都提到 0.8 以上。
**改动配色后请重新跑一次 `pnpm a11y`。**
