# SillyTavern MCP Client

在 SillyTavern 中接入 **Model Context Protocol (MCP)**：连接外部 MCP Server，为模型提供 Tools / Resources / Prompts。

本分支（dev）引入 **无碎片 Tool Use** 架构：

- 通过 **st-api-wrapper** 接管发送/再生入口（不走 ST 原生 Generate 工具循环）
- 使用模型的 **原生 tool_calls / function calling**（OpenAI `tools[]` 格式）
- MCP 工具在后端 server-plugin 执行，但 **聊天只落一条最终 assistant 消息**
- 工具调用过程以 `extra.mcp_tool_trace` 形式保存，并在 UI 中渲染为可折叠 Trace

> 设计目标（重要）：**默认不把图片内容发送给模型**。
> - UI：Trace 中展示图片链接（自动上传到 ST）
> - 模型：默认只看到占位提示：`[Image: image/png, delivered to user]`

---

## 兼容性 / 前置条件

- 需要较新的 SillyTavern 版本（具备 Server Plugins + Third-party Extensions + Tool Calling 功能）。
- **必须安装并启用**第三方扩展 [st-api-wrapper](https://github.com/Lianues/st-api-wrapper)（本项目 dev 架构依赖它来拦截入口与构造请求）。
- 当前 dev 架构**只支持 `mainApi=openai` 的 chat-completions 体系**（包括 OpenAI / OpenRouter / Claude / Gemini 等 *chat_completion_source*）。
- 你的模型/后端需要支持 Tool Calling（function calling）；否则不会触发工具。

---

## 安装（SillyTavern）

本项目由两部分组成：

1) **Server Plugin（后端）**：提供 `/api/plugins/mcp-client/**` 路由、管理 MCP server 连接
2) **Third-party Extension（前端）**：在 UI 中提供面板、同步 tools、处理多模态策略

### 方式 A：从 URL 安装（推荐）

> 仓库中已包含预构建产物，可直接安装，无需本地构建。

**Step 0 — 安装 st-api-wrapper（必须）**

在酒馆 UI 中：**Extensions → Install Extension** → 输入 Git URL：

```
https://github.com/Lianues/st-api-wrapper
```

启用后刷新一次页面，确保 `window.ST_API` 可用。

**Step 1 — 安装前端扩展（本项目）**

在酒馆 UI 中：**Extensions → Install Extension** → 输入 Git URL：

```
https://github.com/Moeblack/sillytavern-mcp-client
```

酒馆会将本仓库 clone 到 `public/scripts/extensions/third-party/sillytavern-mcp-client/`，前端扩展立即可用。

**Step 2 — 安装后端插件**

后端 Server Plugin 需要在 SillyTavern 的 `plugins/` 目录中注册。在酒馆根目录执行一行命令即可：

Linux / Mac：
```bash
# 软链接（推荐，后续 git pull 自动更新）
ln -s ../public/scripts/extensions/third-party/sillytavern-mcp-client/plugin plugins/mcp-client
```

Windows (管理员 CMD)：
```cmd
mklink /D plugins\mcp-client public\scripts\extensions\third-party\sillytavern-mcp-client\plugin
```

或者任意平台直接复制：
```bash
cp -r public/scripts/extensions/third-party/sillytavern-mcp-client/plugin plugins/mcp-client
```

**Step 3 — 重启 SillyTavern**

确保 `config.yaml` 中 `enableServerPlugins: true`，然后重启酒馆即可。

### 方式 B：从源码构建

```bash
git clone https://github.com/Moeblack/sillytavern-mcp-client.git
cd sillytavern-mcp-client
npm install
npm run build
```

构建产物位置：

- 前端扩展：`dist/index.iife.js`、`dist/index.iife.js.map`
- 后端插件：`plugin/index.js`、`plugin/index.js.map`（`plugin/package.json` 已预置）

然后按方式 A 的 Step 1-3 安装（或手动复制文件到对应目录）。

---

## 使用方法

1. 打开 SillyTavern → **Extensions** 设置页
2. 找到 **MCP Client** 面板
3. 点击 **Manage Servers** 添加/管理 MCP servers
4. 点击 **Sync Tools** 同步工具列表

当满足以下条件后：
- `mainApi=openai`
- 你使用的是 chat-completions 类模型/渠道（OpenAI / OpenRouter / Claude / Gemini 等 source）
- 工具已 Sync

你在聊天界面点击 **发送 / 再生** 时，扩展会：
1) 拦截酒馆原生生成入口
2) 以 OpenAI `tools[]` 发起请求
3) 在扩展内部执行 tool loop（MCP 工具由后端插件执行）
4) 最终只写入 **一条 assistant** 回复

工具调用过程会显示在回复下方的可折叠 **MCP Tools Trace** 中（同时持久化在 `extra.mcp_tool_trace`）。

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
  - UI：会自动上传到 SillyTavern，并在 **MCP Tools Trace** 中显示链接
  - 模型：默认不发送图片数据，只保留占位符文本

> Phase 2 计划：可选把图片以 provider 兼容的方式注入到下一轮 prompt（当前 dev 实现默认关闭）。

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
npm run build          # 构建前端 → dist/  +  后端 → plugin/
```

### 仓库结构

```
sillytavern-mcp-client/
├── manifest.json            # 前端扩展 manifest（酒馆 URL 安装必须在根目录）
├── style.css                # 前端样式
├── dist/                    # 前端构建产物（已提交到仓库）
│   ├── index.iife.js
│   └── index.iife.js.map
├── plugin/                  # 后端构建产物（已提交到仓库）
│   ├── package.json         # Server Plugin 运行时 package.json
│   ├── index.js
│   └── index.js.map
├── extension/               # 前端源码
│   ├── src/
│   └── vite.config.ts
├── server-plugin/           # 后端源码
│   ├── src/
│   └── __tests__/
├── shared/                  # 共享类型
├── package.json             # 开发用 package.json
└── tsup.config.ts           # 后端构建配置
```

---

## 已知问题 (Known Issues) ⚠️

目前项目处于开发/测试阶段，已知存在以下问题：

1. 当前 dev 架构只实现了 **send / regenerate** 拦截；`continue / stop / impersonate` 等入口尚未完整接管。
2. 当前 dev 架构以 `mainApi=openai` 为前提；其它主 API（如 novel/textgen）暂不支持原生 tool_calls。
3. 流式 tool loop 仍在规划中（Phase 1 默认非流式）。

---

## 相关项目

| 项目 | 说明 |
|------|------|
| [ComfyUI-AnimaTool](https://github.com/Moeblack/ComfyUI-AnimaTool) | Anima 二次元图片生成 MCP Server + HTTP API，可通过本客户端连接到酒馆 |
| [st-api-wrapper](https://github.com/Lianues/st-api-wrapper) | 本项目 dev 架构的基础设施依赖：hooks 拦截 + prompt 构造 + UI API |
| [SillyTavern Tool Use Fix](https://github.com/Moeblack/sillytavern-tooluse-fix) | **已不再需要**（旧方案为修复碎片消息的视觉合并 hack）。建议关闭/卸载，避免与新架构概念混淆 |

### 推荐搭配

```
ComfyUI-AnimaTool (MCP Server)
        ↕ MCP 协议 (stdio / streamable-http)
SillyTavern MCP Client (本项目：连接 + tool loop + trace)
        ↕
st-api-wrapper (hooks / prompt utilities)
```

---

## License

AGPL-3.0
