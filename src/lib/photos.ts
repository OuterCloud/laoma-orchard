import type { ImageMetadata } from 'astro';

/**
 * 画廊照片的静态导入表。
 *
 * 为什么不直接拼路径：Astro 必须能在构建期静态分析到每个图片资源。
 * 显式 import 换来的是「图片不存在 / 改名」会在构建时直接报错，
 * 而不是上线后才发现裂图。
 */
import appleClose from '../assets/photos/apple-close.jpg';
import appleCluster from '../assets/photos/apple-cluster.jpg';
import baggedApples from '../assets/photos/bagged-apples.jpg';
import highCrop from '../assets/photos/high-crop.jpg';
import leafdetail from '../assets/photos/leafdetail.jpg';
import longView from '../assets/photos/long-view.jpg';
import manyOnTree from '../assets/photos/many-on-tree.jpg';
import orchardCanopy from '../assets/photos/orchard-canopy.jpg';
import orchardRowsFar from '../assets/photos/orchard-rows-far.jpg';
import orchardRows from '../assets/photos/orchard-rows.jpg';
import orchardSky from '../assets/photos/orchard-sky.jpg';
import rowAndField from '../assets/photos/row-and-field.jpg';
import singleApple from '../assets/photos/single-apple.jpg';
import sunThroughLeaves from '../assets/photos/sun-through-leaves.jpg';
import tallTree from '../assets/photos/tall-tree.jpg';
import treeBush from '../assets/photos/tree-bush.jpg';

export const PHOTOS: Record<string, ImageMetadata> = {
  'apple-close': appleClose,
  'apple-cluster': appleCluster,
  'bagged-apples': baggedApples,
  'high-crop': highCrop,
  leafdetail,
  'long-view': longView,
  'many-on-tree': manyOnTree,
  'orchard-canopy': orchardCanopy,
  'orchard-rows-far': orchardRowsFar,
  'orchard-rows': orchardRows,
  'orchard-sky': orchardSky,
  'row-and-field': rowAndField,
  'single-apple': singleApple,
  'sun-through-leaves': sunThroughLeaves,
  'tall-tree': tallTree,
  'tree-bush': treeBush,
};

/** 按文件名取图，取不到直接抛错（构建期暴露问题） */
export function photo(file: string): ImageMetadata {
  const key = file.replace(/\.jpg$/, '');
  const found = PHOTOS[key];
  if (!found) throw new Error(`src/assets/photos 下找不到照片：${file}`);
  return found;
}
