# ACG Pulse

AI 驱动的游戏/ACG 资讯聚合面板。自动从多个来源采集内容，用 AI 分类定级，实时推送到前端。

> 本项目改编自 [yingzhu77/hot-monitor](https://github.com/yingzhu77/hot-monitor)，在原版基础上重构为游戏/ACG 垂直场景，新增 AI 分类、故事聚合、热搜监控等功能。

## 功能特性

- **多源数据采集** — B站、米游社、RSS、官网等 24+ 数据源
- **AI 智能分类** — 支持 OpenRouter / DeepSeek / Xiaomi MiMo 三种 AI Provider
- **故事聚合** — 多源内容自动合并为故事卡片
- **热搜监控** — B站热搜、微博热搜、豆瓣热榜
- **实时推送** — WebSocket 实时更新
- **移动端适配** — 抽屉式筛选面板 + FAB
- **收藏功能** — localStorage 本地收藏
- **Docker 部署** — 一键容器化部署

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + Vite 7 + Tailwind CSS 4 + Framer Motion |
| 后端 | Express 5 + Prisma/SQLite + Socket.io |
| AI | OpenRouter / DeepSeek / Xiaomi MiMo |
| RSS | RSSHub (Docker) |
| 部署 | Docker Compose |

## 快速开始

### Docker 部署（推荐）

```bash
git clone https://github.com/yingzhu77/personal-hot-monitor.git
cd personal-hot-monitor
cp .env.production.example .env
# 编辑 .env 配置 AI Provider 和管理员密码
docker compose up -d
```

访问 `http://localhost:3001`

### 本地开发

```bash
# 后端
cd server && npm install && npm run dev

# 前端
cd client && npm install && npm run dev
```

## 环境变量

```bash
# AI Provider（三选一）
AI_PROVIDER=mimo
MIMO_API_KEY=你的key
MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1

# 管理员
ADMIN_PASSWORD=你的密码
ADMIN_JWT_SECRET=随机字符串

# 情报上限
MAX_FEED_ITEMS=2000
```

## 一键部署到服务器

```bash
# 本地执行
./deploy.sh 你的服务器IP root
```

或 SSH 到服务器后：

```bash
curl -sL https://raw.githubusercontent.com/yingzhu77/personal-hot-monitor/master/server-deploy.sh | bash
```

## 目录结构

```
server/src/gamepulse/
  adapters/        数据源适配器
  ai/              AI 分析模块
  jobs/            定时任务
  routes/          API 路由
  storyAggregation.ts  故事聚合

client/src/
  components/      UI 组件
  hooks/           自定义 Hooks
  services/        API 客户端
```

## License

MIT
