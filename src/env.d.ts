/**
 * 客户端事件的类型补充。
 * Astro 未内置 astro:page-load 等自定义事件的类型，这里补一个声明即可。
 */
declare global {
  interface DocumentEventMap {
    'astro:page-load': Event;
    'astro:after-swap': Event;
  }
}

export {};
