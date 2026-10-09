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
