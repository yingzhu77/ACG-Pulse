# ACG Pulse 部署指南

## 服务器信息

- **IP**: 8.219.121.132
- **系统**: Ubuntu 24.04
- **配置**: 2核 CPU / 1GB 内存 / 30GB 磁盘
- **区域**: 新加坡

## 部署步骤

### 1. SSH 连接服务器

```bash
ssh root@8.219.121.132
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
ufw allow 3001/tcp  # ACG Pulse
ufw allow 1200/tcp  # RSSHub（可选）
ufw allow 22/tcp    # SSH
ufw enable
```

### 4. 上传代码

```bash
cd /opt
git clone https://github.com/yingzhu77/personal-hot-monitor.git
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
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=你的key
MAX_FEED_ITEMS=2000
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

```bash
cd /opt/personal-hot-monitor
git pull origin master
docker compose up -d --build
```

## 数据备份

```bash
# 备份数据库
docker exec game-pulse cp /app/server/data/prod.db /app/server/data/prod.db.bak

# 导出到本地
docker cp game-pulse:/app/server/data/prod.db ./backup/
```

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
