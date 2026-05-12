#!/usr/bin/env bash
# Claw Agent Production Deployment
#
# 路径说明：
#   后端代码目录: /storage/users/agent/claw-code
#   前端构建输出: /home/art/workspace/ui/
#   Nginx配置:   /etc/nginx/conf.d/claw.conf
#   域名:        claw.ai.accuredit.com

set -euo pipefail

# ──────────────── 配置区 ────────────────
DEPLOY_DIR="/storage/users/agent/claw-code"
FRONTEND_OUTPUT="/home/art/workspace/ui"
BACKEND_PORT=18008
FRONTEND_PORT=3000
DOMAIN="claw.ai.accuredit.com"

echo "============================================"
echo "  Claw Agent 部署"
echo "  后端目录: ${DEPLOY_DIR}"
echo "  前端输出: ${FRONTEND_OUTPUT}"
echo "  域名:     ${DOMAIN}"
echo "============================================"
echo ""

# ──────────────── Step 0: 准备目录 ────────────────
echo "[0/6] 准备目录结构..."
mkdir -p "${DEPLOY_DIR}/rust/data/workspaces"
mkdir -p "${DEPLOY_DIR}/logs"
mkdir -p "${FRONTEND_OUTPUT}"

# 备份数据库（如果存在）
DB_FILE="${DEPLOY_DIR}/rust/claw_agent.db"
if [ -f "$DB_FILE" ]; then
    cp "$DB_FILE" "${DB_FILE}.bak.$(date +%Y%m%d%H%M%S)"
    echo "  -> 已备份数据库"
fi

# ──────────────── Step 1: 编译 Rust 后端 ────────────────
echo "[1/6] 编译 Rust 后端..."
cd "${DEPLOY_DIR}/rust"
cargo build --release -p api-server 2>&1
echo "  -> 后端二进制: ${DEPLOY_DIR}/rust/target/release/api-server"

# ──────────────── Step 2: 构建 Next.js 前端 ────────────────
echo "[2/6] 构建 Next.js 前端..."
cd "${DEPLOY_DIR}/frontend"
npm ci --production=false 2>&1
npm run build 2>&1

# 复制构建产物到前端输出目录
echo "  -> 复制构建产物到 ${FRONTEND_OUTPUT}..."
rm -rf "${FRONTEND_OUTPUT:?}"/*
cp -r .next/static "${FRONTEND_OUTPUT}/static"
cp -r .next/server  "${FRONTEND_OUTPUT}/server"
cp -r public        "${FRONTEND_OUTPUT}/public" 2>/dev/null || true
cp package.json     "${FRONTEND_OUTPUT}/package.json"
cp next.config.*    "${FRONTEND_OUTPUT}/" 2>/dev/null || true
echo "  -> 前端构建完成"

# ──────────────── Step 3: 后端环境变量 ────────────────
echo "[3/6] 检查后端 .env..."
ENV_FILE="${DEPLOY_DIR}/rust/.env"
if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" << 'ENVEOF'
PORT=18008

OPENAI_BASE_URL=http://10.50.70.91:8000/v1
OPENAI_API_KEY=Empty
OPENAI_MODEL_NAME=qwen

CLAW_WORKSPACE_ROOT=./data/workspaces
ENVEOF
    echo "  -> 已创建 ${ENV_FILE}"
else
    echo "  -> ${ENV_FILE} 已存在，跳过"
fi

# ──────────────── Step 4: Systemd 服务 ────────────────
echo "[4/6] 写入 systemd 服务配置..."

# 后端服务
sudo tee /etc/systemd/system/claw-backend.service > /dev/null << SERVICEEOF
[Unit]
Description=Claw Agent Backend (api-server)
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${DEPLOY_DIR}/rust
ExecStart=${DEPLOY_DIR}/rust/target/release/api-server
Restart=on-failure
RestartSec=5
Environment=RUST_LOG=info,api_server=debug

[Install]
WantedBy=multi-user.target
SERVICEEOF

# 前端服务（Next.js SSR）
sudo tee /etc/systemd/system/claw-frontend.service > /dev/null << SERVICEEOF
[Unit]
Description=Claw Agent Frontend (Next.js)
After=network.target claw-backend.service

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${FRONTEND_OUTPUT}
ExecStart=$(which node) ${DEPLOY_DIR}/frontend/node_modules/.bin/next start -p ${FRONTEND_PORT}
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=API_INTERNAL_BASE_URL=http://127.0.0.1:${BACKEND_PORT}

[Install]
WantedBy=multi-user.target
SERVICEEOF

echo "  -> /etc/systemd/system/claw-backend.service"
echo "  -> /etc/systemd/system/claw-frontend.service"

# ──────────────── Step 5: Nginx 配置 ────────────────
echo "[5/6] 写入 Nginx 配置..."

sudo tee /etc/nginx/conf.d/claw.conf > /dev/null << 'NGINXEOF'
# Claw Agent - claw.ai.accuredit.com
# SSE 支持: 禁用代理缓冲以实现实时流式传输

upstream claw_backend {
    server 127.0.0.1:18008;
}

upstream claw_frontend {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name claw.ai.accuredit.com;

    # SSL 配置（获取证书后取消注释）:
    # listen 443 ssl;
    # ssl_certificate     /etc/nginx/ssl/claw.ai.accuredit.com.crt;
    # ssl_certificate_key /etc/nginx/ssl/claw.ai.accuredit.com.key;
    # return 301 https://$host$request_uri;

    client_max_body_size 50M;

    # API: SSE 流式接口 -> Rust 后端
    location /v1/chat/completions {
        proxy_pass http://claw_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE: 禁用缓冲
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        chunked_transfer_encoding on;
    }

    # API: 其他接口 -> Rust 后端
    location /v1/ {
        proxy_pass http://claw_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    # 健康检查
    location /health {
        proxy_pass http://claw_backend;
    }

    # 前端静态资源（直接从构建目录读取）
    location /_next/static/ {
        alias /home/art/workspace/ui/static/;
        expires 365d;
        access_log off;
        add_header Cache-Control "public, immutable";
    }

    # 其他请求 -> Next.js SSR
    location / {
        proxy_pass http://claw_frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINXEOF

echo "  -> /etc/nginx/conf.d/claw.conf"

# ──────────────── Step 6: 完成 ────────────────
echo "[6/6] 部署脚本执行完成"
echo ""
echo "============================================"
echo "  后续操作:"
echo "============================================"
echo ""
echo "  1. 编辑后端环境变量:"
echo "     vim ${DEPLOY_DIR}/rust/.env"
echo ""
echo "  2. 重载 systemd 并启动服务:"
echo "     sudo systemctl daemon-reload"
echo "     sudo systemctl enable claw-backend claw-frontend"
echo "     sudo systemctl restart claw-backend"
echo "     sudo systemctl restart claw-frontend"
echo ""
echo "  3. 测试并重载 Nginx:"
echo "     sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "  4. 初始化用户（可重复执行，已存在会跳过）:"
echo "     bash ${DEPLOY_DIR}/scripts/init_users.sh http://127.0.0.1:${BACKEND_PORT}"
echo ""
echo "  5. 验证:"
echo "     curl http://127.0.0.1:${BACKEND_PORT}/health"
echo "     curl -I http://${DOMAIN}"
echo ""
