# Agent 协作手册

本文档定义 ACG Pulse 的 Agent 协作方式。根目录 `CLAUDE.md`、`AGENTS.md` 和 `.claude/` 可保留为个人或工具本地配置；项目级规则应沉淀在 `docs/` 中并进入 Git。

## 协作资产分工

- 现行事实来源：`README.md`（使用入口）、`docs/deployment-guide.md`（部署与排障）、`docs/API_CONTRACTS.md`（接口契约）、`docs/ROADMAP.md`（阶段目标）、`docs/NEXT_WINDOW_PROMPTS.md`（跨窗口交接）、`docs/DECISIONS.md`（长期决策）、`docs/LESSONS.md`（已验证经验）、`docs/AGENT_WORKFLOW.md`（协作规则）。
- 历史记录：`docs/collection-optimization-2026-10-19.md`（按日期追加的采集验收）、`docs/deployment-retrospective-2026-08-17.md`（生产事故归档）、`docs/resume-project-case-study.md`（项目案例）。这些文档不作为现行操作依据。
- 个人材料：`docs/interview-notes.md` 是个人面试准备，不是项目事实来源。
- 文档生命周期：独立指南被新流程取代时，先把仍有效的内容并入现行文档，再删除旧文件；历史复盘保留明确的历史标记和归档链接，不再维护旧命令。2026-10-20 已将 `deployment-troubleshooting.md` 中仍适用的内容并入 `deployment-guide.md` 并删除该文件。

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
9. 涉及 API 字段、query 参数或响应结构时，同步检查 `shared/`、`docs/API_CONTRACTS.md`、前端调用和后端校验。
10. B站采集以自建 RSSHub 为主路径：Cookie 只提供给 RSSHub，直连 API 仅在显式开启时备用；不以 Cookie 存在作为路径开关，新增监控 UID 时同步补 `BILIBILI_COOKIE_<uid>` 映射。

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

## 当前项目优先级（2026-10-21）

admin preview 的 30s 可配置超时（`SOURCE_PREVIEW_TIMEOUT_MS`）与空 `game` 预览已在 2026-10-21 完成，不再是当前优先级。

1. P1 上游稳定性观察：在隔离环境定期记录 B站路由 503、API 空 JSON 和浏览器回退频率；不启用直连 fallback，不把单窗口成功写成永久恢复。
2. P1 社区来源契约：分别确认 B站 `code=-400`、NGA `invalid post`、小黑盒 `invalid item` 的响应语义，避免把失败当成合法空列表。
3. P2 数据库与付费源评估：SQLite → PostgreSQL 仅在写入/访问量有明显压力时评估；付费采集源必须先有自建 RSSHub 成功率、失败类型和 Cookie 寿命数据，且不得默认启用。
4. 部署：未获单独授权不恢复公开部署；只维护部署文档和可复现的本地/新服务器流程。
