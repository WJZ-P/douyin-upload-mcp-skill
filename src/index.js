/**
 * douyin-mcp-skill — 统一入口
 *
 * 对外只暴露高层 API，浏览器连接由 Daemon 托管。
 * Daemon 未运行时会自动后台拉起，无需手动启动。
 *
 * 用法：
 *   import { createDouyinSession, disconnect } from './index.js';
 *
 *   const { ops } = await createDouyinSession();
 *   const probe = await ops.probe();
 *   disconnect();
 */
import { ensureBrowser, disconnect } from './browser.js';
import { createOps } from './douyin-ops.js';

export { disconnect };

/**
 * 创建抖音操控会话
 *
 * @returns {Promise<{ops: ReturnType<typeof createOps>, page: import('puppeteer-core').Page, browser: import('puppeteer-core').Browser}>}
 */
export async function createDouyinSession() {
  const { browser, page } = await ensureBrowser();
  const ops = createOps(page);
  return { ops, page, browser };
}
