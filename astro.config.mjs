// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * 站点配置
 * 改站点域名只需改这一处（与 src/data/site.json 的 url 保持一致）。
 */
export default defineConfig({
  site: 'https://laoma-orchard.example.com',

  // v7 默认 compressHTML:'jsx' 会移除行内元素之间的空白，中文排版会出现文字粘连，
  // 因此显式设回 true（保留空白）。
  compressHTML: true,

  trailingSlash: 'ignore',
  build: { inlineStylesheets: 'auto' },

  image: {
    // 响应式默认布局：不指定时按容器宽度缩放
    layout: 'constrained',
    // 关键：Astro 默认为 false，不开则图片不会响应式
    responsiveStyles: true,
    // 细化断点：原来档位太稀，1350 宽的展示位会被迫取 1600 的图。
    // 超过源尺寸的档位 Astro 会自动忽略（绝不上采样），所以可以放心列长一点。
    breakpoints: [360, 420, 500, 560, 640, 720, 828, 960, 1080, 1200, 1280, 1366, 1440, 1600, 1920],
    service: {
      entrypoint: 'astro/assets/services/sharp',
      config: {
        limitInputPixels: false,
        webp: { effort: 6, quality: 72 },
        // AVIF 质量是按实测定的：这批照片在 65 与 80 之间视觉上无法分辨
        // （平均像素差 2/255），但体积少约三分之一。
        avif: { effort: 6, quality: 65 },
        jpeg: { mozjpeg: true, quality: 80 },
      },
    },
  },

  prefetch: { defaultStrategy: 'viewport', prefetchAll: false },

  integrations: [
    sitemap({
      changefreq: 'monthly',
      priority: 1,
      lastmod: new Date(),
    }),
  ],
});
