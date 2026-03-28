/**
 * server.js — Browser Daemon 入口
 *
 * 一个极简的 HTTP 微服务，管理浏览器进程的生命周期。
 *
 * 启动方式：
 *   node src/daemon/server.js
 *   DAEMON_PORT=40226 node src/daemon/server.js
 *
 * API 端点：
 *   GET  /browser/acquire  — 确保浏览器可用，返回 wsEndpoint（续命）
 *   GET  /browser/status   — 查询浏览器状态（不续命）
 *   POST /browser/release  — 主动销毁浏览器
 *   GET  /health           — Daemon 健康检查
 */
import { createServer } from 'node:http';
import { handleAcquire, handleStatus, handleRelease, handleHealth } from './handlers.js';
import { setTTL, cancelHeartbeat, setServer } from './lifecycle.js';
import { terminateBrowser, onBrowserExit } from './engine.js';
import config from '../config.js';

const PORT = config.daemonPort;
const TTL_MS = config.daemonTTL;

setTTL(TTL_MS);

const routes = {
  'GET /browser/acquire': handleAcquire,
  'GET /browser/status': handleStatus,
  'POST /browser/release': handleRelease,
  'GET /health': handleHealth,
};

const server = createServer((req, res) => {
  const { method, url } = req;
  const path = (url || '/').split('?')[0];
  const routeKey = `${method} ${path}`;

  const handler = routes[routeKey];
  if (handler) {
    handler(req, res);
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not_found', path }));
  }
});

server.listen(PORT, () => {
  setServer(server);

  onBrowserExit(() => {
    console.log('[daemon] 🛑 浏览器已关闭，Daemon 跟随退出');
    cancelHeartbeat();
    server.close();
    process.exit(0);
  });

  console.log(`[daemon] 🚀 Douyin Browser Daemon 已启动 — http://127.0.0.1:${PORT}`);
  console.log(`[daemon] ⏱  闲置 TTL: ${(TTL_MS / 60000).toFixed(0)} 分钟`);
  console.log(`[daemon] 🖥  无头模式: ${config.browserHeadless ? '是' : '否'}`);
  console.log(`[daemon] 🔌 CDP 端口: ${config.browserDebugPort}`);
});

// ── 优雅退出 ──
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

SIGNALS.forEach(sig => {
  process.on(sig, async () => {
    console.log(`\n[daemon] 🛑 收到 ${sig}，开始优雅退出...`);
    server.close();
    cancelHeartbeat();
    await terminateBrowser();
    console.log('[daemon] ✅ 清理完毕，进程退出');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  console.error('[daemon] ❌ 未捕获异常:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[daemon] ❌ 未处理的 Promise 拒绝:', reason);
});
