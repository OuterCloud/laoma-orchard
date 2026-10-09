import { getEntry, type CollectionEntry } from 'astro:content';

export type SiteInfo = CollectionEntry<'site'>['data'];

/**
 * 读取站点信息（单一内容源）。
 * 所有页面统一走这里，避免各处硬编码电话、地址、承诺文案。
 */
export async function getSite(): Promise<SiteInfo> {
  const entry = await getEntry('site', 'main');
  if (!entry) {
    throw new Error('缺少站点信息：请检查 src/data/site.json 是否存在 id 为 "main" 的条目');
  }
  return entry.data;
}

/**
 * 站点源地址（scheme + host，无尾斜杠）。
 *
 * **改域名只需要改 astro.config.mjs 里的 `site` 一处。**
 * canonical、og:url、JSON-LD、sitemap、robots.txt 全部从这里取，
 * 不再各自维护一份 —— 之前域名散在 astro.config、site.json、robots.txt
 * 三处，很容易改了一处忘了另一处，导致搜索引擎收到互相矛盾的地址。
 *
 * 也支持用环境变量 PUBLIC_SITE_URL 覆盖（部署平台可直接配置，无需改代码）。
 */
export function siteOrigin(fallback?: string): string {
  const fromEnv = (import.meta.env.PUBLIC_SITE_URL as string | undefined)?.trim();
  const raw = fromEnv || fallback || 'http://localhost:4321';
  return raw.replace(/\/+$/, '');
}
