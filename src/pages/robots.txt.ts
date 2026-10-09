import type { APIRoute } from 'astro';
import { siteOrigin } from '../lib/site';

/**
 * robots.txt 由代码生成，而不是放一个静态文件。
 *
 * 原因：静态文件里的 Sitemap 一行会写死域名，换域名时很容易漏改，
 * 结果搜索引擎拿到一个指向旧域名的 sitemap。这里直接取
 * astro.config.mjs 的 site，永远与 canonical / sitemap 保持一致。
 */
export const GET: APIRoute = ({ site }) => {
  const origin = siteOrigin(site?.origin);
  const body = `User-agent: *
Allow: /

Sitemap: ${origin}/sitemap-index.xml
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
