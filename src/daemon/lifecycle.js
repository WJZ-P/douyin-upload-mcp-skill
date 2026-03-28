/**
 * lifecycle.js — 生命周期控制器
 *
 * 管理"惰性销毁"定时器。每次收到请求就 resetHeartbeat()（续命）；
 * 超时未活动则终止浏览器并退出 Daemon 进程。
 */
import { terminateBrowser } from './engine.js';

const DEFAULT_TTL_MS = 30 * 60 * 1000;

let _idleTimer = null;
let _ttlMs = DEFAULT_TTL_MS;
let _lastHeartbeat = 0;
let _httpServer = null;

export function setTTL(ms) {
  _ttlMs = ms > 0 ? ms : DEFAULT_TTL_MS;
}

export function setServer(server) {
  _httpServer = server;
}

export function resetHeartbeat() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _lastHeartbeat = Date.now();

  _idleTimer = setTimeout(async () => {
    console.log(`[lifecycle] 💤 ${(_ttlMs / 60000).toFixed(0)} 分钟未活动，终止浏览器并退出 Daemon`);
    await terminateBrowser();

    if (_httpServer) {
      _httpServer.close();
      _httpServer = null;
    }

    _idleTimer = null;
    console.log('[lifecycle] ✅ Daemon 进程退出（下次 Skill 调用时会自动重新拉起）');
    process.exit(0);
  }, _ttlMs);
}

export function cancelHeartbeat() {
  if (_idleTimer) {
    clearTimeout(_idleTimer);
    _idleTimer = null;
  }
}

export function getLifecycleInfo() {
  const now = Date.now();
  const idleSec = _lastHeartbeat > 0 ? Math.round((now - _lastHeartbeat) / 1000) : -1;
  const remainingSec = _lastHeartbeat > 0
    ? Math.max(0, Math.round((_lastHeartbeat + _ttlMs - now) / 1000))
    : -1;

  return {
    ttlMs: _ttlMs,
    lastHeartbeat: _lastHeartbeat > 0 ? new Date(_lastHeartbeat).toISOString() : null,
    idleSeconds: idleSec,
    remainingSeconds: remainingSec,
  };
}
