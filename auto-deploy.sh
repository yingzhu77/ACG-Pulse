#!/bin/bash
# ACG Pulse 一键自动部署脚本
# 用法: bash auto-deploy.sh
#
# 部署前必须设置环境变量:
#   export ADMIN_PASSWORD=your_secure_password
#   export MIMO_API_KEY=your_mimo_key
#   export ADMIN_JWT_SECRET=your_random_secret_at_least_32_chars

set -e

echo "=========================================="
echo "  ACG Pulse 一键自动部署"
echo "=========================================="

# 校验必需环境变量
for var in ADMIN_PASSWORD MIMO_API_KEY ADMIN_JWT_SECRET; do
  if [ -z "${!var}" ]; then
    echo "❌ 缺少环境变量: $var"
    echo "   请先运行: export $var=your_value"
    exit 1
  fi
done

# 1-2. 快进更新或首次克隆，保留现有数据卷与工作目录
echo "[1/7] 获取代码..."
if [ -d /opt/personal-hot-monitor/.git ]; then
  cd /opt/personal-hot-monitor
  sudo -u admin git pull --ff-only origin master
else
  cd /opt
  sudo git clone https://github.com/yingzhu77/ACG-Pulse.git personal-hot-monitor
  sudo chown -R admin:admin /opt/personal-hot-monitor
  cd personal-hot-monitor
fi

# 3. 创建 .env
echo "[3/7] 配置环境变量..."
sudo tee .env > /dev/null << EOF
AI_PROVIDER=mimo
MIMO_API_KEY=${MIMO_API_KEY}
MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
MIMO_MODEL=mimo-v2.5
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET}
MAX_FEED_ITEMS=2000
DATABASE_URL=file:/app/server/data/prod.db
PORT=3001
CLIENT_URL=https://acg.yingzhu.xyz
TRUST_PROXY_HOPS=1
RSSHUB_BASE_URLS=http://rsshub:1200
RSS_FETCH_TIMEOUT_MS=30000
SOURCE_CHECK_TIMEOUT_MS=35000
SOURCE_CHECK_CONCURRENCY=5
BILIBILI_DIRECT_API_FALLBACK=true
BILIBILI_DIRECT_API_TIMEOUT_MS=30000
BILIBILI_REQUEST_INTERVAL_MS=10000
EOF
sudo chmod 600 .env

# 4. Docker 构建
echo "[4/7] Docker 构建（约 3-5 分钟）..."
sudo bash scripts/check-config.sh .env
sudo docker compose build
sudo bash scripts/pre-deploy-backup.sh
sudo docker compose up -d

# 5. 等待启动
echo "[5/7] 等待服务启动..."
sleep 20

# 6. 验证服务
echo "[6/7] 验证服务..."
if curl -s http://localhost:3001/api/health | grep -q "ok"; then
  echo "  ✅ 服务启动成功"
else
  echo "  ⚠️ 服务启动中，请稍后验证"
  sudo docker compose logs app --tail 20
  exit 1
fi

# 7. 预置数据源并采集
echo "[7/7] 预置数据源并采集..."
TOKEN=$(curl -s -X POST http://localhost:3001/api/admin/login -H "Content-Type: application/json" -d "{\"password\":\"${ADMIN_PASSWORD}\"}" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
curl -s -X POST http://localhost:3001/api/admin/sources/seed-defaults -H "Authorization: Bearer $TOKEN" > /dev/null
curl -s -X POST http://localhost:3001/api/admin/check -H "Authorization: Bearer $TOKEN" > /dev/null

echo ""
echo "=========================================="
echo "  ✅ 部署完成！"
echo "=========================================="
echo "  访问: http://$(curl -s ifconfig.me):3001"
echo "  管理密码: (已从环境变量配置，未显示)"
echo "=========================================="
echo ""
echo "  下一步："
echo "  1. 访问前端页面"
echo "  2. 登录管理后台"
echo "  3. 在 'B站 Cookie 配置' 中填入 Cookie"
echo "  4. 点击 '保存 Cookie' 后重启服务"
echo ""
