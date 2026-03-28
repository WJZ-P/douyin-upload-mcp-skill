/**
 * browser.js — 浏览器客户端连接器（面向 Skill）
 *
 * 职责：
 *   1. 向 Daemon 服务请求 wsEndpoint，并通过 puppeteer.connect() 直连浏览器。
 *   2. 如果 Daemon 未启动，自动以后台进程拉起 server.js，等待就绪后再连接。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import puppeteerCore from 'puppeteer-core';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import config from './config.js';
import { sleep } from './util.js';

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DAEMON_SCRIPT = join(__dirname, 'daemon', 'server.js');

let _browser = null;

const DAEMON_URL = `http://127.0.0.1:${config.daemonPort}`;

const DAEMON_READY_TIMEOUT = 15_000;
const DAEMON_POLL_INTERVAL = 500;

async function isDaemonAlive() {
  try {
    const res = await fetch(`${DAEMON_URL}/health`, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

function spawnDaemon() {
  console.log(`[browser] 🚀 Daemon 未运行，正在自动启动: node ${DAEMON_SCRIPT}`);

  const child = spawn(process.execPath, [DAEMON_SCRIPT], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });

  child.unref();
  console.log(`[browser] Daemon 进程已分离 (pid=${child.pid})，等待就绪...`);
}

async function ensureDaemon() {
  if (await isDaemonAlive()) {
    return;
  }

  spawnDaemon();

  const deadline = Date.now() + DAEMON_READY_TIMEOUT;
  while (Date.now() < deadline) {
    await sleep(DAEMON_POLL_INTERVAL);
    if (await isDaemonAlive()) {
      console.log('[browser] ✅ Daemon 就绪');
      return;
    }
  }

  throw new Error(
    `Daemon 自动启动超时（${DAEMON_READY_TIMEOUT / 1000}s 内未响应 /health）！\n` +
    `请检查端口 ${config.daemonPort} 是否被占用，或手动运行: npm run daemon`
  );
}

/**
 * 在浏览器中找到抖音创作者平台标签页，或新开一个
 * @param {import('puppeteer-core').Browser} browser
 * @returns {Promise<import('puppeteer-core').Page>}
 */
async function findOrCreateDouyinPage(browser) {
  const pages = await browser.pages();

  // 优先复用已有的抖音创作者平台页面
  for (const page of pages) {
    const url = page.url();
    if (url.includes('creator.douyin.com')) {
      console.log('[browser] 命中已有抖音创作者平台页面');
      await page.bringToFront();
      return page;
    }
  }

  // 没找到，新开一个标签页
  const page = await browser.newPage();
  await page.goto(config.douyinUrl, {
    waitUntil: 'networkidle2',
    timeout: 30_000,
  });
  console.log('[browser] 已打开新的抖音创作者平台页面');
  return page;
}

/**
 * 确保浏览器可用 — Skill 唯一的对外入口
 */
export async function ensureBrowser() {
  if (_browser && _browser.isConnected()) {
    const page = await findOrCreateDouyinPage(_browser);
    return { browser: _browser, page };
  }

  await ensureDaemon();

  let acquireData;
  try {
    console.log(`[browser] 正在呼叫 Daemon: ${DAEMON_URL}/browser/acquire ...`);
    const res = await fetch(`${DAEMON_URL}/browser/acquire`);
    acquireData = await res.json();

    if (!acquireData.ok) {
      const detail = acquireData.detail ? ` (${acquireData.detail})` : '';
      throw new Error(`${acquireData.error || 'Daemon 返回失败'}${detail}`);
    }
  } catch (err) {
    throw new Error(
      `Daemon 已启动但获取浏览器失败！\n` +
      `底层报错: ${err.message}`
    );
  }

  console.log(`[browser] 从 Daemon 获取到 wsEndpoint，正在建立 CDP 直连...`);
  _browser = await puppeteer.connect({
    browserWSEndpoint: acquireData.wsEndpoint,
    defaultViewport: null,
    protocolTimeout: config.browserProtocolTimeout,
  });

  const page = await findOrCreateDouyinPage(_browser);
  console.log(`[browser] CDP 直连成功，pid=${acquireData.pid}`);
  return { browser: _browser, page };
}

/**
 * 断开 WebSocket 连接（不关闭浏览器）
 */
export function disconnect() {
  if (_browser) {
    _browser.disconnect();
    _browser = null;
    console.log('[browser] 已断开 CDP 连接（浏览器仍由 Daemon 守护）');
  }
}
