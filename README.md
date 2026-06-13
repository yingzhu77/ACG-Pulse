# ACG Pulse

AI 驱动的游戏/ACG 资讯聚合面板，自动采集多源内容，智能分类定级，实时推送情报。

> 本项目改编自 [yupi-hot-monitor](https://github.com/liyupi/yupi-hot-monitor)，在原版热点监控基础上重构为游戏/ACG 垂直场景，新增 AI 分类、故事聚合、热搜监控、多 Provider 支持等功能。

**在线体验：** [https://acg.yingzhu.xyz](https://acg.yingzhu.xyz)

## 功能特性

- **多源数据采集** — B站、米游社、RSS、官网等 24+ 数据源
- **AI 智能分类** — 支持 OpenRouter / DeepSeek / Xiaomi MiMo 三种 AI Provider
- **故事聚合** — 多源内容自动合并为故事卡片
- **社区热点风向** — B站热门视频评论 + AI 情绪分析 + 话题分类
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

## 项目协作

- [Agent 协作手册](docs/AGENT_WORKFLOW.md)：任务输入格式、开发流程、验证命令、提交规范。
- [优化路线图](docs/ROADMAP.md)：当前阶段、第二阶段和第三阶段待办。
- [后续小窗口任务提示词](docs/NEXT_WINDOW_PROMPTS.md)：按优先级拆分给其他窗口执行的具体任务。
- [踩坑记录](docs/LESSONS.md)：已验证的问题模式、根因和复用规则。
- [架构决策](docs/DECISIONS.md)：关键技术选择和后续变更入口。

## 快速开始

> **编码约定**：项目源码和文档均使用 UTF-8。Windows PowerShell 读取中文文件时建议显式使用
> `Get-Content -Encoding UTF8 <file>`，避免控制台默认编码造成中文显示乱码。

### 方式一：Docker 部署（推荐）

```bash
git clone https://github.com/yingzhu77/personal-hot-monitor.git
cd personal-hot-monitor

# 复制环境变量模板并编辑
cp .env.production.example .env
nano .env  # 填写 ADMIN_PASSWORD、ADMIN_JWT_SECRET、AI Provider Key

# 预检配置（可选，但推荐）
bash scripts/check-config.sh

# 启动
docker compose up -d --build
```

访问 `http://localhost:3001`

### 方式二：一键部署脚本

```bash
# 设置环境变量（必须）
export ADMIN_PASSWORD=你的强密码
export ADMIN_JWT_SECRET=$(openssl rand -hex 32)
export MIMO_API_KEY=你的key

# 执行部署
git clone https://github.com/yingzhu77/personal-hot-monitor.git
cd personal-hot-monitor
bash auto-deploy.sh
```

### 方式三：本地开发

```bash
# 前置条件：Node.js 18+、npm、Docker（运行 RSSHub）

# 启动 RSSHub（需 Docker）
docker run -d --name rsshub -p 1200:1200 diygod/rsshub:latest

# 后端
cd server && cp .env.example .env && npm install && npm run dev

# 前端
cd client && npm install && npm run dev
```

访问 `http://localhost:5173`

> **首次部署注意**：服务启动时会校验 `ADMIN_PASSWORD` 和 `ADMIN_JWT_SECRET`，若未设置或使用默认值将拒绝启动。

### 运维脚本

```bash
# 预检 .env 配置（避免启动后才报错）
bash scripts/check-config.sh

# 安全重置管理员密码（自动备份、不打印敏感值）
bash scripts/reset-admin-password.sh
```

更多部署踩坑和运维命令见 [docs/deployment-troubleshooting.md](docs/deployment-troubleshooting.md)。

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

## B站数据源配置

B站视频源需要 Cookie 才能稳定采集。不配置时匿名请求会被限流。

### 获取 B站 Cookie

1. 浏览器登录 https://www.bilibili.com
2. F12 → **Application** → **Cookies** → `https://www.bilibili.com`
3. 复制 `SESSDATA`、`bili_jct`、`buvid3`、`buvid4` 四个值

### 配置 Cookie

在 `.env` 中设置一行（所有源共用）：

```bash
BILIBILI_COOKIE="buvid4=你的值; buvid3=你的值; SESSDATA=你的值; bili_jct=你的值"
```

`docker-compose.yml` 已配置将此变量传入 app 和 RSSHub 容器。

### Cookie 过期

B站 Cookie 有效期约 **6 个月**。过期症状：
- B站源显示"采集失败"或"degraded"
- 日志中出现 `-352 风控校验失败`

更新 Cookie 后执行 `docker compose restart app` 生效。

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

## 项目状态

### 已完成功能

| 功能 | 状态 |
|------|------|
| 多源数据采集（24+ 数据源） | ✅ |
| AI 智能分类（OpenRouter/DeepSeek/MiMo） | ✅ |
| 故事聚合（多源合并） | ✅ |
| 热搜监控（B站/微博/豆瓣） | ✅ |
| 实时推送（WebSocket） | ✅ |
| 移动端适配 | ✅ |
| 收藏功能 | ✅ |
| Docker 一键部署 | ✅ |
| 管理后台 | ✅ |
| B站 Cookie 配置 | ✅ |

### 后续优化方向（待定）

- 性能优化：大数据量下的渲染性能
- 更多数据源：知乎、小红书等
- 搜索功能：全文搜索情报内容
- 导出功能：情报导出为 PDF/Markdown
- 多语言支持：英文界面
- 更细粒度的分类规则
- 自定义数据源订阅
