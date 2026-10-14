import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI教学风险监测 · 客户运营中心",
  description: "AI教学风险监测客户使用、付费转化与运营跟进看板。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head><script dangerouslySetInnerHTML={{ __html: `
(() => {
  let failed = false;
  const show = () => {
    if (document.documentElement.dataset.appReady === 'true') return;
    let notice = document.getElementById('startup-failure');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'startup-failure';
      notice.setAttribute('role', 'alert');
      notice.style.cssText = 'position:fixed;top:12px;left:12px;right:12px;z-index:9999;padding:16px;background:#fff1f2;color:#9f1239;border:1px solid #fda4af;border-radius:10px;font:14px/1.7 sans-serif';
      notice.textContent = '页面初始化失败：浏览器脚本未加载或执行失败。请检查本地服务的静态资源与电脑可用内存；不要连续刷新。服务修复后手动重新载入一次。';
      document.body.appendChild(notice);
    }
  };
  window.addEventListener('error', event => {
    const target = event.target;
    if (target && target.tagName === 'SCRIPT' && target.src) {
      failed = true;
      if (document.body) show();
    }
  }, true);
  document.addEventListener('DOMContentLoaded', () => { if (failed) show(); }, {once:true});
  setTimeout(show, 25000);
})();` }} /></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
