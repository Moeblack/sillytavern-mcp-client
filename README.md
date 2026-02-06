# SillyTavern MCP Client

在 SillyTavern 中接入 **Model Context Protocol (MCP)**：连接外部 MCP Server，向模型提供 Tools / Resources / Prompts，并支持（可选）多模态图片注入。

> 设计目标（重要）：**默认不把图片内容发送给模型**。
> - UI 会把工具返回的图片**自动渲染为一条系统消息**（每张图一条）。
> - 发送给模型的只有占位提示：`[Image: image/png, delivered to user]`。
> - 如需让支持多模态的模型“看图”，可以在面板里勾选 `Send images to model`。

---

## 兼容性 / 前置条件

- 需要较新的 SillyTavern 版本（具备 Server Plugins + Third-party Extensions + Tool Calling 功能）。
- 你的模型/后端需要支持 Tool Calling（OpenAI/Claude/OpenRouter 等）；否则只能手动调用或不会触发工具。

---

## 安装（SillyTavern）

本项目由两部分组成：

1) **Server Plugin（后端）**：提供 `/api/plugins/mcp-client/**` 路由、管理 MCP server 连接
2) **Third-party Extension（前端）**：在 UI 中提供面板、同步 tools、处理多模态策略

### 方式 A：使用预构建包（推荐）

将发布包内的文件复制到 SillyTavern 对应目录（保持目录结构）：

- `SillyTavern/plugins/mcp-client/`（后端插件）
- `SillyTavern/public/scripts/extensions/third-party/mcp-client/`（前端扩展）

复制完成后 **重启 SillyTavern**。

### 方式 B：从源码构建

在本仓库根目录执行：

```bash
npm install
npm run build
```

构建产物位置：

- 后端插件：`server-plugin/dist/index.js`、`server-plugin/dist/index.js.map`
- 前端扩展：`extension/dist/index.iife.js`、`extension/dist/index.iife.js.map`

然后复制到 SillyTavern：

#### 1) 安装后端插件

目标目录：`SillyTavern/plugins/mcp-client/`

需要包含（至少）：

- `package.json`（`main` 指向 `index.mjs`）
- `index.mjs`（ESM wrapper，用于加载 `index.js`）
- `index.js`、`index.js.map`（后端插件打包产物）

> 说明：`index.mjs` 是一个 wrapper，用来兼容 bundler 产物对 `require` 的检查。

#### 2) 安装前端扩展

目标目录：`SillyTavern/public/scripts/extensions/third-party/mcp-client/`

需要包含（至少）：

- `manifest.json`
- `dist/index.iife.js`
- `dist/index.iife.js.map`
- `dist/style.css`

> 注意：`manifest.json` 中默认引用 `dist/style.css`，请确保 CSS 文件路径匹配。

复制完成后 **重启 SillyTavern**。

---

## 使用方法

1. 打开 SillyTavern → **Extensions** 设置页
2. 找到 **MCP Client** 面板
3. 点击 **Manage Servers** 添加/管理 MCP servers
4. 点击 **Sync Tools** 同步工具列表

当模型支持 Tool Calling 且工具已注册后：
- 模型会按需自动调用 MCP tools
- 你也可以提示模型显式调用：
  - “先调用 `list_xxx`，再调用 `generate_xxx` ……”

---

## MCP Server 配置格式（非常重要）

在面板里点击 **Add Server (JSON)** 时，需要粘贴 **单个 server 对象**（不是数组）。

### 顶层字段

```jsonc
{
  "id": "anima-tool",              // 必填：唯一 ID（建议只用小写字母/数字/短横线）
  "name": "Anima Tool",           // 必填：显示名称
  "transport": { /* 见下文 */ },   // 必填：传输配置
  "enabled": true,                 // 可选：是否启用（默认 true）
  "autoConnect": true              // 可选：启动后是否自动连接
}
```

### transport: stdio（本地命令启动）

```jsonc
{
  "id": "my-stdio-server",
  "name": "My Stdio Server",
  "transport": {
    "type": "stdio",
    "command": "node",
    "args": ["E:/path/to/server.js"],
    "cwd": "E:/path/to",
    "env": {
      "API_KEY": "xxxx"
    }
  },
  "enabled": true,
  "autoConnect": true
}
```

字段说明：
- `command`：必填，可执行文件（如 `node` / `python` / `uv` / `deno` / 你的 exe）
- `args`：可选，启动参数数组
- `cwd`：可选，工作目录
- `env`：可选，环境变量键值对

### transport: streamable-http（远程 HTTP MCP Server）

```jsonc
{
  "id": "my-http-server",
  "name": "My HTTP MCP",
  "transport": {
    "type": "streamable-http",
    "url": "http://127.0.0.1:5100",
    "headers": {
      "Authorization": "Bearer <token>"
    }
  },
  "enabled": true,
  "autoConnect": false
}
```

字段说明：
- `url`：必填，MCP Streamable HTTP endpoint
- `headers`：可选，自定义请求头

---

## 图片渲染与“不给模型看图”的策略

- 工具返回 `type: "image"` 时：
  - UI：自动发一条 **系统消息**并渲染图片（每张图一条）
  - 模型：默认不发送图片数据，只保留占位符文本
- 如需把图片发给模型（仅对支持多模态的 provider 有效）：
  - 在 MCP Client 面板勾选 `Send images to model (provider-aware)`

---

## 常见问题

### 1) 面板显示 0/1 servers connected
- 确认后端插件已安装到 `SillyTavern/plugins/mcp-client/` 并已重启
- 点击 **Manage Servers → Refresh**

### 2) 工具列表为空
- 确认 server 已连接（connected）
- 点击 **Sync Tools**

### 3) 模型不调用工具
- 确认当前使用的 provider/model 支持 Tool Calling
- 确认 `Sync Tools` 后工具已注册

---

## 开发

```bash
npm install
npm test
npm run typecheck
npm run build
```

---

## 已知问题 (Known Issues) ⚠️

目前项目处于开发/测试阶段，已知存在以下问题：

1. **多图渲染异常**：由于图片是通过系统工具调用插入的，在当前聊天会话渲染完成后，若退出并重新进入该聊天，所有图片可能会显示为同一张图。
2. **图片删除联动失效**：删除聊天中的任意一张图片后，重新进入聊天会导致该会话内的所有图片消失。
3. ~~**交互体验限制**~~：已通过 [Tool Use Fix](https://github.com/Moeblack/sillytavern-tooluse-fix) 扩展解决 — 支持 Swipe 代理、消息合并显示、编辑器可用。

---

## 相关项目

| 项目 | 说明 |
|------|------|
| [ComfyUI-AnimaTool](https://github.com/Moeblack/ComfyUI-AnimaTool) | Anima 二次元图片生成 MCP Server + HTTP API，可通过本客户端连接到酒馆 |
| [SillyTavern Tool Use Fix](https://github.com/Moeblack/sillytavern-tooluse-fix) | 酒馆工具调用体验修复扩展，将碎片化的工具调用消息合并为一条视觉消息 |

### 推荐搭配

```
ComfyUI-AnimaTool (MCP Server)
        ↕ MCP 协议 (stdio / streamable-http)
SillyTavern MCP Client (本项目，连接 + 工具注册)
        ↕ SillyTavern Tool Calling
Tool Use Fix (合并显示 + 体验优化)
```

---

## License

TBD
