import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * 内容集合（Content Layer）
 *
 * 注意（Astro 6+ 的现行约定，区别于旧教程）：
 *   - 配置文件必须是 src/content.config.ts，src/content/config.ts 已在 v6 移除
 *   - 每个集合必须声明 loader；`type: 'content' | 'data'` 写法已不存在
 *   - zod 统一从 astro/zod 导入（astro:schema 已废弃），底层是 Zod 4
 *   - 用 file() loader 时每条数据必须自带 id
 */

/** 画廊照片：只存路径与文案，图片由页面按 slug 显式 import（类型更可靠） */
const photos = defineCollection({
  loader: file('src/data/photos.json'),
  schema: z.object({
    id: z.string(),
    order: z.number().int().nonnegative(),
    file: z.string(),
    caption: z.string(),
    alt: z.string(),
  }),
});

const pendingField = z.object({
  label: z.string(),
  value: z.string().default(''),
  src: z.string().default(''),
  _pending: z.string().optional(),
});

/** 站点信息：全站唯一内容源 */
const site = defineCollection({
  loader: file('src/data/site.json'),
  schema: z.object({
    id: z.string(),
    name: z.string(),
    shortName: z.string(),
    tagline: z.string(),
    url: z.string(),
    place: z.object({
      province: z.string(),
      city: z.string(),
      county: z.string(),
      // 门牌级地址；空字符串说明还没填，页面上会显式提示而不是显示成假信息
      village: z.string().default(''),
      // 完整地址，直接用于正文、页脚与结构化数据
      full: z.string(),
      geo: z.object({ lat: z.number(), lng: z.number() }),
    }),
    contact: z.object({
      wechat: pendingField,
      wechatQr: pendingField,
      visitNote: pendingField,
      hours: pendingField,
    }),
    claims: z.array(
      z.object({ num: z.string(), title: z.string(), body: z.string() })
    ),
    facts: z.array(z.object({ label: z.string(), value: z.string() })),
    heroFacts: z.array(z.object({ label: z.string(), value: z.string() })),
  }),
});

export const collections = { photos, site };
