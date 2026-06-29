# API 契约总览

本文档记录 ACG Pulse 当前对外和前端消费的接口契约。它不是 OpenAPI 生成物；字段级 DTO 的事实来源优先看 `shared/`，运行时校验优先看后端 `validation.ts` 和对应 route。

## 事实来源

| 契约 | 事实来源 |
| --- | --- |
| 公共情报、故事、报表、管理队列 DTO | `shared/api.ts` |
| 社区话题 DTO | `shared/community.ts`，服务端镜像为 `server/src/gamepulse/community/types.ts` |
| 运维面板 DTO | `shared/operations.ts`，服务端所有者为 `server/src/gamepulse/observability/types.ts` |
| 公开 stories/items 查询校验 | `server/src/gamepulse/validation.ts` |
| 前端 query 序列化 | `client/src/services/api.ts` 的 `withParams()` |
| 路由实现 | `server/src/gamepulse/routes/` |

变更接口时必须同步检查：后端 route、运行时校验、`shared/` DTO、前端调用、测试和本文档。

## 通用约定

- 响应时间字段均为 ISO 字符串，空值使用 `null`。
- 分页响应使用 `{ data, pagination }`，其中 `pagination` 包含 `page`、`limit`、`total`、`totalPages`。
- 管理接口需要 `Authorization: Bearer <token>`；前端在 API 客户端层统一处理 `401`。
- 只有 `game`、`category`、`importance`、`sourceUid` 支持多值 query 语义。`q` 必须按普通字符串原样传递。
- 公共 stories facet 使用 Story 数语义；数据洞察、来源统计和运维容量继续使用 FeedItem 数语义。

## 公共接口

### `GET /api/public/stories`

用途：主页面故事列表。

常用 query：

| 参数 | 语义 |
| --- | --- |
| `page` / `limit` | 分页 |
| `game` | 游戏筛选，支持多值 |
| `category` | 分类筛选，支持多值 |
| `importance` | 重要性筛选，支持多值 |
| `visibility` | 可见性筛选 |
| `followGroup` | `follow` 表示关注源，`game` 表示游戏源 |
| `sourceUid` | 关注 UP 主 UID，支持多值 |
| `q` | 搜索词，普通字符串 |
| `includeFacets` | 是否返回 facet 计数 |

响应 DTO：`StoriesResponse`。

约束：

- `facets` 表示当前筛选条件下的 Story 数。
- 所有分页页码使用同一个候选窗口，避免 total 和页边界漂移。
- `includeFacets=false` 仍返回空 facets 结构，以保持前端兼容。

### `GET /api/public/items`

用途：公开 FeedItem 列表，主要用于兼容和管理侧查询。

响应 DTO：`Paginated<FeedItem>`。

约束：

- FeedItem 在采集成功后即可入流，`analysis` 可以为 `null`。
- AI 重试只补齐或修正 `analysis`，不应重复创建 FeedItem。

### `GET /api/public/stats`

用途：数据洞察基础统计。

响应 DTO：`PublicStats`。

约束：

- 统计语义是 FeedItem 条数，不是 Story 数。
- `REPORT_TIMEZONE` 决定日报/周报日期边界，不依赖容器本地时区。

### `GET /api/public/sources`

用途：公开源列表与前端筛选。

响应 DTO：`Source[]`。

### `GET /api/public/hot-search`

用途：外部热搜面板。

响应：`{ data: HotSearchItem[], total: number, lastUpdated: string }`。

### `GET /api/public/reports/daily`

用途：日报 JSON。

响应 DTO：`ReportResponse`。

### `GET /api/public/reports/weekly`

用途：周报 JSON。

响应 DTO：`ReportResponse`。

### `GET /api/public/reports/export`

用途：Markdown 报告下载。

约束：

- 复用日报/周报的数据查询语义。
- 暂不引入 PDF 生成链路。

## 社区接口

### `GET /api/community/topics`

用途：社区热点风向列表。

query：

| 参数 | 语义 |
| --- | --- |
| `sentiment` | `positive`、`negative`、`neutral`；`unknown` 不作为筛选入口 |
| `category` | 社区话题分类 |
| `source` | `bilibili`、`nga`、`xiaoheihe` |
| `sort` | `heat` 或 `latest` |
| `page` / `limit` | 分页 |

响应：`CommunityTopic[]` 加分页、summary、`lastUpdated`、`isStale`、`isRefreshing`。

约束：

- 接口采用 stale-first：总是先返回数据库快照，过期时后台刷新。
- AI 未配置、超时或解析失败时情感为 `unknown`，不计入正/负/中性。
- 低置信度只表达为“判断不确定”或弱化标签，不展示小数分数。
- 当前 `heatScore` 是同来源、本轮候选集合内的 0-100 相对百分位，不是平台原始互动量。

### `GET /api/community/insights`

用途：数据洞察页的社区风向聚合。

响应 DTO：`CommunityInsights`。

约束：

- `sourceShare` 和 `heatTrend` 目前基于 `heatScore` 聚合，适合当前相对热度展示。
- 如果后续拆分热度指标，应保留 `heatScore` 兼容旧 UI，并新增 `rawHeatScore` 或 `momentumHeatScore` 用于趋势。

## 管理接口

### `POST /api/admin/login`

用途：管理员登录。

响应：`{ token: string }`。

### `/api/admin/sources`

用途：源管理。

常用接口：

- `GET /api/admin/sources`
- `POST /api/admin/sources`
- `PUT /api/admin/sources/:id`
- `PATCH /api/admin/sources/:id/toggle`
- `DELETE /api/admin/sources/:id`
- `POST /api/admin/sources/seed-defaults`
- `POST /api/admin/sources/follow-url`

响应 DTO：`Source` 或 `Source[]`。

约束：

- 更新接口不能复用带默认值的创建 schema，否则会误写布尔字段。
- 新增运行时配置项时同步检查 `.env.production.example`、`docker-compose.yml`、README 和部署指南。

### `/api/admin/items`

用途：管理 FeedItem。

常用接口：

- `GET /api/admin/items`
- `PATCH /api/admin/items/:id/hide`
- `POST /api/admin/items/:id/analyze`

响应 DTO：`Paginated<FeedItem>` 或 `FeedItem`。

### `/api/admin/analysis-queue`

用途：分析任务队列。

常用接口：

- `GET /api/admin/analysis-queue`
- `POST /api/admin/analysis-queue/:id/retry`
- `POST /api/admin/analysis-queue/retry-failed`
- `POST /api/admin/reanalyze-all`

响应 DTO：`AnalysisQueueOverview`、`{ count: number }` 或 `{ total: number, status: string }`。

约束：

- 批量分析必须入持久化队列，不在请求 handler 中直接执行。
- 失败任务重试只修正 Analysis，不重复采集 FeedItem。
- 已耗尽重试的失败任务才受历史清理策略影响；仍可自动重试的任务不能被清理。

### `GET /api/admin/ops/metrics`

用途：运维面板。

响应 DTO：`OperationalMetrics`。

约束：

- 分析任务历史清理状态在 `capacity.analysisQueue.historyCleanup` 中展示。
- API 延迟样本是进程内窗口，不是长期监控系统。

## 热度指标演进约束

当前兼容字段：

- `heatScore`：对外展示用相对热度，0-100，按来源内部百分位映射。

后续如拆分长期指标，建议新增而不是重命名：

- `rawHeatScore`：来源内固定公式的原始分，只用于同一话题历史趋势或运维分析。
- `momentumHeatScore`：基于 `rawHeatScore` 历史变化的趋势分，可选。
- `heatScoreType` / `heatScoreScope`：用于说明展示分的算法和候选集合范围，可选。

前端主列表继续展示 `heatScore`，不要直接展示 `rawHeatScore`，避免用户误认为不同平台原始分可横向比较。
