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
- `heatScore` 是展示排名分：同来源、本轮候选集合内的 0-100 相对百分位，不是平台原始互动量；热度环、列表排序和主 UI 继续只使用该字段。
- `trend` 是 `heatScore` 的展示趋势历史，保持 0-100 语义。
- `rawHeatScore` 是来源适配器按平台可得指标计算的原始分，仅用于同一话题的历史趋势判断、排障或后续派生指标；前端不要直接展示 raw 分数。
- `rawHeatTrend` 是 `rawHeatScore` 的历史序列。旧数据可能为空，消费者必须按可选历史处理，不要把空 raw 趋势解释为热度为 0。

### `GET /api/community/insights`

用途：数据洞察页的社区风向聚合。

响应 DTO：`CommunityInsights`。

约束：

- `sourceShare` 和 `heatTrend` 基于展示分 `heatScore/trend` 聚合，适合当前相对热度展示，不暴露 raw 分数。
- raw 趋势判断使用 `/api/community/topics` 中的 `rawHeatScore/rawHeatTrend` 或后续派生字段；不要把不同来源的 raw 分数直接横向展示或聚合成排名。

## 管理接口

### `POST /api/admin/login`

用途：管理员登录。

响应：`{ token: string }`。

### `/api/admin/sources`

用途：源管理。

常用接口：

- `GET /api/admin/sources`
- `POST /api/admin/sources`
- `POST /api/admin/sources/preview`
- `PUT /api/admin/sources/:id`
- `PATCH /api/admin/sources/:id/toggle`
- `DELETE /api/admin/sources/:id`
- `POST /api/admin/sources/seed-defaults`
- `POST /api/admin/sources/follow-url`

响应 DTO：`Source` 或 `Source[]`。

约束：

- 更新接口不能复用带默认值的创建 schema，否则会误写布尔字段。
- 新增运行时配置项时同步检查 `.env.production.example`、`docker-compose.yml`、README 和部署指南。

#### `POST /api/admin/sources/preview`

用途：对尚未保存的 Source draft 执行一次只读试抓取，供管理后台预览和校验配置。需要 `Authorization: Bearer <token>`。

请求体：复用创建源 draft 字段，并额外支持 `limit`。

| 字段 | 语义 |
| --- | --- |
| `name` / `type` / `game` | 必填，和创建源一致 |
| `url` / `uid` / `route` / `isOfficial` / `followed` / `enabled` / `priority` / `config` | 可选，和创建源一致 |
| `limit` | 可选，默认 5，最大 10 |

成功响应 DTO：`SourcePreviewResponse`。

```ts
{
  ok: true;
  source: { name: string; type: string; game: string };
  items: Array<{
    title: string;
    url: string;
    authorName: string | null;
    publishedAt: string | null;
    itemKind: string;
    contentSnippet: string;
  }>;
  totalFetched: number;
  truncated: boolean;
  warnings: string[];
}
```

失败响应：`{ error: string }`。

状态码：
- `400`：draft schema 校验失败。
- `422`：adapter 不支持、上游抓取失败、超时或空结果。
- `500`：非预期错误。

约束：
- 预览必须复用现有 `SourceAdapter` 的 `getAdapter(source).fetch(source)` 路径，不复制 RSS/RSSHub/B站/官网抓取逻辑。
- 不写入 `Source`、`FeedItem`、`AnalysisTask`、`Notification`，不触发全量采集或 socket 广播。
- 返回条目默认 5 条，最多 10 条；正文只返回 `contentSnippet`，服务端截断过长内容。
- 响应、日志和前端提示不得回显完整 `config`、Cookie、token 或 Authorization header。

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
- `trend`：展示分历史，用于 UI 中的热度趋势线。

后续如拆分长期指标，建议新增而不是重命名：

- `rawHeatScore`：来源内固定公式的原始分，只用于同一话题历史趋势或运维分析。
- `rawHeatTrend`：原始分历史，旧数据为空时按缺失历史处理。
- `momentumHeatScore`：基于 `rawHeatScore` 历史变化的趋势分，可选。
- `heatScoreType` / `heatScoreScope`：用于说明展示分的算法和候选集合范围，可选。

前端主列表继续展示 `heatScore`，不要直接展示 `rawHeatScore`，避免用户误认为不同平台原始分可横向比较。
