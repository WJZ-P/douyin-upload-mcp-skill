/**
 * config.js — 统一配置中心
 *
 * 所有可配置项集中在这里，从环境变量读取，提供合理默认值。
 * 其他模块一律从 config 取值，不自己硬编码。
 *
 * 环境变量来源（优先级从高到低）：
 *   1. 进程环境变量（process.env）
 *   2. .env.development（开发环境，git-ignored）
 *   3. .env（基础配置，可提交到 git）
 *   4. 代码默认值
 */
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── 手动加载 .env 文件（不依赖 dotenv） ──

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

/**
 * 解析 .env 文件内容为 key-value 对象
 * @param {string} filePath
 * @returns {Record<string, string>}
 */
function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, 'utf-8');
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && value) {
      result[key] = value;
    }
  }
  return result;
}

const devEnv = parseEnvFile(join(projectRoot, '.env.development'));
const baseEnv = parseEnvFile(join(projectRoot, '.env'));

for (const [key, value] of Object.entries(devEnv)) {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}
for (const [key, value] of Object.entries(baseEnv)) {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}

const env = process.env;

function envBool(key, fallback) {
  const val = env[key];
  if (val === undefined || val === '') return fallback;
  return val === 'true' || val === '1';
}

function envInt(key, fallback) {
  const val = env[key];
  if (val === undefined || val === '') return fallback;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? fallback : n;
}

function envStr(key, fallback) {
  const val = env[key];
  return (val !== undefined && val !== '') ? val : fallback;
}

// ── 导出配置 ──

const config = {
  /** 浏览器可执行文件路径（不设则自动检测） */
  browserPath: envStr('BROWSER_PATH', undefined),

  /** CDP 远程调试端口（与 Gemini skill 共享同一浏览器实例） */
  browserDebugPort: envInt('BROWSER_DEBUG_PORT', 40821),

  /** 浏览器用户数据目录 */
  browserUserDataDir: envStr('BROWSER_USER_DATA_DIR', undefined),

  /** 是否无头模式 */
  browserHeadless: envBool('BROWSER_HEADLESS', false),

  /** CDP 协议超时时间（ms） */
  browserProtocolTimeout: envInt('BROWSER_PROTOCOL_TIMEOUT', 60_000),

  /** 截图 / 输出目录 */
  outputDir: envStr('OUTPUT_DIR', join(projectRoot, 'douyin-output')),

  // ── Daemon 配置 ──

  /** Daemon HTTP 服务端口（与 Gemini skill 共享同一 Daemon） */
  daemonPort: envInt('DAEMON_PORT', 40225),

  /** Daemon 闲置超时时间（ms） */
  daemonTTL: envInt('DAEMON_TTL_MS', 30 * 60 * 1000),

  /** 抖音创作者平台上传页 URL */
  douyinUrl: envStr('DOUYIN_URL', 'https://creator.douyin.com/'),
};

export default config;
