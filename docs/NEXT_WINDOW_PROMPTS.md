# 小窗口任务队列与复盘

> 状态：上一轮风险优化任务已全部完成。本文从“待执行提示词”调整为“完成复盘 + 后续新窗口规则”。后续每次新增小窗口任务时，只追加到“新任务队列”；完成后移动到“完成复盘”。

## 完成复盘

| 优先级 | 任务 | 结果 | 复盘要点 |
|--------|------|------|----------|
| P0-1 | 社区风向冷启动加载速度 | 已完成 | `/api/community/topics` 改为 stale-first，不再用首屏等待完整刷新；后台刷新需继续观察失败率和刷新互斥。 |
| P1-1 | FTS5 生命周期与触发器自愈 | 已完成 | FTS 表和 trigger 分开检查，缺失时自动补齐；SQLite 构建差异已记录到踩坑文档。 |
| P1-2 | AI 分析队列一致性 | 已完成 | 单条/批量重分析统一入持久化队列；claim 改为条件更新；复盘修正了“入队但未 force 重分析”的回归风险。 |
| P1-3 | 管理后台运维与密码重置体验 | 已完成 | API 客户端统一 401 处理；补充配置预检和密码重置脚本；复盘修正 `check-config.sh` 避免 `source .env`。 |
| P2-1 | 源健康历史保留策略 | 已完成 | 采集后自动清理过期 `SourceHealthLog`，默认保留 30 天，可通过 `HEALTH_LOG_RETENTION_DAYS` 配置。 |
| P2-2 | 报告日期时区正确性 | 已完成 | 后端按 `REPORT_TIMEZONE` 计算日报/周报边界；前端默认导出不再强传本地日期，让后端时区规则兜底。 |
| P2-3 | FTS 搜索深分页与召回 | 已完成 | 召回上限从 1000 提到 10000，并补测试；如果数据规模继续增长，应升级为 SQL join 或专用搜索服务。 |

## 剩余观察项

- **社区风向刷新**：stale-first 已解决冷启动阻塞，但后台刷新失败时需要在页面上继续保持“旧数据可读 + 明确更新时间”。
- **FTS 召回上限**：10000 是阶段性方案，不是无限召回；当公开数据量明显超过该规模时，优先改成 FTS raw query join 或外部搜索。
- **分析任务历史**：成功任务默认保留 14 天，已耗尽重试机会的失败任务默认保留 30 天；后续观察清理数量、失败任务排障窗口和保留期是否需要按生产规模调整。
- **报告时区**：默认推荐继续使用 `Asia/Shanghai`。如果未来要允许用户级时区，需要新增公开配置接口，不要只在前端硬编码。
- **运维脚本**：`reset-admin-password.sh` 依赖 `openssl`，目标服务器是 Ubuntu 24.04 时可用；若迁移到极简镜像，需要补 fallback。
- **情报身份规则**：新增平台适配器时必须同步扩展 `itemIdentity.ts` 和回归测试；AI 分类不能参与 FeedItem 身份判定。
- **AI Provider 生命周期**：生产当前使用 `deepseek-v4-flash`；新窗口修改模型名前必须核对官方文档与 `/models`，并保留 `DEEPSEEK_MODEL` 可配置覆盖。
- **社区情感评测集**：人工标注评测集本轮明确后延。未来调整关键词、Prompt、置信度阈值或模型前，先按 B站/NGA/小黑盒分层抽样，建立准确率、Macro-F1 和混淆矩阵基线。
- **队列状态语义**：失败分析对应的 FeedItem 通常已经进入公开流；重试负责补齐或修正 Analysis，不得通过重复采集补偿失败任务。

## 新任务队列

### P1-1：社区热度拆分为展示排名与趋势判断

```text
你在 D:\111222333\personal-hot-monitor 项目中工作。目标：把社区热度拆成“展示排名”和“趋势判断”两套语义。

请先阅读：
- README.md
- docs/AGENT_WORKFLOW.md
- docs/ROADMAP.md
- docs/LESSONS.md
- docs/DECISIONS.md
- docs/API_CONTRACTS.md

重点查看：
- server/prisma/schema.prisma
- server/src/gamepulse/community/heat.ts
- server/src/gamepulse/adapters/community.ts
- server/src/gamepulse/db/communityDb.ts
- server/src/gamepulse/routes/community.ts
- server/src/gamepulse/community/types.ts
- shared/community.ts
- shared/api.ts
- client/src/components/CommunityTopicCard.tsx
- client/src/components/InsightsPage.tsx
- server/src/gamepulse/__tests__/communityHeat.test.ts
- server/src/gamepulse/__tests__/communityPagination.test.ts
- server/src/gamepulse/__tests__/communityStaleFirst.test.ts

任务要求：
1. 保留现有 `heatScore` 作为展示排名字段，语义不变：同来源、本轮候选集合内百分位 0-100。
2. 新增 `rawHeatScore` 和 `rawHeatTrend`，用于趋势判断；不要直接把 raw 分数展示给用户。
3. 来源适配器先计算 raw heat，归一化阶段只写 `heatScore`，不得覆盖 raw heat。
4. DB upsert 时同时维护展示趋势和 raw 趋势；已有旧数据要有默认值/兼容路径。
5. 更新 shared DTO、API 契约文档和决策/踩坑文档。
6. 保持当前 UI 行为兼容，热度环和列表排序继续使用 `heatScore`。
7. 增加或更新测试，覆盖 raw 分数保留、百分位排名、已有 topic 趋势合并和单样本来源。

验收：
- npm.cmd --prefix server test
- npm.cmd --prefix server run build
- npm.cmd --prefix client run lint
- npm.cmd --prefix client run build
- npx.cmd prisma validate（在 server 目录或传入临时 DATABASE_URL）
- git diff --check
```

新增任务时使用这个格式：

```text
你在 D:\111222333\personal-hot-monitor 项目中工作。目标：<一句话目标>。

请先阅读 README.md、docs/AGENT_WORKFLOW.md、docs/ROADMAP.md、docs/LESSONS.md、docs/DECISIONS.md，然后重点查看：
- docs/API_CONTRACTS.md（涉及接口、query 或 DTO 时必读）
- <相关文件 1>
- <相关文件 2>

任务要求：
1. <可验收要求>
2. <边界/兼容性约束>
3. 更新相关文档；如发现新坑，更新 docs/LESSONS.md。

验收：
- npm --prefix server test
- npm --prefix server run build
- npm --prefix client run build
- 涉及 UI 时用桌面和移动端截图验证。
```
