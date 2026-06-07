# ACG Pulse

AI 驱动的游戏/ACG 资讯聚合面板，自动采集多源内容，智能分类定级，实时推送情报。

> 本项目改编自 [yupi-hot-monitor](https://github.com/liyupi/yupi-hot-monitor)，在原版热点监控基础上重构为游戏/ACG 垂直场景，新增 AI 分类、故事聚合、热搜监控、多 Provider 支持等功能。

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

### 方式一：一键部署（推荐）

SSH 到服务器后执行：

```bash
curl -sL https://raw.githubusercontent.com/yingzhu77/personal-hot-monitor/master/auto-deploy.sh | bash
```

或手动执行：

```bash
git clone https://github.com/yingzhu77/personal-hot-monitor.git
cd personal-hot-monitor
bash auto-deploy.sh
```

### 方式二：手动部署

```bash
git clone https://github.com/yingzhu77/personal-hot-monitor.git
cd personal-hot-monitor
cp .env.production.example .env
# 编辑 .env 配置 AI Provider 和管理员密码
docker compose up -d --build
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

## B站数据源配置

B站视频源（官方账号 + UP主）需要 Cookie 才能稳定采集。不配置 Cookie 时：
- 匿名请求会被 B站限流（403 错误）
- 部分源会显示"采集失败"
- 米游社 RSS 源不受影响，可正常工作

### 获取 B站 Cookie

1. 浏览器登录 https://www.bilibili.com
2. 按 `F12` 打开开发者工具
3. 点击 **Application**（应用程序）标签
4. 左侧展开 **Cookies** → `https://www.bilibili.com`
5. 复制以下三个值：
   - `SESSDATA`（登录凭证）
   - `bili_jct`（CSRF Token）
   - `DedeUserID`（用户 ID）

### 配置 Cookie

在 `.env` 文件中添加（所有 UID 共用同一个 Cookie 即可）：

```bash
BILIBILI_COOKIE_401742377=SESSDATA=你的SESSDATA; bili_jct=你的bili_jct; DedeUserID=你的DedeUserID
BILIBILI_COOKIE_1340190821=SESSDATA=你的SESSDATA; bili_jct=你的bili_jct; DedeUserID=你的DedeUserID
# ... 为每个 B站 UID 添加一行
```

需要配置的 UID 列表（默认数据源）：

| UID | 名称 |
|-----|------|
| 401742377 | 原神 |
| 1340190821 | 崩坏：星穹铁道 |
| 27534330 | 崩坏3第一偶像爱酱 |
| 1636034895 | 绝区零 |
| 1955897084 | 鸣潮 |
| 161775300 | 明日方舟 |
| 1265652806 | 明日方舟终末地 |
| 3546636978489848 | 异环 |
| 652239032 | IGN中国（UP主） |
| 8465957 | 乌鸦预告片（UP主） |

### Cookie 过期

B站 Cookie 有效期约 **6 个月**，过期后需要重新获取并更新 `.env`。症状：
- B站源显示"采集失败"
- 日志中出现 `403` 或 `-352 风控校验失败`

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
