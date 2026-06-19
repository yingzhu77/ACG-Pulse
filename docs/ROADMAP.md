# ACG Pulse 优化路线图

> 多窗口协作时，优先使用 [后续小窗口任务提示词](NEXT_WINDOW_PROMPTS.md) 分派工作；每个窗口完成后同步更新这里的状态。

## 第一阶段：基础稳固（已完成）

- 明确项目使用 UTF-8 编码，并添加 `.editorconfig` 固化编辑器约定。
- 将管理端关键写接口接入 Zod 校验，避免手写解析导致的边界行为不一致。
- 将公开 stories/items 查询参数接入 Zod 校验，统一非法输入的 400 响应。
- 配置 Vitest 只运行 `src/**/*.test.ts`，避免 `dist` 构建产物里的测试被重复执行。

## 第二阶段：稳定性、性能与可观测性（待办）

- 优化 `/api/public/stories` 查询：
  - ✅ 已将 facet 统计改为数据库聚合，避免每次全量拉取 feedItem 到内存统计。
  - 降低内存聚合的候选数据规模，必要时为故事聚合结果增加缓存层。
  - 对搜索参数 `q` 评估 SQLite FTS 或迁移到更合适的全文搜索方案。
- 将 AI 分析队列持久化：
  - ✅ 增加任务状态：`pending / running / completed / failed`。
  - ✅ 记录 `retryCount`、最近错误、耗时和 provider/model。
  - ✅ 管理后台展示队列长度、失败任务和手动重试入口。
- 增强运维能力：
  - ✅ 增加 SQLite 自动备份与恢复文档。
  - ✅ 增加源健康历史、失败率和最近错误统计。
  - ✅ 为定时任务增加互斥锁，避免重叠执行。
  - ✅ 源健康日志保留策略（默认 30 天，可配置 HEALTH_LOG_RETENTION_DAYS）。
- 补齐测试：
  - AI JSON 解析与 fallback 测试（未实现）。
  - ✅ source 创建/更新/布尔值解析测试（`validation.test.ts`）。
  - ✅ stories filter/facet 组合测试。
  - checker 去重测试（未实现；清理和失败源状态已在 `checkerMutex.test.ts` 覆盖）。
  - ✅ FTS5 触发器生命周期测试（mock + 真实 SQLite 集成）。

## 第三阶段：产品能力扩展（待办）

- 全文搜索与高级筛选：
  - ✅ 已实现 SQLite FTS5 全文搜索，支持标题、正文、作者、来源组合搜索。
  - ✅ FTS 召回上限提升至 10000，修复深分页筛选漏召回。
  - 增加保存筛选视图或常用订阅。
- 导出与日报：
  - ✅ 已实现 Markdown 导出接口（日报/周报），支持按游戏、分类、重要性筛选。
  - ✅ 前端已添加导出入口（SummaryColumn 顶部按钮）。
  - 后续：PDF 导出方案评估（详见 DECISIONS.md）。
- 自定义数据源：
  - 管理后台支持自定义 RSS/RSSHub/官网源。
  - 增加源配置校验、试抓取和预览。
- 多语言与展示体验：
  - 评估英文 UI 与内容摘要翻译。
  - 优化移动端批量筛选、刷新提示和空状态。
- 数据洞察页增强：
  - ✅ 已实现社区风向分析（`GET /api/community/insights` + InsightsPage 社区风向分区）。
  - ✅ 复用 `CommunityTopic` 数据，后端聚合返回 topTopics、sourceShare、heatTrend。
  - ✅ 前端热门话题 Top 8、来源热度占比、近期热度趋势折线图，stale-first + Socket 刷新。
- 数据库升级预案：
  - 当写入并发或公开访问量明显提升时，评估从 SQLite 迁移到 PostgreSQL。
- 社区热点页性能优化：
  - ✅ P0：先返回旧数据、后台异步刷新，消除冷启动 30-60s 阻塞。
  - ✅ P1：NGA 6 论坛并行抓取（3 个一批），替换串行+500ms 延迟。
  - ✅ P1：Framer Motion 去掉逐帧 stagger delay，加 React.memo。
  - ✅ P2：数据库批量 upsert 替代逐条写入（findMany + createMany）。
  - ✅ P3：API 响应加 Cache-Control 头（公开接口 60-3600s，管理端 no-store）。
  - 不做：跳过低热话题 AI 情绪分析——保留全量 AI 分析以保证情绪数据完整性。
