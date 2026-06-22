# Agent 协作手册

本文档定义 ACG Pulse 的 Agent 协作方式。根目录 `CLAUDE.md`、`AGENTS.md` 和 `.claude/` 可保留为个人或工具本地配置；项目级规则应沉淀在 `docs/` 中并进入 Git。

## 协作资产分工

- `docs/ROADMAP.md`：阶段目标和待办，不记录临时过程。
- `docs/LESSONS.md`：踩坑、根因、可复用规则。
- `docs/DECISIONS.md`：影响架构或长期维护的决策。
- `README.md`：面向使用者的入口，只放必要链接和快速说明。
- `.claude/`：本地工具配置，不作为项目事实来源。

## 标准任务输入

发起任务时尽量包含四项：

```text
目标：要完成什么。
约束：哪些文件/行为不要动，是否允许重构。
验收：需要跑哪些命令、页面表现或数据结果。
交付：是否需要 commit / PR / 部署说明。
```

示例：

```text
目标：优化 /api/public/stories 查询性能。
约束：不改前端 UI，不改变响应结构。
验收：server test/build 通过，并说明查询策略变化。
交付：完成后按现有规范 commit。
```

## Agent 工作流

1. 先读代码和现有文档，确认边界和历史决策。
2. 涉及 3 个以上文件时维护任务清单。
3. 先做最小可验证改动，避免顺手重构无关模块。
4. 修改后运行对应验证命令。
5. 输出结果时说明改了什么、验证了什么、剩余风险。
6. 如果形成新经验，更新 `docs/LESSONS.md`。
7. 如果改变架构方向，更新 `docs/DECISIONS.md`。
8. 涉及外部 AI Provider 时，先验证官方模型列表、弃用时间和容器环境变量传递，再修改默认值。

## 验证命令

后端改动：

```bash
cd server
npm.cmd test
npm.cmd run build
```

前端改动：

```bash
cd client
npm.cmd run build
```

部署改动：

```bash
docker compose config
```

全栈或共享契约改动至少运行后端测试、后端构建和前端构建。

## 提交规范

沿用当前仓库风格：Conventional Commit + 中文说明。

常用类型：

- `feat:` 新功能
- `fix:` 修复用户可见问题
- `refactor:` 内部结构调整
- `docs:` 文档更新
- `test:` 测试补充
- `chore:` 工程治理、配置、流程改进

提交前要求：

- 工作区只包含本轮相关改动。
- 已运行与改动范围匹配的验证命令。
- 不提交 `.env`、数据库、日志、截图、构建产物、依赖目录。

## 当前项目优先级

第二阶段（稳定性/性能/可观测性）已完成。

第三阶段可推进方向：

- 自定义数据源管理（RSS/RSSHub/官网源）。
- 数据库升级预案评估（SQLite → PostgreSQL）。
- AI Provider 成本、失败率与模型弃用监控；当前生产基线为 DeepSeek V4 Flash。
