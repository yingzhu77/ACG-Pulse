# ACG Pulse 部署踩坑记录

## 服务器环境

- **配置**: 阿里云 2核/2GB/Ubuntu 24.04
- **区域**: 新加坡
- **IP**: 8.219.121.132
- **域名**: acg.yingzhu.xyz
- **在线体验**: https://acg.yingzhu.xyz

---

## 踩过的坑

### 1. 1GB 内存 Docker 构建失败

**问题**: Docker build 在 `npm ci` 步骤卡住，最终 OOM
**原因**: 1GB 内存不够同时运行 Node.js + npm + Docker
**解决**: 升级到 2GB 内存

### 2. SSH 密钥变更

**问题**: 重置服务器后 `scp` 报 `REMOTE HOST IDENTIFICATION HAS CHANGED`
**原因**: 服务器重置后 SSH 密钥重新生成
**解决**:
```bash
ssh-keygen -R 8.219.121.132
```

### 3. 文件权限问题

**问题**: `npm install` 后 `prisma generate` 报 `EACCES: permission denied`
**原因**: `sudo npm install` 安装的依赖属于 root，当前用户无权限
**解决**:
```bash
sudo chown -R admin:admin /opt/acg-pulse/server/node_modules
```

### 4. 目录权限问题

**问题**: `prisma db push` 报 `Permission denied` 无法创建数据库目录
**原因**: 上传的文件所有者是 Windows 用户（197609）
**解决**:
```bash
sudo chown -R admin:admin /opt/acg-pulse
```

### 5. .env 文件路径问题

**问题**: `prisma db push` 报 `Environment variable not found: DATABASE_URL`
**原因**: `.env` 在 `/opt/acg-pulse/` 但 prisma 在 `/opt/acg-pulse/server/`
**解决**:
```bash
cp /opt/acg-pulse/.env /opt/acg-pulse/server/.env
```

### 6. Express 5 通配符语法

**问题**: `app.get('*', ...)` 报 `Missing parameter name at index 1`
**原因**: Express 5 不支持 `*` 通配符，改用 middleware
**解决**:
```typescript
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  } else {
    next();
  }
});
```

### 7. Dockerfile 预编译兼容

**问题**: 上传预编译包后 Docker build 报 `COPY client/ ./client/: not found`
**原因**: Dockerfile 需要源码构建，但预编译包没有 client/ 源码
**解决**: 两种方案
- 方案 A: 克隆仓库从源码构建（推荐）
- 方案 B: 修改 Dockerfile 适配预编译

### 8. 前端静态文件路径

**问题**: 页面显示 `{"error":"Not found"}`
**原因**: 服务器没有配置前端静态文件托管
**解决**: 在 `index.ts` 中添加:
```typescript
const clientDistPath = path.resolve(process.cwd(), '../client/dist');
app.use(express.static(clientDistPath));
```

### 9. Bilibili 源失效

**问题**: 所有 B站源报 `RSSHub route failed: Request failed with status code 403`
**原因**: 匿名 RSSHub 请求被 B站限流
**解决**:
- 方案 A: 启用直连 API `BILIBILI_DIRECT_API_FALLBACK=true`
- 方案 B: 配置 B站 Cookies
- 方案 C: 部署自建 RSSHub

### 10. Mimo API 限流

**问题**: 批量分析时报 `429 Too Many Requests`
**原因**: Mimo API 有请求频率限制
**解决**: 逐条处理 + 3 秒延迟

---

## 正确部署流程

### 方式一：Docker 从源码构建（推荐）

```bash
# 1. 克隆仓库
cd /opt
sudo git clone https://github.com/yingzhu77/ACG-Pulse.git personal-hot-monitor
cd personal-hot-monitor

# 2. 创建 .env
sudo tee .env << 'EOF'
AI_PROVIDER=mimo
MIMO_API_KEY=你的key
MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
MIMO_MODEL=mimo-v2.5
ADMIN_PASSWORD=你的密码
ADMIN_JWT_SECRET=随机字符串
MAX_FEED_ITEMS=2000
DATABASE_URL=file:/app/server/data/prod.db
PORT=3001
CLIENT_URL=http://localhost:3001
RSSHUB_BASE_URLS=http://rsshub:1200
RSS_FETCH_TIMEOUT_MS=30000
SOURCE_CHECK_TIMEOUT_MS=35000
SOURCE_CHECK_CONCURRENCY=5
BILIBILI_DIRECT_API_FALLBACK=true
BILIBILI_DIRECT_API_TIMEOUT_MS=30000
BILIBILI_REQUEST_INTERVAL_MS=6000
BILIBILI_COOKIE="buvid4=你的值; buvid3=你的值; SESSDATA=你的值; bili_jct=你的值"
HEALTH_LOG_RETENTION_DAYS=30
EOF

# 3. 启动服务
sudo docker compose up -d --build

# 4. 验证
sleep 15
curl http://localhost:3001/api/health
```

### 方式二：预编译包部署

```bash
# 上传 acg-pulse-full.tar.gz 后
cd /opt
sudo tar -xzf acg-pulse-full.tar.gz
sudo mv deploy-package acg-pulse
sudo chown -R admin:admin /opt/acg-pulse
cd /opt/acg-pulse
sudo docker compose up -d --build
```

---

## 环境变量加载路径

| 场景 | .env 位置 | 加载方式 |
|------|-----------|----------|
| 本地开发（后端） | `server/.env` | `dotenv.config()` 在 `server/src/index.ts` 中加载 |
| Docker 部署 | 项目根目录 `.env` | `docker-compose.yml` 的 `${VAR}` 语法读取，传入容器环境变量 |

修改 `ADMIN_PASSWORD` 或 `ADMIN_JWT_SECRET` 后：
- **Docker**：`sudo docker compose up -d --force-recreate app`
- **本地开发**：重启后端进程（`npm run dev` 会自动重载）

### 生产 CORS 仍指向 localhost

**现象**：`curl -sSI https://acg.yingzhu.xyz/api/health` 返回 `Access-Control-Allow-Origin: http://localhost:3001`。

**原因**：服务器根目录 `.env` 中仍保留旧的 `CLIENT_URL`，Docker Compose 会优先使用该值，而不是 compose 文件中的生产默认值。

**修复**：

```bash
cd /opt/personal-hot-monitor
sed -i 's#^CLIENT_URL=.*#CLIENT_URL=https://acg.yingzhu.xyz#' .env
grep -q '^TRUST_PROXY_HOPS=' .env \
  && sed -i 's#^TRUST_PROXY_HOPS=.*#TRUST_PROXY_HOPS=1#' .env \
  || printf 'TRUST_PROXY_HOPS=1\n' >> .env
bash scripts/check-config.sh .env
docker compose up -d --force-recreate app
```

不要通过删除 `.env` 解决；其中还保存管理员密码、Cookie 和 AI Key。

## 配置预检

部署前运行配置检查脚本，避免 `docker compose config` 因缺少变量报错：

```bash
bash scripts/check-config.sh        # 检查根目录 .env
bash scripts/check-config.sh server/.env  # 检查本地开发 .env
```

脚本检查项：
- `ADMIN_PASSWORD` 是否已设置且不是默认值
- `ADMIN_JWT_SECRET` 是否已设置、长度 >= 32 字符
- AI Provider key 是否已配置

## 常用运维命令

```bash
# 查看日志
sudo docker compose logs -f app

# 重启服务
sudo docker compose restart

# 停止服务
sudo docker compose down

# 重新构建
sudo docker compose up -d --build

# 预置数据源
TOKEN=$(curl -s -X POST http://localhost:3001/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"password":"你的密码"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
curl -X POST http://localhost:3001/api/admin/sources/seed-defaults \
  -H "Authorization: Bearer $TOKEN"

# 触发采集
curl -X POST http://localhost:3001/api/admin/check \
  -H "Authorization: Bearer $TOKEN"

# 保存 B站 Cookie（重启后生效）
bash save-cookie.sh
```

### 忘记管理员密码

管理员密码来自环境变量 `ADMIN_PASSWORD`，JWT 签名来自 `ADMIN_JWT_SECRET`。

**推荐方式**：使用重置脚本（自动备份、不打印敏感值）：

```bash
cd /opt/personal-hot-monitor
bash scripts/reset-admin-password.sh
# 按提示输入新密码，脚本会自动生成新的 JWT_SECRET 并备份旧 .env
sudo docker compose up -d --force-recreate app
```

**手动方式**：

```bash
cd /opt/personal-hot-monitor

# 先备份，避免误改其他密钥
cp .env ".env.bak.$(date +%Y%m%d%H%M%S)"

# 编辑 ADMIN_PASSWORD；建议同时轮换 ADMIN_JWT_SECRET，让旧 token 全部失效
nano .env
# ADMIN_PASSWORD=新的强密码
# ADMIN_JWT_SECRET=用 openssl rand -hex 32 生成的新随机值

# 重新创建 app 容器，让新的环境变量生效
sudo docker compose up -d --force-recreate app

# 验证健康状态和登录
curl http://localhost:3001/api/health
curl -s -X POST http://localhost:3001/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"password":"新的强密码"}'
```

本地开发如果设置面板打开后提示登录过期，先清理浏览器里旧的 `game_pulse_admin_token`，再用当前 `.env` 里的 `ADMIN_PASSWORD` 登录。修改本地密码后需要重启后端进程。

---

### 11. RSSHub B站路由 503（Playwright/Chromium 缺失）

**问题**: RSSHub 的 `/bilibili/user/video/*` 路由返回 503，日志报 `Executable doesn't exist at .../chrome-headless-shell`
**原因**: RSSHub `latest` 版的 B站用户视频路由依赖 Playwright（无头浏览器），但标准 Docker 镜像未预装 Chromium
**解决**: 项目已提供自定义 `rsshub/Dockerfile`，自动安装 Chromium。`docker-compose.yml` 已配置为从该 Dockerfile 构建
**验证**:
```bash
docker exec game-pulse wget -q -O- --timeout=15 http://rsshub:1200/bilibili/user/video/1340190821 | head -c 200
```
应返回 RSS XML 而非 503

---

## 已知限制

### 1. B站 Cookie 需要重启服务

**现象**: 前端保存 Cookie 后显示"重启服务后生效"
**原因**: B站适配器在服务启动时读取 Cookie，运行时不会自动刷新
**解决**: 保存 Cookie 后执行 `sudo docker compose down && sudo docker compose up -d`

### 2. Cookie 有效期

**现象**: B站源突然全部失败
**原因**: B站 Cookie 有效期约 6 个月
**解决**: 重新获取 Cookie 并更新

### 3. 内存限制

**现象**: 服务卡顿或 OOM
**原因**: 1GB 内存不够同时运行 Node.js + Docker + RSSHub
**解决**: 升级到 2GB 内存

### 4. 定时任务重叠执行

**现象**: 日志显示 "Check already running for Xs, skipping"
**原因**: 上一次采集尚未完成，下一次定时触发被跳过
**解决**: 正常行为。互斥锁确保不会重复采集。如果长期卡住，检查是否有慢源超时。

### 5. 源持续失败

**现象**: 某个源 healthStatus 显示 failed
**排查**:
```bash
# 查看源健康历史
curl http://localhost:3001/api/public/source-health-history

# 查看最近日志
docker compose logs app --tail 50 | grep "source failed"
```
**常见原因**:
- B站 Cookie 过期 → 重新获取
- RSSHub 不可用 → 检查 rsshub 容器
- 网络超时 → 增加 SOURCE_CHECK_TIMEOUT_MS

### 6. 数据库损坏恢复

**现象**: 服务启动失败，日志显示 database disk image is malformed
**恢复**:
```bash
# 1. 停止服务
docker compose stop app

# 2. 尝试修复
docker exec game-pulse sqlite3 /app/server/data/prod.db ".recover" > /tmp/recovered.db
docker cp /tmp/recovered.db game-pulse:/app/server/data/prod.db

# 3. 重启
docker compose start app

# 4. 如修复失败，从备份恢复
bash scripts/restore-db.sh ./backups/prod_最新备份.db
```
