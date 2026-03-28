/**
 * engine.js — 浏览器引擎
 *
 * 职责：
 *   维护 _browser 单例，封装 launch / connect / terminate。
 *   复用 stealth 插件、反检测参数、路径检测逻辑。
 */
import puppeteerCore from 'puppeteer-core';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createConnection } from 'node:net';
import { existsSync, mkdirSync, cpSync } from 'node:fs';
import { platform, homedir } from 'node:os';
import { join, basename } from 'node:path';
import config from '../config.js';

// ── Stealth 包装 ──
const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

// ── 单例 ──
let _browser = null;
let _shuttingDown = false;
let _shutdownCallback = null;

export function onBrowserExit(cb) {
  _shutdownCallback = cb;
}

function registerDisconnectHandler(browser) {
  browser.on('disconnected', () => {
    if (_shuttingDown) return;

    console.log('[engine] 🔌 浏览器连接断开（用户关闭了浏览器窗口？）');
    _browser = null;

    if (_shutdownCallback) {
      _shutdownCallback();
    }
  });
}

// ── 浏览器候选路径 ──
const BROWSER_CANDIDATES = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
};

function detectBrowser() {
  const envPaths = [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    process.env.LOCALAPPDATA,
  ];

  const os = platform();
  const candidates = [...(BROWSER_CANDIDATES[os] || [])];

  if (os === 'win32') {
    for (const base of envPaths) {
      if (!base) continue;
      candidates.push(
        `${base}\\Google\\Chrome\\Application\\chrome.exe`,
        `${base}\\Microsoft\\Edge\\Application\\msedge.exe`,
      );
    }
  }

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

// ── userDataDir 相关 ──
const GLOBAL_WJZ_DATA_DIR = join(homedir(), '.wjz_browser_data');

function getDefaultBrowserDataDir() {
  const os = platform();
  const home = homedir();
  const candidates = [];

  if (os === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    candidates.push(
      join(localAppData, 'Google', 'Chrome', 'User Data'),
      join(localAppData, 'Microsoft', 'Edge', 'User Data'),
      join(localAppData, 'Chromium', 'User Data'),
    );
  } else if (os === 'darwin') {
    const lib = join(home, 'Library', 'Application Support');
    candidates.push(
      join(lib, 'Google', 'Chrome'),
      join(lib, 'Microsoft Edge'),
      join(lib, 'Chromium'),
    );
  } else {
    candidates.push(
      join(home, '.config', 'google-chrome'),
      join(home, '.config', 'microsoft-edge'),
      join(home, '.config', 'chromium'),
    );
  }

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return undefined;
}

function cloneProfileFromDefault(sourceDir, targetDir) {
  console.log(`[engine] 首次运行，从浏览器默认数据克隆资产: ${sourceDir} → ${targetDir}`);

  const SKIP_NAMES = new Set([
    'singletonlock', 'singletonsocket', 'singletoncookie', 'lockfile',
    'cache', 'code cache', 'gpucache', 'dawncache', 'grshadercache',
    'crashpadmetrics-active.pma', 'browsermetrics', 'browsermetrics-spare.pma',
  ]);

  const filterFunc = (src) => !SKIP_NAMES.has(basename(src).toLowerCase());

  try {
    cpSync(sourceDir, targetDir, { recursive: true, filter: filterFunc });
    console.log('[engine] 克隆完成');
  } catch (err) {
    console.warn(`[engine] ⚠ 克隆出错（浏览器仍可启动，但需重新登录）: ${err.message}`);
  }
}

function resolveUserDataDir() {
  if (config.browserUserDataDir) return config.browserUserDataDir;

  if (existsSync(GLOBAL_WJZ_DATA_DIR)) return GLOBAL_WJZ_DATA_DIR;

  mkdirSync(GLOBAL_WJZ_DATA_DIR, { recursive: true });
  const defaultDir = getDefaultBrowserDataDir();
  if (defaultDir) {
    cloneProfileFromDefault(defaultDir, GLOBAL_WJZ_DATA_DIR);
  }
  return GLOBAL_WJZ_DATA_DIR;
}

// ── 启动参数 ──
const BROWSER_ARGS = [
  '--no-first-run',
  '--disable-default-apps',
  '--disable-popup-blocking',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-dev-shm-usage',
  ...(platform() === 'linux'
    ? ['--no-sandbox', '--disable-setuid-sandbox']
    : []),
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=Translate',
  '--no-default-browser-check',
  '--disable-crash-reporter',
  '--hide-crash-restore-bubble',
  '--test-type',
  '--safebrowsing-disable-download-protection',
  '--safebrowsing-disable-extension-blacklist',
];

function isPortAlive(port, host = '127.0.0.1', timeout = 1500) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeout);
    socket.on('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

// ── 公开 API ──

export function getBrowser() {
  return _browser;
}

export async function ensureBrowserForDaemon() {
  const port = config.browserDebugPort;

  if (_browser && _browser.isConnected()) {
    return _browser;
  }

  const alive = await isPortAlive(port);
  if (alive) {
    try {
      _browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${port}`,
        defaultViewport: null,
        protocolTimeout: config.browserProtocolTimeout,
      });
      registerDisconnectHandler(_browser);
      console.log(`[engine] 已连接到端口 ${port} 的浏览器`);
      return _browser;
    } catch (err) {
      console.warn(`[engine] 连接失败: ${err.message}，将尝试启动`);
    }
  }

  const executablePath = config.browserPath || detectBrowser();
  if (!executablePath) {
    throw new Error(
      `[engine] 未找到可用浏览器。请设置 BROWSER_PATH 或安装 Chrome/Edge。`
    );
  }

  const userDataDir = resolveUserDataDir();

  _browser = await puppeteer.launch({
    executablePath,
    headless: config.browserHeadless,
    userDataDir,
    defaultViewport: null,
    args: [...BROWSER_ARGS, `--remote-debugging-port=${port}`],
    ignoreDefaultArgs: ['--enable-automation'],
    protocolTimeout: config.browserProtocolTimeout,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });

  const pid = _browser.process()?.pid;
  registerDisconnectHandler(_browser);
  console.log(`[engine] 浏览器已启动 pid=${pid} port=${port} path=${executablePath}`);

  return _browser;
}

export async function terminateBrowser() {
  if (!_browser) return;

  _shuttingDown = true;

  try {
    const pid = _browser.process()?.pid;
    await _browser.close();
    console.log(`[engine] 浏览器已终止 pid=${pid || 'N/A'}`);
  } catch (err) {
    console.warn(`[engine] 终止浏览器时出错: ${err.message}`);
    try {
      _browser.process()?.kill('SIGKILL');
    } catch { /* ignore */ }
  } finally {
    _browser = null;
    _shuttingDown = false;
  }
}
