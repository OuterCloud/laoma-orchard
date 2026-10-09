#!/usr/bin/env node
/**
 * Lighthouse 性能/可访问性审计（开发用，不参与构建）。
 *
 * 前提：先启动 `pnpm preview`（默认 http://127.0.0.1:4321/）。
 *
 * 用法：node tools/lighthouse.mjs [baseUrl]
 *   或 pnpm lh
 *
 * 关于模拟限速：这里刻意保留 Lighthouse 默认的模拟限速。
 * 不限速时入场动效早已跑完，会漏掉「文字在动效期间不可见」这类
 * 只在慢设备上暴露的问题 —— 这正是本项目实际踩到过的坑。
 *
 * Lighthouse 通过 pnpm dlx 临时拉取，不写进项目依赖（体积大且只用于核验）。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4321/';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY = join(ROOT, '.verify');
const OUT = join(VERIFY, 'lh.json');

mkdirSync(VERIFY, { recursive: true });

/*
 * 通过 npm_execpath 拿到当前 pnpm 的可执行文件；直接跑 node 脚本时回退到 `pnpm`。
 * pnpm 本身是个 .mjs，这种情况要用 node 起它。
 */
const PNPM = process.env.npm_execpath || 'pnpm';
const NEEDS_NODE = /\.m?js$/.test(PNPM);

const lhArgs = [
  'dlx',
  'lighthouse@13.5.0',
  BASE,
  '--only-categories=performance,accessibility,best-practices,seo',
  '--preset=desktop',
  '--chrome-flags=--headless=new --no-sandbox --disable-gpu',
  '--output=json',
  `--output-path=${OUT}`,
  '--quiet',
];

console.log(`正在审计 ${BASE} …（需要 pnpm preview 已在运行）\n`);

const res = NEEDS_NODE
  ? spawnSync(process.execPath, [PNPM, ...lhArgs], { stdio: ['ignore', 'inherit', 'inherit'] })
  : spawnSync(PNPM, lhArgs, { stdio: ['ignore', 'inherit', 'inherit'] });

if (res.status !== 0 || !existsSync(OUT)) {
  console.error('\n✗ Lighthouse 执行失败。请确认 pnpm preview 已启动。');
  process.exit(res.status ?? 1);
}

const report = JSON.parse(readFileSync(OUT, 'utf8'));
const pct = (s) => (s === null || s === undefined ? 'n/a' : Math.round(s * 100));
let bad = 0;

console.log('═══ Lighthouse 13.5.0（桌面预设，含模拟限速）═══\n');
for (const cat of Object.values(report.categories)) {
  const score = pct(cat.score);
  const ok = typeof score === 'number' && score >= 95;
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${cat.title.padEnd(18)} ${score}`);
}

console.log('\n关键指标：');
for (const id of [
  'first-contentful-paint',
  'largest-contentful-paint',
  'total-blocking-time',
  'cumulative-layout-shift',
  'speed-index',
  'total-byte-weight',
]) {
  const a = report.audits[id];
  if (a) console.log(`  ${a.title.slice(0, 40).padEnd(42)} ${a.displayValue ?? ''}`);
}

const nContrast = report.audits['color-contrast']?.details?.items?.length ?? 0;
console.log(`\n对比度问题：${nContrast}`);
if (nContrast > 0) bad++;

console.log('\n未满分项：');
const imperfect = Object.values(report.audits).filter(
  (a) => typeof a.score === 'number' && a.score < 1 && a.scoreDisplayMode !== 'informative'
);
if (!imperfect.length) console.log('  无');
for (const a of imperfect) console.log(`  [${a.score.toFixed(2)}] ${a.title}  ${a.displayValue ?? ''}`);

console.log(`\n═══ ${bad === 0 ? '通过' : `${bad} 个分类未达 95`} ═══`);
console.log(`完整报告：${OUT}`);
process.exit(bad === 0 ? 0 : 1);
