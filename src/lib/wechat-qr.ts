import type { ImageMetadata } from 'astro';
import type { SiteInfo } from './site';

/**
 * 微信二维码解析。
 *
 * 联系区与悬浮浮窗都要用它，所以抽到一处，避免两处逻辑不一致。
 *
 * 关键约定：二维码**不走 Astro 的图片优化**，直接用原始 PNG。
 * 它由纯色方块构成，最怕有损压缩伪影；一旦糊了就可能扫不出来。
 * 原始文件已是 880px 且带足静区（见 tools/make_qr.py）。
 */
export function resolveWechatQr(
  contact: SiteInfo['contact']
): ImageMetadata | undefined {
  const file = contact.wechatQr.src.trim();
  if (!file) return undefined;

  const modules = import.meta.glob<{ default: ImageMetadata }>(
    '/src/assets/*.{png,jpg,jpeg,webp}',
    { eager: true }
  );

  const entry =
    modules[`/src/assets/${file}`] ??
    modules[`/src/assets/${file}.png`] ??
    modules[`/src/assets/${file}.jpg`];

  if (!entry) {
    console.warn(
      `[wechat-qr] site.json 里指定的二维码图片未找到：src/assets/${file}` +
        `（已尝试 .png / .jpg 后缀）`
    );
    return undefined;
  }
  return entry.default;
}
