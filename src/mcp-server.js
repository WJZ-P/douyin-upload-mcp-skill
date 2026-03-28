import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── stdio 保护：拦截所有 stdout 写入，强制走 stderr ───
const _origStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function (chunk, encoding, callback) {
  const str = typeof chunk === 'string' ? chunk : chunk.toString();
  if (str.trimStart().startsWith('{')) {
    return _origStdoutWrite(chunk, encoding, callback);
  }
  return process.stderr.write(chunk, encoding, callback);
};
console.log = console.error;
console.warn = console.error;
console.info = console.error;
console.debug = console.error;

import { createDouyinSession, disconnect } from './index.js';
import config from './config.js';
import { sleep } from './util.js';

const server = new McpServer({
  name: "douyin-upload-mcp-server",
  version: "0.1.0",
});

// ─── 页面探测 ───

server.registerTool(
  "douyin_probe",
  {
    description: "探测抖音创作者平台页面各元素状态，用于调试和排查问题",
    inputSchema: {},
  },
  async () => {
    try {
      const { ops } = await createDouyinSession();
      const result = await ops.probe();
      disconnect();

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

// ─── 登录检查 ───

server.registerTool(
  "douyin_check_login",
  {
    description: "检查当前抖音创作者平台是否已登录，并推进登录流程。支持多次调用：qrcode（需扫码）→ sms_verification（自动点击接收短信）→ sms_code_input（需传入验证码）→ 带 smsCode 调用完成验证 → logged_in。",
    inputSchema: {
      smsCode: z.string().optional().describe("短信验证码（6位数字）。在 phase 为 sms_code_input 时传入"),
    },
  },
  async ({ smsCode }) => {
    try {
      const { ops } = await createDouyinSession();
      const result = await ops.checkLogin({ smsCode });
      disconnect();

      if (!result.ok) {
        const msg = result.message || result.error || '未知错误';
        return { content: [{ type: "text", text: `检测失败: ${msg}` }], isError: true };
      }

      const lines = [];

      switch (result.phase) {
        case 'logged_in':
          lines.push('✅ 已登录');
          break;
        case 'qrcode':
          lines.push('❌ 未登录 — 需要扫码');
          if (result.qrcodePath) lines.push(`二维码已保存至: ${result.qrcodePath}`);
          lines.push('请扫码后再次调用本接口');
          break;
        case 'sms_verification':
          lines.push('⏳ 身份验证中 — 已点击接收短信验证码');
          lines.push(result.message);
          break;
        case 'sms_code_input':
          lines.push('📱 等待输入验证码');
          lines.push(result.message);
          break;
        case 'sms_code_submitted':
          lines.push('⏳ 验证码已提交，等待验证结果');
          lines.push(result.message);
          break;
        default:
          lines.push(result.message || JSON.stringify(result));
      }

      return {
        content: [{ type: "text", text: lines.join('\n') }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

// ─── 页面导航 ───

server.registerTool(
  "douyin_navigate_to",
  {
    description: "打开指定的抖音页面 URL。仅允许 douyin.com 域名",
    inputSchema: {
      url: z.string().url().describe("目标抖音 URL"),
      timeout: z.number().default(30000).describe("等待页面加载完成的超时（毫秒），默认 30000"),
    },
  },
  async ({ url, timeout }) => {
    try {
      const { ops } = await createDouyinSession();
      const result = await ops.navigateTo(url, { timeout });
      disconnect();

      if (!result.ok) {
        let msg = `页面导航失败: ${result.error}`;
        if (result.detail) msg += `\n${result.detail}`;
        return { content: [{ type: "text", text: msg }], isError: true };
      }
      return {
        content: [{ type: "text", text: `已导航至: ${result.url}（耗时 ${result.elapsed}ms）` }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

// ─── 页面刷新 ───

server.registerTool(
  "douyin_reload_page",
  {
    description: "刷新抖音页面（页面卡住或状态异常时使用）",
    inputSchema: {
      timeout: z.number().default(30000).describe("等待页面重新加载完成的超时（毫秒），默认 30000"),
    },
  },
  async ({ timeout }) => {
    try {
      const { ops } = await createDouyinSession();
      const result = await ops.reloadPage({ timeout });
      disconnect();

      if (!result.ok) {
        return { content: [{ type: "text", text: `页面刷新失败: ${result.error}` }], isError: true };
      }
      return { content: [{ type: "text", text: `页面刷新完成，耗时 ${result.elapsed}ms` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

// ─── 截图 ───

server.registerTool(
  "douyin_screenshot",
  {
    description: "对当前抖音页面进行截图，保存到本地文件。用于调试或查看页面当前状态",
    inputSchema: {},
  },
  async () => {
    try {
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');

      const { ops } = await createDouyinSession();

      mkdirSync(config.outputDir, { recursive: true });
      const filename = `douyin_screenshot_${Date.now()}.png`;
      const filePath = join(config.outputDir, filename);

      const buffer = await ops.screenshot({ fullPage: true });
      writeFileSync(filePath, buffer);

      disconnect();

      return {
        content: [{ type: "text", text: `截图已保存至: ${filePath}` }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

// ─── 浏览器信息 ───

server.registerTool(
  "douyin_browser_info",
  {
    description: "获取抖音浏览器会话的连接信息（CDP 端口、WebSocket 地址、Daemon 状态等）",
    inputSchema: {},
  },
  async () => {
    const daemonUrl = `http://127.0.0.1:${config.daemonPort}`;

    try {
      const healthRes = await fetch(`${daemonUrl}/health`, { signal: AbortSignal.timeout(3000) });
      const health = await healthRes.json();

      if (!health.ok) {
        return {
          content: [{ type: "text", text: "Daemon 未就绪，浏览器可能未启动。请先调用其他工具触发自动启动。" }],
          isError: true,
        };
      }

      const acquireRes = await fetch(`${daemonUrl}/browser/acquire`, { signal: AbortSignal.timeout(5000) });
      const acquire = await acquireRes.json();

      const info = {
        daemon: {
          url: daemonUrl,
          port: config.daemonPort,
          status: "running",
        },
        browser: {
          cdpPort: config.browserDebugPort,
          wsEndpoint: acquire.wsEndpoint || null,
          pid: acquire.pid || null,
          headless: config.browserHeadless,
        },
        config: {
          protocolTimeout: config.browserProtocolTimeout,
          outputDir: config.outputDir,
          daemonTTL: config.daemonTTL,
          douyinUrl: config.douyinUrl,
        },
      };

      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `无法连接 Daemon (${daemonUrl})，浏览器可能未启动。\n错误: ${err.message}\n\n提示: 请先调用其他工具触发自动启动，或手动运行 npm run daemon`,
        }],
        isError: true,
      };
    }
  }
);

// 启动
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Douyin MCP Server running on stdio");
}

run().catch(console.error);
