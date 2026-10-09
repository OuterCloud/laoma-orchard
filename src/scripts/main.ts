import { initReveal } from './reveal';
import { initNav } from './nav';
import { initLightbox } from './lightbox';
import { initCopy } from './copy';

/**
 * 全站交互入口。
 * 在这里统一初始化，页面只需 import 一次。
 *
 * 说明：Astro 会把本模块打包进页面（`<script>` 会自动处理 TS 与 import），
 * 同一页面内多次引入也只会执行一次。若将来拆分多页并启用 <ClientRouter />，
 * 需改写为监听 `astro:page-load`：模块脚本在视图过渡后不会自动重跑。
 */
export function initSite(): void {
  initReveal();
  initNav();
  initLightbox();
  initCopy();
}

initSite();
