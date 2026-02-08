# MCP Client（dev tool-use mode）手工联调清单

> 目标：验证“无碎片 tool use”链路是否正常：拦截入口 → 原生 tool_calls → MCP 调用 → 仅写入最终 assistant + trace。

## 0. 环境准备

- [ ] SillyTavern 已开启 Server Plugins：`config.yaml` → `enableServerPlugins: true`
- [ ] 已安装并启用 `st-api-wrapper`
- [ ] 已安装并启用 `sillytavern-mcp-client`
- [ ] 已将 `sillytavern-mcp-client/plugin` 放入 `SillyTavern/plugins/mcp-client/`（或软链接）并重启

## 1. MCP Server 连接

在 **Extensions → MCP Client → Manage Servers**：

- [ ] Add 一个可用的 MCP server（stdio 或 streamable-http）
- [ ] Connect 成功（状态变成 connected）
- [ ] Sync Tools 后工具列表非空

## 2. Tool loop 基本流程（send）

前置：主 API 选择 `openai`（可以是 OpenRouter/Claude/Gemini 的 chat_completion_source，只要走 chat-completions）。

- [ ] 发送一句会触发工具的提示词（例如“请调用 mcp__xxx__yyy 获取信息后回答”）
- [ ] 观察聊天：
  - [ ] 用户消息写入 1 条
  - [ ] 助手最终消息写入 1 条（无额外系统碎片消息）
  - [ ] 助手消息下方出现 **MCP Tools Trace**
- [ ] 展开 Trace：
  - [ ] 能看到 tool 名、arguments、result
  - [ ] 如果工具返回 image，Trace 中能看到图片 URL 链接

## 3. Regenerate

- [ ] 点击再生
- [ ] 观察聊天：
  - [ ] 旧的最后一条 assistant 被删除
  - [ ] 新的最后一条 assistant 写入
  - [ ] Trace 更新

## 4. 错误处理

- [ ] 断开 MCP server（Disconnect）
- [ ] 再次发送会触发工具的提示词
- [ ] 预期：
  - [ ] 生成失败时有 toast / 控制台报错
  - [ ] 不会产生碎片消息/半截工具消息

## 5. 回归检查

- [ ] MCP Client 面板依旧能正常管理 servers
- [ ] `npm run test` / `npm run build` 通过
