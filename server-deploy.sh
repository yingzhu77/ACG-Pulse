#!/bin/bash
set -e

# ============================================
# ACG Pulse 服务器一键部署脚本
# 直接复制粘贴到服务器执行
# ============================================

APP_DIR="/opt/personal-hot-monitor"
APP_PORT=3001

echo "=========================================="
echo "  ACG Pulse 一键部署"
echo "=========================================="

# 1. 安装 Docker
echo ""
echo "[1/5] 检查 Docker..."
if command -v docker &>/dev/null; then
    echo "  ✅ Docker 已安装"
else
    echo "  📦 安装 Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "  ✅ Docker 安装完成"
fi

# 2. 安装 Docker Compose
echo ""
echo "[2/5] 检查 Docker Compose..."
if docker compose version &>/dev/null; then
    echo "  ✅ Docker Compose 已安装"
else
    apt update && apt install docker-compose-plugin -y
    echo "  ✅ Docker Compose 安装完成"
fi

# 3. 配置防火墙
echo ""
echo "[3/5] 配置防火墙..."
if command -v ufw &>/dev/null; then
    ufw allow 22/tcp 2>/dev/null || true
    ufw delete allow ${APP_PORT}/tcp 2>/dev/null || true
    ufw delete allow 1200/tcp 2>/dev/null || true
    echo "  ✅ 防火墙规则已添加"
else
    echo "  ⚠️  ufw 未安装，跳过"
fi

# 4. 克隆/更新代码
echo ""
echo "[4/5] 获取代码..."
if [ -d "${APP_DIR}" ]; then
    cd ${APP_DIR}
    git pull --ff-only origin master
    echo "  ✅ 代码已更新"
else
    cd /opt
    git clone https://github.com/yingzhu77/ACG-Pulse.git personal-hot-monitor
    cd personal-hot-monitor
    echo "  ✅ 仓库已克隆"
fi

# 5. 配置环境变量
echo ""
echo "[5/5] 配置环境变量..."
if [ ! -f .env ]; then
    cat > .env << 'ENVEOF'
# === ACG Pulse 环境配置 ===

# AI Provider (mimo / openrouter / deepseek)
AI_PROVIDER=mimo
MIMO_API_KEY=你的mimo-api-key
MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
MIMO_MODEL=mimo-v2.5

# 管理员（必须修改！）
ADMIN_PASSWORD=你的管理员密码
ADMIN_JWT_SECRET=随机生成一个长字符串

# 情报上限
MAX_FEED_ITEMS=2000

# RSSHub（Docker内部通信）
RSSHUB_BASE_URLS=http://rsshub:1200
RSS_FETCH_TIMEOUT_MS=30000
SOURCE_CHECK_TIMEOUT_MS=35000
SOURCE_CHECK_CONCURRENCY=5
CLIENT_URL=https://acg.yingzhu.xyz
TRUST_PROXY_HOPS=1

# Bilibili
BILIBILI_DIRECT_API_FALLBACK=true
BILIBILI_DIRECT_API_TIMEOUT_MS=30000
BILIBILI_REQUEST_INTERVAL_MS=6000
ENVEOF
    echo ""
    echo "  ⚠️  请编辑 .env 文件配置："
    echo "    nano ${APP_DIR}/.env"
    echo ""
    echo "  必填项："
    echo "    MIMO_API_KEY=你的key"
    echo "    ADMIN_PASSWORD=你的密码"
    echo "    ADMIN_JWT_SECRET=随机字符串"
    echo ""
    read -r -p "  配置完成后按回车继续..."
fi

# 6. 构建并启动
echo ""
echo "=========================================="
echo "  构建并启动服务"
echo "=========================================="
bash scripts/check-config.sh .env
docker compose build
bash scripts/pre-deploy-backup.sh
docker compose up -d

# 7. 等待启动并验证
echo ""
echo "等待服务启动..."
sleep 8

if curl -s http://localhost:${APP_PORT}/api/public/stats | grep -q '"total"'; then
    echo ""
    echo "=========================================="
    echo "  ✅ 部署成功！"
    echo "=========================================="
    echo ""
    echo "  访问地址: http://$(hostname -I | awk '{print $1}'):${APP_PORT}"
    echo "  API 测试: curl http://localhost:${APP_PORT}/api/public/stats"
    echo ""
    echo "  管理后台："
    echo "    1. 打开前端页面"
    echo "    2. 点击管理按钮登录"
    echo ""
    echo "  常用命令："
    echo "    docker compose logs -f app    # 查看日志"
    echo "    docker compose restart app    # 重启服务"
    echo "    docker compose down           # 停止服务"
    echo ""
else
    echo ""
    echo "=========================================="
    echo "  ⚠️  服务启动中，请稍后验证"
    echo "=========================================="
    echo ""
    echo "  检查日志: docker compose logs -f app"
    echo "  手动验证: curl http://localhost:${APP_PORT}/api/public/stats"
    echo ""
fi
