/**
 * 全站导航项（唯一来源）。
 *
 * 导航栏、移动端抽屉、页脚共用这一份，避免各写一遍导致标签不一致。
 * 用完整名称而非缩写 —— 「果园」「一年」这类简写在页脚里看不懂，
 * 相当于一份准确的目录。
 *
 * 注意：首页以外的页面（如 404）链接需要带 `/` 前缀，
 * 否则 `#contact` 会被解析成当前路径下的锚点。
 */
export interface NavLink {
  href: string;
  label: string;
}

const anchors: NavLink[] = [
  { href: '#story', label: '这座园子' },
  { href: '#year', label: '果园的一年' },
  { href: '#gallery', label: '果园实拍' },
  { href: '#why', label: '为什么套袋' },
  { href: '#visit', label: '到园来' },
];

/** 首页用：纯锚点，点击平滑滚动 */
export const homeLinks: NavLink[] = anchors;

/**
 * 子页面用：指向首页对应的区块。
 * 子页面本身没有这些锚点，直接写 `#story` 会停在原地不动。
 */
export const linkedLinks: NavLink[] = anchors.map((l) => ({
  href: `/${l.href}`,
  label: l.label,
}));
