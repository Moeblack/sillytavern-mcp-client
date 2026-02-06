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

### 方式 A：从 URL 安装（推荐）

> 仓库中已包含预构建产物，可直接安装，无需本地构建。

**Step 1 — 安装前端扩展**

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

1. ~~**多图渲染异常**~~：已通过 [Tool Use Fix](https://github.com/Moeblack/sillytavern-tooluse-fix) 解决 — 图片 URL 持久化在 `extra.mcp_images` 中，basket 重建时正确渲染。
2. ~~**图片删除联动失效**~~：已通过 Tool Use Fix 解决 — 图片由 basket 统一管理，不再依赖独立系统消息。
3. ~~**交互体验限制**~~：已通过 Tool Use Fix 解决 — 消息合并显示、编辑器可用。

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

AGPL-3.0
