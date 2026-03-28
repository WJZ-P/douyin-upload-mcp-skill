---
name: douyin-upload-mcp-skill
description: 通过抖音创作者平台（creator.douyin.com）执行内容发布、数据查看等操作。操作方式分三级优先级：首选 MCP 工具 → 次选 Skill 脚本 → 最次连接 Skill 浏览器手动操作（需用户授权）。禁止自行启动外部浏览器访问抖音。
---

# 抖音 MCP Skill

## ⚠️ 操作优先级（必须遵守）

1. **🥇 首选：调用 MCP 工具** — 直接调用本 Skill 暴露的 MCP 工具完成操作
2. **🥈 次选：运行 Skill 脚本** — 当 MCP 工具无法满足需求时，运行本 Skill 项目中的脚本
3. **🥉 最次：连接 Skill 管理的浏览器** — 仅前两种方式都无法解决时，通过 `douyin_browser_info` 获取 CDP 连接信息接管浏览器。**需先征得用户同意**

**绝对禁止**：自行启动新的浏览器实例访问抖音页面。

## 可用工具

| 工具名 | 说明 | 入参 |
|--------|------|------|
| `douyin_probe` | 探测页面各元素状态 | 无 |
| `douyin_check_login` | 检查是否已登录 | 无 |
| `douyin_navigate_to` | 打开指定抖音页面 URL（仅 douyin.com 域名） | `url`，`timeout` |
| `douyin_reload_page` | 刷新页面 | `timeout` |
| `douyin_screenshot` | 对当前页面截图保存 | 无 |
| `douyin_browser_info` | 获取浏览器连接信息 | 无 |

## MCP 客户端配置

```json
{
  "mcpServers": {
    "douyin": {
      "command": "node",
      "args": ["<项目绝对路径>/src/mcp-server.js"]
    }
  }
}
```

也可通过 `npm run mcp` 手动启动。

## 架构

与 gemini-skill 完全一致的分层架构：

```
MCP Client → mcp-server.js → index.js → browser.js → Daemon
                                ↓
                          douyin-ops.js → operator.js → CDP → Chrome → douyin.com
```

- **Daemon**（独立进程）：管理浏览器生命周期，闲置 30 分钟自动销毁
- **browser.js**：Skill 侧连接器，按需自启 Daemon
- **operator.js**：纯 CDP 底层原子操作
- **douyin-ops.js**：抖音业务编排层
- **mcp-server.js**：MCP 工具协议层

### 端口配置（与 gemini-skill 共享同一浏览器实例）

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| CDP 端口 | 40821 | 与 gemini-skill 共享 |
| Daemon 端口 | 40225 | 与 gemini-skill 共享 |

多个 skill 共用同一个浏览器实例 + 同一个 Daemon，各 skill 各用各的 tab。
