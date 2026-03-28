/**
 * handlers.js — API 路由处理器
 *
 * 端点：
 *   GET  /browser/acquire  — 确保浏览器可用，返回 wsEndpoint
 *   GET  /browser/status   — 查询浏览器健康状态（不续命）
 *   POST /browser/release  — 主动销毁浏览器
 *   GET  /health           — Daemon 自身健康检查
 */
import { ensureBrowserForDaemon, getBrowser, terminateBrowser } from './engine.js';
import { resetHeartbeat, getLifecycleInfo } from './lifecycle.js';

export async function handleAcquire(_req, res) {
  try {
    const browser = await ensureBrowserForDaemon();
    resetHeartbeat();

    const wsEndpoint = browser.wsEndpoint();
    const pid = browser.process()?.pid || null;

    sendJSON(res, 200, {
      ok: true,
      wsEndpoint,
      pid,
      lifecycle: getLifecycleInfo(),
    });
  } catch (err) {
    console.error(`[handler] /browser/acquire 失败: ${err.message}`);
    sendJSON(res, 500, {
      ok: false,
      error: 'acquire_failed',
      detail: err.message,
    });
  }
}

export async function handleStatus(_req, res) {
  const browser = getBrowser();

  if (!browser || !browser.isConnected()) {
    sendJSON(res, 200, {
      status: 'offline',
      lifecycle: getLifecycleInfo(),
    });
    return;
  }

  try {
    const targets = browser.targets();
    const pages = targets
      .filter(t => t.type() === 'page')
      .map(t => ({
        targetId: t._targetId,
        url: t.url(),
      }));

    sendJSON(res, 200, {
      status: 'online',
      pid: browser.process()?.pid || null,
      wsEndpoint: browser.wsEndpoint(),
      pages,
      pageCount: pages.length,
      lifecycle: getLifecycleInfo(),
    });
  } catch (err) {
    sendJSON(res, 200, {
      status: 'error',
      error: err.message,
      lifecycle: getLifecycleInfo(),
    });
  }
}

export async function handleRelease(_req, res) {
  const browser = getBrowser();

  if (!browser) {
    sendJSON(res, 200, { ok: true, message: 'browser_already_offline' });
    return;
  }

  try {
    const pid = browser.process()?.pid || null;
    await terminateBrowser();
    sendJSON(res, 200, { ok: true, message: 'browser_terminated', pid });
  } catch (err) {
    console.error(`[handler] /browser/release 失败: ${err.message}`);
    sendJSON(res, 500, {
      ok: false,
      error: 'release_failed',
      detail: err.message,
    });
  }
}

export function handleHealth(_req, res) {
  sendJSON(res, 200, {
    ok: true,
    service: 'douyin-upload-browser-daemon',
    uptime: Math.round(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
