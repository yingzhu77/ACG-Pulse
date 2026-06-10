# AGENTS.md — Agent 协作指南

> 本文件是 AI Agent 理解和协作本项目的核心参考。包含项目目标、技术架构、目录结构、已知问题和协作规范。

---

## 项目目标

**ACG Pulse** — AI 驱动的游戏/ACG 资讯聚合面板

- 自动采集多源内容（B站、米游社、RSS、官网等 24+ 数据源）
- AI 智能分类定级（announcement/event/version/character/pv/music/trailer 等 13 种分类）
- 多源内容自动合并为"故事"卡片（Story 聚合）
- 实时 WebSocket 推送
- 热搜监控（B站/微博/豆瓣）

**v1 范围约束**:
- 公开只读仪表盘 + 私有管理后台
- 不添加用户注册功能
- 热搜/趋势是预留适配器，不做核心行为
- 采集与 AI 分析解耦，AI 失败不能阻塞采集

---

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React + TypeScript | 19 |
| 构建工具 | Vite | 7 |
| 样式 | Tailwind CSS + 自定义 CSS | 4 |
| 动画 | Framer Motion | - |
| 图标 | Lucide React | - |
| 后端框架 | Express | 5 |
| ORM | Prisma + SQLite | - |
| 实时通信 | Socket.IO | - |
| AI Provider | OpenRouter / DeepSeek / Xiaomi MiMo | - |
| RSS | RSSHub (Docker) | - |
| 部署 | Docker Compose | - |

---

## 目录结构

```
personal-hot-monitor/
├── client/                     # 前端
│   ├── src/
│   │   ├── App.tsx             # 主组件（路由、布局）
│   │   ├── main.tsx            # 入口
│   │   ├── constants.ts        # 分类/来源/游戏常量映射
│   │   ├── index.css           # 全局样式（2000+ 行）
│   │   ├── components/         # UI 组件（14 个）
│   │   │   ├── FeedPanel.tsx       # 情报流主面板（搜索、分页、故事列表）
│   │   │   ├── StoryCard.tsx       # 单条情报卡片
│   │   │   ├── GameFilterPanel.tsx # 左侧游戏/分类筛选面板
│   │   │   ├── TopBar.tsx          # 顶部工具栏
│   │   │   ├── SummaryColumn.tsx   # 右侧摘要/通知/源健康
│   │   │   ├── InsightsPage.tsx    # 数据洞察页（图表）
│   │   │   ├── AdminDrawer.tsx     # 管理后台抽屉
│   │   │   ├── HotSearchPanel.tsx  # 热搜面板
│   │   │   └── ...                 # Tag, Donut, SourceIcon 等小组件
│   │   ├── hooks/              # 自定义 Hooks（6 个）
│   │   │   ├── usePublicData.ts    # 核心数据 hook（分页、筛选、滚动、Socket）
│   │   │   ├── useAdmin.ts         # 管理后台 hook（登录、源管理、分析）
│   │   │   ├── useHotSearch.ts     # 热搜 hook
│   │   │   ├── useFavorites.ts     # 收藏 hook（localStorage）
│   │   │   ├── useTheme.ts         # 主题 hook
│   │   │   └── useToast.ts         # Toast 提示 hook
│   │   ├── services/           # API 和通信
│   │   │   ├── api.ts              # REST API 封装（publicApi / adminApi）
│   │   │   └── socket.ts           # WebSocket 封装
│   │   ├── utils/              # 工具函数
│   │   │   ├── filter.ts           # 筛选值操作（toggle/has）
│   │   │   ├── format.ts           # 格式化（分类标签、重要性、日期）
│   │   │   └── stats.ts            # 统计工具（源健康、去重率）
│   │   └── lib/
│   │       └── utils.ts            # cn() 工具函数
│   └── public/                 # 静态资源
│       └── game-pulse/         # 背景图、参考设计
│
├── server/                     # 后端
│   ├── src/
│   │   ├── index.ts            # Express 入口（路由注册、静态文件）
│   │   ├── db.ts               # Prisma 客户端
│   │   └── gamepulse/          # 核心业务模块
│   │       ├── adapters/           # 数据源适配器
│   │       │   ├── base.ts             # 适配器基类接口
│   │       │   ├── bilibiliVideo.ts    # B站视频适配器
│   │       │   ├── rsshub.ts           # RSSHub 适配器
│   │       │   ├── rss.ts              # 通用 RSS 适配器
│   │       │   ├── officialSite.ts     # 官网适配器
│   │       │   ├── trend.ts            # 趋势适配器
│   │       │   ├── hotSearch.ts        # 热搜适配器
│   │       │   └── registry.ts         # 适配器注册表
│   │       ├── ai/                 # AI 分析模块
│   │       │   ├── provider.ts         # AI Provider 抽象（OpenRouter/DeepSeek/MiMo）
│   │       │   └── analyzer.ts         # 分析执行器（含预筛、后处理）
│   │       ├── routes/             # API 路由
│   │       │   ├── public.ts           # 公共路由组合
│   │       │   ├── stories.ts          # 情报路由
│   │       │   ├── sources.ts          # 源路由
│   │       │   ├── stats.ts            # 统计路由
│   │       │   ├── admin.ts            # 管理 API
│   │       │   ├── helpers.ts          # 路由辅助函数
│   │       │   └── middleware.ts       # 中间件（日志、错误处理）
│   │       ├── jobs/               # 定时任务
│   │       │   └── checker.ts          # 源检查任务
│   │       ├── storyAggregation.ts # 故事聚合逻辑（去重、合并）
│   │       ├── types.ts            # TypeScript 类型定义
│   │       ├── validation.ts       # Zod 输入验证
│   │       ├── auth.ts             # JWT 认证
│   │       ├── defaultSources.ts   # 默认数据源配置
│   │       └── utils.ts            # 工具函数
│   └── prisma/
│       └── schema.prisma       # 数据库 Schema
│
├── docs/                       # 文档
│   ├── LESSONS.md              # 踩坑记录与 Agent 协作经验
│   ├── deployment-guide.md     # 部署指南
│   └── deployment-troubleshooting.md  # 部署踩坑记录
│
├── docker-compose.yml          # Docker 编排
├── docker-compose.rsshub.yml   # RSSHub 编排
├── auto-deploy.sh              # 一键部署脚本
└── AGENTS.md                   # 本文件
```

---

## 核心数据流

```
数据源 → 适配器(Adapter) → FeedItem → AI分析(Analyzer) → Analysis
                                    ↓
                              故事聚合(StoryAggregation) → Story
                                    ↓
                              API(Routes) → 前端(React)
                                    ↓
                              WebSocket(Socket.IO) → 实时推送
```

### 分类体系（核心规则）

`sourceIsOfficial` 决定分类组，这是分类的核心维度：

| 分类 | 含义 | sourceIsOfficial |
|------|------|-----------------|
| announcement | 官方公告 | true |
| event | 活动资讯 | true |
| version | 版本更新 | true |
| character | 角色情报 | true |
| pv | 官方视频 | true |
| game_music | 游戏官方EP/OST | true |
| community | 社区热点 | true |
| music | 创作者音乐 | false |
| trailer | 非官方预告 | false |
| movie_trailer | 电影/剧集预告 | false |
| creator_video | 创作者杂谈/攻略 | false |
| enforcement | 封禁/处罚公示 | - |
| other | 其他 | - |

**严禁跨组分类**: 官方源只能分到游戏情报组，创作者源只能分到关注投稿组。

### 故事合并规则

```
PV 不与任何其他类别合并
创作者视频不与任何官方内容合并
音乐不与公告、活动、版本更新合并
预告片不与公告、活动、版本合并
关键词匹配需要 ≥3 个且包含至少一个专有名词
合并时间窗口：普通 24h，版本/角色/PV/创作者视频 48h
```

---

## 已知问题与限制

### 当前已知问题

| 问题 | 影响 | 状态 |
|------|------|------|
| B站 Cookie 需要重启服务才能生效 | 配置后需手动重启 | 已知限制 |
| Cookie 有效期约 6 个月 | 过期后 B站源全部失败 | 需定期更新 |
| 2GB 内存是最低要求 | 低于 2GB 会 OOM | 已知限制 |
| Express 5 不支持 `*` 通配符 | SPA 路由需用 middleware | 已解决 |
| AI 分类偶尔跨组 | 后处理规则兜底 | 持续优化 |

### 历史踩坑（详见 docs/LESSONS.md）

- **翻页滚动丢失**: 异步 DOM 操作时序问题 → 数据加载后滚动
- **闭包过期**: 快速操作读到旧状态 → useRef 追踪最新值
- **搜索 API 风暴**: 无 debounce → 300ms 延迟
- **AI 分类混淆**: sourceIsOfficial 未传入 AI → 三层防线
- **MiMo Provider**: 5 次修复（URL/model/timeout/token/auth header）
- **情报合并过激**: 关键词太通用 → 专有名词检查

---

## Agent 协作规范

### 修改代码前

1. **先读再改**: 理解现有代码结构和模式后再动手
2. **检查依赖**: 改接口前 grep 所有使用处
3. **确认范围**: 明确修改影响哪些文件和功能

### 修改代码后

1. **TypeScript 编译**: `npx tsc --noEmit` 必须通过
2. **构建验证**: 重要改动需 `cd client && npm run build` 验证（Docker tsconfig 更严格）
3. **不影响现有功能**: 改 A 不能破坏 B
4. **错误处理一致性**: 同一 hook 的所有函数都要有 try/catch

### 接口变更（严格流程）

改组件 Props 接口时，**禁止只用 replace_all**，必须：

```
1. grep 组件名 → 找到所有 JSX 使用处（桌面端 + 移动端 + drawer 可能各一处）
2. 逐一确认每个使用处的 prop 是否匹配新接口
3. npx tsc --noEmit
4. cd client && npm run build（验证 tsconfig 严格模式）
```

**规则**:
- `useRef` 必须传初始值（`useRef<T | undefined>(undefined)`）
- 同一组件可能在 App.tsx 中渲染多次，每处都要检查
- 本地 tsc 通过 ≠ Docker 构建通过

### 分类相关修改

- 分类标签在 `client/src/constants.ts` 和 `server/src/gamepulse/ai/provider.ts` 中定义
- 新增分类需要同时更新：AI 提示词、类型定义、验证 schema、前端常量、后处理规则
- `sourceIsOfficial` 是分类核心维度，不能省略

### 性能相关修改

- 列表过滤/转换用 `useMemo`
- `Array.includes` 大数据量时改 `Set.has`
- 搜索输入必须 debounce
- 避免每秒级定时器（TopBar 时钟已改为 60s）

### 错误处理

- 所有 async 函数必须有 try/catch
- API 失败时用 `showToast` 提示用户
- 不要 `console.error` 后什么都不做

---

## 常用命令

```powershell
# 前端开发
cd client && npm run dev

# 后端开发
cd server && npm run dev

# TypeScript 检查
cd client && npx tsc --noEmit

# 构建
cd client && npm run build
cd server && npm run build

# 测试
cd server && npm test

# Docker 部署
docker compose up -d --build

# 查看日志
docker compose logs -f app
```

---

## 后续规划

### 近期：社区热点风向模块（✅ 已完成 v1.2）

**已实现**：
- B站热门视频采集（游戏区+番剧区排行+全站热门）
- NGA 论坛热帖采集（6 个游戏论坛：原神/星铁/崩坏3/绝区零/鸣潮/方舟）
- AI 情绪分析（关键词优先 + MiMo/DeepSeek 批量分析模糊案例）
- 反讽检测（AI 理解上下文语境）
- 热度评分（时间衰减 24h 半衰期 + 播放/点赞/评论加权）
- 跨源去重（标题标准化 + 60% 子串相似度）
- 前端：三 Tab 导航、情绪卡片、环形热度图、迷你趋势图
- 并发优化：评论批量请求 + AI 批量分析

**小黑盒**：API 签名机制已更新，需后续逆向

### 下一步：v1.3 优化计划

#### 功能优化

| 优先级 | 项目 | 说明 | 预估 |
|--------|------|------|------|
| P0 | 社区数据持久化 | 当前内存缓存，重启丢失。写入 SQLite 支持历史趋势对比 | 2 天 |
| P0 | 增量更新 | 只抓取新内容，只对新内容做 AI 分析，旧数据保留 trend | 1 天 |
| P1 | 定时任务 | cron 每 30 分钟刷新社区数据，用户访问直接读缓存 | 0.5 天 |
| P1 | WebSocket 推送 | 复用 io.emit 机制推送社区热点更新 | 1 天 |
| P2 | 小黑盒集成 | 逆向 hkey 签名算法，接入游戏资讯+折扣数据 | 2 天 |
| P2 | NGA 更多板块 | 扩展到更多游戏分区（目前 6 个） | 1 天 |

#### 架构优化

| 优先级 | 项目 | 说明 |
|--------|------|------|
| P1 | asyncHandler 统一错误处理 | admin.ts 等路由缺少 try/catch，创建统一包装器 |
| P1 | 共享类型提取 | CommunityTopic 在前后端各定义一份，提取到共享模块 |
| P2 | AI Provider 配置去重 | resolveAiConfig() 在 community.ts 和 provider.ts 中重复 |
| P2 | CSS 模块化 | index.css 2200+ 行，拆分为 community-panel.css 等 |
| P3 | ESLint 集成 | CI 添加 lint 步骤 |

#### 运维优化

| 优先级 | 项目 | 说明 |
|--------|------|------|
| P1 | 采集成功率监控 | 外部 API 失败率超阈值时告警 |
| P2 | 日志脱敏 | requestLogger 记录完整 URL，可能泄露 query params |
| P2 | 健康检查增强 | 验证数据库连接 + AI provider 可用性 |

### 中期

- 更多数据源：知乎、小红书
- 全文搜索情报内容
- 情报导出 PDF/Markdown

### 远期

- 多语言支持
- 自定义数据源订阅
- 社区真伪辨别（多源交叉验证 + AI 事实核查）

---

## 文档索引

| 文件 | 内容 |
|------|------|
| `CLAUDE.md` | 每次启动自动加载：约束、规范、当前状态 |
| `AGENTS.md` | 本文件 — Agent 协作指南 |
| `README.md` | 项目介绍、快速开始、环境变量 |
| `docs/LESSONS.md` | 跨项目踩坑记录、复盘分析、Prompt 模板 |
| `docs/deployment-guide.md` | 服务器部署指南 |

---

## 更新日志

| 日期 | 内容 |
|------|------|
| 2026-06-09 | 初始版本：项目结构、技术栈、分类体系、已知问题、协作规范 |
| 2026-06-11 | v1.2：社区热点风向模块（B站+NGA+AI情绪分析）、安全加固、CI/CD、代码审查修复 |
