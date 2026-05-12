# Claw Code 手工部署指南

本文档适用于当前仓库在 Linux 服务器上的手工部署，目标约束如下：

- 项目路径：`/storage/users/agent/claw-code`
- 后端：Rust `api-server`，由 `systemd` 托管
- 前端：Next.js，由 `systemd` 托管
- 反向代理：Nginx
- 对外域名：`http://claw.ai.accuredit.com`
- 不使用额外的 `.sh` 封装脚本

## 1. 部署拓扑

```text
Browser
  -> http://claw.ai.accuredit.com
  -> nginx :80
     -> /v1/*, /health      -> 127.0.0.1:18008 (api-server)
     -> /                   -> 127.0.0.1:3000  (Next.js)
```

推荐使用同域部署：

- 前端 `NEXT_PUBLIC_API_BASE_URL` 留空，浏览器直接请求同源 `/v1/...`
- Nginx 负责把 API 路由转发到后端
- SSE 路由 `/v1/chat/completions` 单独关闭 `proxy_buffering`

## 2. 前置依赖

服务器需要具备：

- Rust toolchain
- Node.js 20+ 和 npm
- Nginx
- `git`
- `ripgrep`
- `findutils`
- Linux 上如需原生 namespace sandbox，建议安装 `unshare`（通常来自 `util-linux`）

如果后端需要替模型执行 Python/Node/bash 等工具，这些运行时也必须已经安装在服务进程的 `PATH` 中。

## 3. 目录准备

以下目录需要存在，并保证运行服务的用户（下文假设为 `agent`）可读写：

```bash
mkdir -p /storage/users/agent/claw-code/rust/data/workspaces
mkdir -p /storage/users/agent/claw-code/rust/data
```

建议最终目录结构如下：

```text
/storage/users/agent/claw-code/
  frontend/
  rust/
    data/
      claw_agent.db
      workspaces/
```

## 4. 构建后端

```bash
cd /storage/users/agent/claw-code/rust
cargo build --release -p api-server
```

构建产物：

```text
/storage/users/agent/claw-code/rust/target/release/api-server
```

## 5. 构建前端

```bash
cd /storage/users/agent/claw-code/frontend
npm ci
npm run build
```

Next.js 生产启动命令使用 `next start`，不使用开发模式。

## 6. 后端环境文件

创建文件：

```text
/storage/users/agent/claw-code/rust/.env.production
```

示例内容：

```env
PORT=18008
RUST_LOG=info,api_server=debug

OPENAI_BASE_URL=http://10.50.70.91:8000/v1
OPENAI_API_KEY=Empty
OPENAI_MODEL_NAME=qwen

CLAW_WORKSPACE_ROOT=/storage/users/agent/claw-code/rust/data/workspaces
CLAW_SKILLS_ROOT=/storage/users/agent/claw-code/assets/skills
DATABASE_PATH=/storage/users/agent/claw-code/rust/data/claw_agent.db
```

说明：

- `DATABASE_PATH` 是当前代码实际读取的变量名，不是 `DATABASE_URL`
- `CLAW_WORKSPACE_ROOT` 建议使用绝对路径
- `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL_NAME` 按你的模型网关实际值填写

## 7. 前端环境文件

创建文件：

```text
/storage/users/agent/claw-code/frontend/.env.production
```

推荐内容：

```env
NEXT_PUBLIC_API_BASE_URL=
```

说明：

- 留空表示前端直接请求同源 `/v1/...`
- 这是当前最稳的部署方式，因为 Nginx 已经代理 `/v1/` 到后端
- Next.js 环境变量在构建期注入；如果修改了这个文件，需要重新执行 `npm run build`

## 8. systemd：后端服务

创建文件：

```text
/etc/systemd/system/claw-backend.service
```

内容如下：

```ini
[Unit]
Description=Claw Code Backend API Server
After=network.target
Wants=network.target

[Service]
Type=simple
User=agent
Group=agent
WorkingDirectory=/storage/users/agent/claw-code/rust
EnvironmentFile=/storage/users/agent/claw-code/rust/.env.production
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/storage/users/agent/claw-code/rust/target/release/api-server
Restart=always
RestartSec=5
KillMode=process
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

如果你的 Python、Node、Conda 不在系统默认 `PATH` 中，需要把它们补进 `Environment=PATH=...`。

## 9. systemd：前端服务

创建文件：

```text
/etc/systemd/system/claw-frontend.service
```

内容如下：

```ini
[Unit]
Description=Claw Code Frontend (Next.js)
After=network.target claw-backend.service
Wants=network.target

[Service]
Type=simple
User=agent
Group=agent
WorkingDirectory=/storage/users/agent/claw-code/frontend
Environment=NODE_ENV=production
EnvironmentFile=-/storage/users/agent/claw-code/frontend/.env.production
ExecStart=/usr/bin/env node /storage/users/agent/claw-code/frontend/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
Restart=always
RestartSec=5
KillMode=process
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

这里直接执行 Next.js 官方启动入口，不依赖额外 shell 包装。

## 10. 启用并启动 systemd 服务

```bash
sudo systemctl daemon-reload
sudo systemctl enable claw-backend.service
sudo systemctl enable claw-frontend.service
sudo systemctl start claw-backend.service
sudo systemctl start claw-frontend.service
```

检查状态：

```bash
sudo systemctl status claw-backend.service
sudo systemctl status claw-frontend.service
```

查看日志：

```bash
sudo journalctl -u claw-backend.service -f
sudo journalctl -u claw-frontend.service -f
```

## 11. Nginx 反向代理

创建文件：

```text
/etc/nginx/conf.d/claw.ai.accuredit.com.conf
```

内容如下：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream claw_frontend {
    server 127.0.0.1:3000;
}

upstream claw_backend {
    server 127.0.0.1:18008;
}

server {
    listen 80;
    server_name claw.ai.accuredit.com;

    client_max_body_size 50m;

    location /v1/chat/completions {
        proxy_pass http://claw_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location /v1/ {
        proxy_pass http://claw_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location /health {
        proxy_pass http://claw_backend/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://claw_frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

说明：

- `/v1/chat/completions` 是 SSE 流式接口，必须关闭 `proxy_buffering`
- `client_max_body_size 50m` 与后端上传限制保持一致
- 如果后续启用 HTTPS，再在这个 server 基础上补 `listen 443 ssl` 和证书配置

检查并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 12. 发布后的验证

先验证本机端口：

```bash
curl http://127.0.0.1:18008/health
curl -I http://127.0.0.1:3000
```

再验证域名：

```bash
curl -I http://claw.ai.accuredit.com
curl http://claw.ai.accuredit.com/health
```

浏览器检查项：

- 打开 `http://claw.ai.accuredit.com`
- 能正常登录
- 能发起单轮对话
- 能持续收到 SSE 输出
- 能上传文件到 workspace
- 能下载 workspace 文件

## 13. 更新流程

后端更新：

```bash
cd /storage/users/agent/claw-code/rust
git pull
cargo build --release -p api-server
sudo systemctl restart claw-backend.service
```

前端更新：

```bash
cd /storage/users/agent/claw-code/frontend
git pull
npm ci
npm run build
sudo systemctl restart claw-frontend.service
```

如果修改了前端环境变量，也需要重新构建前端再重启。

## 14. 常见问题

### 14.1 前端页面能打开，但接口全部 404/502

优先检查：

- Nginx `/v1/` 路由是否转发到 `127.0.0.1:18008`
- `claw-backend.service` 是否启动成功
- 前端是否把 `NEXT_PUBLIC_API_BASE_URL` 配成了错误的外部地址

### 14.2 SSE 一直 pending 或长时间后断流

优先检查：

- `/v1/chat/completions` 是否单独配置了 `proxy_buffering off`
- Nginx 的 `proxy_read_timeout` 是否太短
- 后端日志里是否已有 `runtime_error`

### 14.3 文件上传成功，但工具里读不到

优先检查：

- `CLAW_WORKSPACE_ROOT` 是否为绝对路径
- `agent` 用户是否对 `rust/data/workspaces` 有读写权限
- 当前请求是否落在同一个 session 下

### 14.4 后端可以启动，但模型调用失败

优先检查：

- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL_NAME`

以及目标模型网关是否支持当前模型名。

## 15. 当前已知限制

- 当前 `JWT_SECRET` 仍然写死在后端源码中：`rust/crates/api-server/src/auth.rs`
- 如果后续要做多实例部署、密钥轮换或更严格的安全基线，建议先把 JWT secret 外置为环境变量

