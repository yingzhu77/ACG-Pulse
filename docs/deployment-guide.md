# ACG Pulse 部署指南

## 推荐环境

- **系统**: Ubuntu 24.04
- **配置**: 2核 CPU / 2GB 内存 / 30GB 磁盘（推荐）

> 原生产环境已于 2026 年 8 月下线，不再提供在线演示。新部署必须在 `.env` 中设置自己的 `CLIENT_URL`，并配置对应域名与 HTTPS。

## 一键部署（推荐）

SSH 到服务器后执行：

```bash
curl -sL https://raw.githubusercontent.com/yingzhu77/ACG-Pulse/master/server-deploy.sh | bash
```

部署完成后：
1. 访问 `.env` 中 `CLIENT_URL` 对应的地址
2. 使用服务器 `.env` 中自行设置的 `ADMIN_PASSWORD` 登录管理后台
3. 在「B站 Cookie 配置」中填入 Cookie
4. 重启服务

> 不要在文档、命令历史或 Git 中记录真实管理员密码和 Cookie。

## 手动部署

## 部署步骤

### 1. SSH 连接服务器

```bash
ssh root@你的服务器IP
```

### 2. 安装 Docker

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# 安装 Docker Compose
apt install docker-compose-plugin -y
```

### 3. 配置防火墙

```bash
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # Caddy HTTP
ufw allow 443/tcp   # Caddy HTTPS
ufw enable
```

应用端口 `3001` 仅绑定 `127.0.0.1`，RSSHub 端口只在 Docker 网络中暴露，不应直接开放公网端口。

### 4. 上传代码

```bash
cd /opt
git clone https://github.com/yingzhu77/ACG-Pulse.git personal-hot-monitor
cd personal-hot-monitor
```

### 5. 配置环境变量

```bash
cp .env.production.example .env
nano .env
```

必填配置：

```bash
ADMIN_PASSWORD=你的密码
ADMIN_JWT_SECRET=随机字符串
# AI Provider 三选一：
# 方案 A - DeepSeek（生产默认）：
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
# 方案 B - OpenRouter：
# AI_PROVIDER=openrouter
# OPENROUTER_API_KEY=你的key
# OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
# OPENROUTER_MODEL=deepseek/deepseek-v3.2
# 方案 C - Xiaomi MiMo Token Plan：
# AI_PROVIDER=mimo
# MIMO_API_KEY=tp-xxxxx
# MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1  # 中国集群（默认）
# MIMO_MODEL=mimo-v2.5
MAX_FEED_ITEMS=2000
ANALYSIS_TASK_COMPLETED_RETENTION_DAYS=14
ANALYSIS_TASK_FAILED_RETENTION_DAYS=30
REPORT_TIMEZONE=Asia/Shanghai
```

### 6. 启动服务

```bash
docker compose up -d
```

### 7. 验证

```bash
# 检查容器状态
docker compose ps

# 访问测试
curl http://localhost:3001/api/public/stats
```

## 更新部署

现有服务器使用分阶段更新。不要把拉取、构建、备份和替换容器粘成一条长命令；低内存服务器应在 tmux 中只构建 `app`，本次无需重建 RSSHub。

### 1. 收拢旧热修并拉取代码

如果 `git status` 显示旧部署遗留的 `M docker-compose.yml` 或 `?? rsshub/`，先备份到仓库外再拉取。不要删除 `.env`、`backups/` 或 Docker volume。

```bash
cd /opt/personal-hot-monitor
STAMP="$(date +%Y%m%d_%H%M%S)"
mkdir -p "/opt/acg-deploy-local-backups/$STAMP"

git diff -- docker-compose.yml > "/opt/acg-deploy-local-backups/$STAMP/docker-compose.patch"
git restore docker-compose.yml
if [ -d rsshub ] && ! git ls-files --error-unmatch rsshub/Dockerfile >/dev/null 2>&1; then
  mv rsshub "/opt/acg-deploy-local-backups/$STAMP/rsshub"
fi

git fetch origin master
git checkout master
git pull --ff-only origin master
git status -sb
git rev-parse --short HEAD
```

目标提交应不低于部署说明中记录的最新 `master`，且工作区不再有 tracked 修改。

### 2. 配置预检

```bash
cd /opt/personal-hot-monitor
cp .env ".env.predeploy.$(date +%Y%m%d_%H%M%S)"

PUBLIC_ORIGIN="https://your-domain.example"

grep -q '^CLIENT_URL=' .env \
  && sed -i "s#^CLIENT_URL=.*#CLIENT_URL=${PUBLIC_ORIGIN}#" .env \
  || printf '\nCLIENT_URL=%s\n' "$PUBLIC_ORIGIN" >> .env
grep -q '^TRUST_PROXY_HOPS=' .env \
  && sed -i 's#^TRUST_PROXY_HOPS=.*#TRUST_PROXY_HOPS=1#' .env \
  || printf 'TRUST_PROXY_HOPS=1\n' >> .env

chmod 600 .env
bash scripts/check-config.sh .env
docker compose config --quiet
```

### 3. 在 tmux 中构建 app

```bash
tmux new-session -d -s acg-deploy
tmux send-keys -t acg-deploy \
  'cd /opt/personal-hot-monitor; docker compose build app 2>&1 | tee /tmp/app-build.log; rc=${PIPESTATUS[0]}; echo "APP_BUILD_RC=$rc" | tee /tmp/app-build.rc' \
  C-m

tail -f /tmp/app-build.log
```

看到构建结束后按 `Ctrl+C` 只会退出日志查看，再确认：

```bash
cat /tmp/app-build.rc
```

必须显示 `APP_BUILD_RC=0` 才能继续。

### 4. 备份并替换 app

```bash
cd /opt/personal-hot-monitor
bash scripts/pre-deploy-backup.sh
docker compose up -d --no-deps app

for i in $(seq 1 30); do
  STATUS="$(docker inspect -f '{{.State.Health.Status}}' game-pulse 2>/dev/null || echo missing)"
  echo "app health: $STATUS"
  [ "$STATUS" = "healthy" ] && break
  sleep 2
done

docker compose ps
docker compose logs app --tail 120
```

首次升级到可审计迁移版本时，日志应包含 `Existing database has no Prisma migration history; marking baseline as applied...` 和 `Applying migration` / `No pending migrations to apply`。这表示旧生产库已保留现有结构，并从 baseline 开始接入 Prisma Migrate 历史。升级到稳定情报身份版本时，日志应包含 `Identity backfill completed`；若历史数据已经回填完成，后续重启不会重复输出该行。

### 5. 验收

```bash
cd /opt/personal-hot-monitor
git rev-parse --short HEAD
curl -fsS http://127.0.0.1:3001/api/health && echo
curl -fsS 'http://127.0.0.1:3001/api/public/stories?limit=1&page=1&includeFacets=false' >/dev/null
PUBLIC_ORIGIN="$(sed -n 's/^CLIENT_URL=//p' .env | tail -n 1)"
curl -fsS "${PUBLIC_ORIGIN}/api/health" && echo
curl -sSI "${PUBLIC_ORIGIN}/api/health" | grep -iE 'HTTP/|access-control-allow-origin'
docker compose ps
```

部署后响应头中的 `Access-Control-Allow-Origin` 应与 `.env` 中的 `CLIENT_URL` 一致，不应继续是 localhost：

```bash
PUBLIC_ORIGIN="$(sed -n 's/^CLIENT_URL=//p' .env | tail -n 1)"
curl -sSI "${PUBLIC_ORIGIN}/api/health" | grep -i access-control-allow-origin
```

## 数据库迁移流程

生产数据库结构变更必须走 Prisma Migrate。不要在生产容器入口或部署命令中使用 `prisma db push --accept-data-loss` 同步 schema；`db push` 只适合本地临时原型验证。

当前仓库包含 `server/prisma/migrations/20260706000000_baseline`。这份迁移描述的是项目在迁移化之前已经由 `db push` 管理出来的完整 schema：

- 新部署的空数据库会通过 `prisma migrate deploy` 从 baseline 建表。
- 已有生产数据库如果没有 `_prisma_migrations` 表，入口脚本会在备份和 FTS 清理后执行一次 `prisma migrate resolve --applied 20260706000000_baseline`，再运行 `prisma migrate deploy`。
- 后续新增字段、索引、约束时，必须提交新的 migration 目录，不再依赖 Prisma 在生产自动推断 schema diff。

本地开发生成迁移：

```bash
cd server
npm run db:migrate -- --name 描述性迁移名
npm run db:status
```

只创建迁移文件、暂不应用到本地库：

```bash
cd server
npx prisma migrate dev --create-only --name 描述性迁移名
```

提交前检查：

```bash
npm --prefix server test
npm --prefix server run build
git diff --check
```

生产发布时仍按“更新部署”流程执行。新容器启动后会自动运行：

```bash
npx prisma generate
npx prisma migrate deploy
```

如果 `migrate deploy` 失败，不要手工修改生产库；先保留日志和 `pre-migrate-backups` 中的备份，回到本地修正 migration 后重新发布。

## 数据备份

### 手动备份

```bash
# 使用备份脚本（推荐）
bash scripts/backup-db.sh

# 备份到指定目录，保留最近 10 份
bash scripts/backup-db.sh game-pulse /opt/backups 10

# 手动方式
docker exec game-pulse cp /app/server/data/prod.db /app/server/data/prod.db.bak
docker cp game-pulse:/app/server/data/prod.db ./backup/
```

### 定时备份（推荐）

```bash
# 每天凌晨 3 点自动备份，保留 7 份
crontab -e
# 添加：
0 3 * * * cd /opt/personal-hot-monitor && bash scripts/backup-db.sh >> /var/log/acg-backup.log 2>&1
```

### 恢复数据库

```bash
# 从备份恢复
bash scripts/restore-db.sh ./backups/prod_20260612_030000.db

# 恢复脚本会自动：校验 SHA256 → 创建回退快照 → 停止服务 → 替换数据库 → 重启服务
```

## 源健康监控

源健康历史每 30 分钟自动记录。查看健康状态：

```bash
# 查看源健康历史统计
curl http://localhost:3001/api/public/source-health-history

# 查看服务状态（包含 checker 运行状态）
curl http://localhost:3001/api/health
```

健康历史接口返回：
- `recentLogs`：最近 24 小时的检查日志
- `sourceStats`：每个源的失败率统计
- `totalChecks24h` / `totalFailures24h`：24 小时总检查/失败次数

## 切换 AI Provider

生产当前推荐配置：

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=<secret>
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

切换前先用隐藏输入读取 Key，并调用 `GET https://api.deepseek.com/models` 验证 Key 和目标模型；不要把真实 Key 直接写进可回溯的命令行。修改前备份 `.env`，修改后依次执行：

```bash
bash scripts/check-config.sh .env
docker compose config --quiet
docker compose up -d --no-deps --force-recreate app
docker compose ps
```

无需重新抓取历史情报。Provider 到期期间失败的 AnalysisTask 可在管理后台先重试一条，确认 provider/model 正确后再批量重试。FeedItem 在采集时已经入库；重试只补齐或修正 Analysis，成功后分类、重要性和可见性可能变化。

社区情感结果带有判断状态、方法、置信度和规则版本。升级后旧记录会按新版本逐步重新判断；AI 未配置、超时或输出异常时显示为“未判断”，不会计入中性话题。社区热度采用各来源内部百分位映射，因此适合比较同一轮采集中的相对热度，不代表平台原始播放量或回复量可以直接横向比较。小黑盒原始热度结合评论、互动/奖励、转发、话题热度、轻量负反馈惩罚和时间衰减计算，不再只按更新时间排序。

分析任务历史会在启动时及每天凌晨自动清理。成功任务默认保留 14 天，已耗尽重试机会的失败任务默认保留 30 天，最近一次清理数量可在管理后台运行状态中查看。

## 常见问题

### 内存不足
```bash
# 检查内存使用
docker stats

# 限制容器内存
# 在 docker-compose.yml 中添加
deploy:
  resources:
    limits:
      memory: 512M
```

### RSSHub 连接失败
```bash
# 检查 RSSHub 容器
docker compose logs rsshub

# 重启 RSSHub
docker compose restart rsshub
```

### 数据库锁定
```bash
# 检查数据库文件
ls -la /app/server/data/

# 如果锁定，重启应用
docker compose restart app
```
