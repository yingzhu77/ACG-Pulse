#!/bin/bash
set -e

# ============================================
# ACG Pulse 服务器初始化脚本
# 在服务器上首次运行，完成环境配置
# 用法: bash setup-server.sh
# ============================================

echo "=========================================="
echo "  ACG Pulse 服务器初始化"
echo "=========================================="

# 1. 安装 Docker
echo ""
echo "[1/4] 安装 Docker..."
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
echo "[2/4] 安装 Docker Compose..."
if docker compose version &>/dev/null; then
    echo "  ✅ Docker Compose 已安装"
else
    apt install docker-compose-plugin -y
    echo "  ✅ Docker Compose 安装完成"
fi

# 3. 配置防火墙
echo ""
echo "[3/4] 配置防火墙..."
if command -v ufw &>/dev/null; then
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw delete allow 3001/tcp 2>/dev/null || true
    ufw delete allow 1200/tcp 2>/dev/null || true
    ufw enable
    echo "  ✅ 防火墙配置完成"
else
    echo "  ⚠️  ufw 未安装，跳过"
fi

# 4. 克隆仓库并配置
echo ""
echo "[4/4] 克隆仓库..."
if [ -d "/opt/personal-hot-monitor" ]; then
    cd /opt/personal-hot-monitor
    git pull --ff-only origin master
else
    cd /opt
    git clone https://github.com/yingzhu77/ACG-Pulse.git personal-hot-monitor
    cd personal-hot-monitor
fi

# 配置 .env
if [ ! -f .env ]; then
    cp .env.production.example .env
    echo ""
    echo "  ⚠️  请编辑 .env 文件配置环境变量："
    echo "    nano /opt/personal-hot-monitor/.env"
    echo ""
    echo "  必填项："
    echo "    AI_PROVIDER=mimo"
    echo "    MIMO_API_KEY=你的key"
    echo "    ADMIN_PASSWORD=你的密码"
    echo "    ADMIN_JWT_SECRET=随机字符串"
    echo ""
else
    echo "  ✅ .env 已存在"
fi

echo ""
echo "=========================================="
echo "  初始化完成！"
echo "=========================================="
echo ""
echo "  下一步："
echo "    1. 编辑 .env 配置环境变量"
echo "    2. 运行 docker compose up -d --build"
echo "    3. 通过 Caddy 访问 https://acg.yingzhu.xyz"
echo ""
