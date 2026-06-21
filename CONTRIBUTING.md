# 参与贡献

感谢你愿意改进 ACG Pulse。本文档用于统一问题反馈、代码修改、验证和提交方式。

## 开始之前

1. 搜索现有 Issue，确认问题尚未被记录。
2. 较大的功能或架构调整先创建 Issue 讨论范围。
3. 不要在 Issue、日志、截图或提交中包含密码、Cookie、Token 和 API Key。

## 本地开发

```bash
git clone https://github.com/yingzhu77/ACG-Pulse.git
cd ACG-Pulse

cd server && npm install
cd ../client && npm install
```

本地运行方式和环境变量参见 [README.md](README.md#快速开始)。

## 修改原则

- 保持改动聚焦，不混入无关重构和生成文件。
- 优先沿用现有组件、服务层和数据库访问模式。
- API 变化需要同步前端类型、调用方和测试。
- 数据库或部署变化需要说明迁移、回滚与兼容风险。
- UI 改动需要检查桌面端、移动端以及三种主题。

## 验证要求

服务端：

```bash
cd server
npm test
npm run build
```

客户端：

```bash
cd client
npm run lint
npm run build
```

涉及用户流程时，请同时进行本地页面验证；涉及部署时，请检查 `docker compose config --quiet`。

## 提交与 Pull Request

提交信息使用简洁的 Conventional Commits 风格：

```text
feat: 新增功能
fix: 修复问题
perf: 优化性能
docs: 更新文档
test: 补充测试
chore: 维护任务
```

Pull Request 应包含：

- 修改目的与主要实现
- 对用户或 API 的行为变化
- 验证命令与结果
- 截图或录屏（适用于 UI 改动）
- 部署、迁移或回滚说明（如适用）

## Agent 协作

使用 Codex、Claude Code 等 Agent 开发时，请同时遵循 [Agent 协作手册](docs/AGENT_WORKFLOW.md)。项目事实应沉淀到 `docs/`，不要仅保存在单个对话窗口中。

