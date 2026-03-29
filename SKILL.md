---
name: douyin-upload-mcp-skill
description: 通过抖音创作者平台（creator.douyin.com）发布视频和图文内容。首选调用 MCP 工具完成操作，MCP 无法满足时可运行 Skill 脚本兜底。禁止自行启动外部浏览器访问抖音。
---

# 抖音 MCP Skill

## ⚠️ 操作优先级（必须遵守）

1. **🥇 首选：调用 MCP 工具** — 直接调用本 Skill 暴露的 MCP 工具完成操作。绝大多数场景都应该走这条路径。
2. **🥈 兜底：运行 Skill 脚本** — 当 MCP 工具无法满足需求时，运行本 Skill 项目中的脚本（如 `demo.js`、`demo-imagetext.js`）
3. **🥉 最次：连接 Skill 管理的浏览器** — 仅前两种方式都无法解决时，通过 `douyin_browser_info` 获取 CDP 连接信息接管浏览器。**需先征得用户同意**

**绝对禁止**：自行启动新的浏览器实例访问抖音页面。

## 支持范围

| 类型 | 支持 | 说明 |
|------|------|------|
| 发布视频 | ✅ | 上传视频 + 选封面 + 填标题简介 + 发布 |
| 发布图文 | ✅ | 上传图片 + 填标题简介 + 选音乐 + 发布 |
| 发布全景视频 | ❌ | 不支持（场景极少） |
| 发布纯文字 | ❌ | 不支持（场景极少） |

## 可用 MCP 工具

### 核心发布工具

| 工具名 | 说明 | 入参 |
|--------|------|------|
| `douyin_publish_video` | 发布视频（全自动，内部自动检查登录） | `filePath`（必填）, `title`, `description`, `timeout` |
| `douyin_publish_imagetext` | 发布图文（全自动，内部自动检查登录） | `filePaths`（必填，字符串数组）, `title`, `description` |

### 登录与状态

| 工具名 | 说明 | 入参 |
|--------|------|------|
| `douyin_check_login` | 检查登录状态并推进登录流程 | `smsCode`（可选，短信验证码） |
| `douyin_probe` | 探测页面各元素状态 | 无 |
| `douyin_screenshot` | 对当前页面截图保存 | 无 |

### 页面操作

| 工具名 | 说明 | 入参 |
|--------|------|------|
| `douyin_navigate_to` | 打开指定抖音页面 URL（仅 douyin.com 域名） | `url`, `timeout` |
| `douyin_reload_page` | 刷新页面 | `timeout` |
| `douyin_browser_info` | 获取浏览器连接信息（兜底接管用） | 无 |

## 典型使用流程

### 1. 登录（多次调用 `douyin_check_login` 推进）

```
第1次调用 → phase: qrcode      → 用户扫码
第2次调用 → phase: sms_verification → 自动点击接收短信
第3次调用 → phase: sms_code_input   → 用户告知验证码
第4次调用(smsCode="123456") → phase: logged_in → 登录完成
```

### 2. 发布视频

```
调用 douyin_publish_video:
  filePath: "C:/videos/test.mp4"
  title: "我的视频"
  description: "视频简介 #标签"
```

### 3. 发布图文

```
调用 douyin_publish_imagetext:
  filePaths: ["C:/images/1.png", "C:/images/2.png"]
  title: "我的图文"
  description: "图文简介 #标签"
```

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
