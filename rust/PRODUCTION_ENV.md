# Production Environment Setup Guide

## System Dependencies

The api-server executes bash commands on behalf of the LLM. The following tools must be available on the server's `PATH`:

### Required

```bash
# Core shell (almost always present)
which sh

# Git (used by workspace/test branch preflight)
which git

# Sandbox isolation (Linux only, optional but recommended)
which unshare   # from util-linux package
```

### Language Runtimes (install as needed)

```bash
# Python
apt-get install -y python3 python3-pip python3-venv
# or
yum install -y python3 python3-pip

# Node.js (via nvm or direct install)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 22
# or direct:
apt-get install -y nodejs npm

# Conda (for data science workloads)
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh
bash Miniconda3-latest-Linux-x86_64.sh -b -p /opt/miniconda3
echo 'export PATH="/opt/miniconda3/bin:$PATH"' >> /etc/profile.d/conda.sh
```

### Recommended Utilities

```bash
# File tools used by agent
apt-get install -y ripgrep findutils   # grep_search, glob_search
# or
yum install -y ripgrep findutils
```

## PATH Configuration

The api-server inherits the environment from its startup process. Language runtimes must be on `PATH` at server start time.

**Option 1: System-wide profile** (recommended for Docker/systemd)

```dockerfile
# Dockerfile
ENV PATH="/opt/miniconda3/bin:/usr/local/nodejs/bin:${PATH}"
```

**Option 2: systemd service**

```ini
# /etc/systemd/system/claw-api.service
[Service]
Environment="PATH=/opt/miniconda3/bin:/usr/local/nodejs/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="CLAW_WORKSPACE_ROOT=/data/workspaces"
Environment="DATABASE_PATH=/data/claw_agent.db"
Environment="OPENAI_API_KEY=sk-xxx"
Environment="OPENAI_BASE_URL=https://api.openai.com/v1"
ExecStart=/usr/local/bin/api-server
```

**Option 3: Wrapper script**

```bash
#!/bin/bash
export PATH="/opt/miniconda3/bin:/usr/local/nodejs/bin:$PATH"
export CLAW_WORKSPACE_ROOT="/data/workspaces"
exec /usr/local/bin/api-server "$@"
```

## Workspace Storage

Default workspace root: `./data/workspaces` (relative to CWD of the server process).

Override with:
```bash
export CLAW_WORKSPACE_ROOT=/data/workspaces
```

Directory structure:
```
/data/workspaces/
  <user_id>/
    <session_id>/
      ... (agent working files)
```

Ensure the server process has read/write permissions on this directory.

## Sandbox (Linux)

The sandbox uses `unshare` for namespace isolation. It activates automatically when:
- Running on Linux
- `unshare` is on PATH
- User namespaces are enabled (`sysctl kernel.unprivileged_userns_clone=1`)

In Docker containers, user namespaces may be restricted. The server auto-detects this and falls back to no sandbox. To force-enable:

```bash
# Check if unshare works
unshare --user --map-root-user true && echo "OK" || echo "NOT SUPPORTED"

# Enable user namespaces (host)
sysctl -w kernel.unprivileged_userns_clone=1
```

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `18008` | Server listen port |
| `CLAW_WORKSPACE_ROOT` | `./data/workspaces` | Per-user session workspace root |
| `OPENAI_API_KEY` | (required) | API key for LLM provider |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | LLM provider base URL |
| `OPENAI_MODEL_NAME` | `qwen` | Model name sent to provider |
| `DATABASE_PATH` | `./claw_agent.db` | SQLite database file path |
| `JWT_SECRET` | (random per start) | JWT signing secret |
| `CLAW_SKILLS_ROOT` | auto-detected | Skills directory path (auto-detects `assets/skills/` from CWD) |

## Docker Compose Example

```yaml
version: "3.8"
services:
  api-server:
    build: .
    ports:
      - "18008:18008"
    volumes:
      - workspaces:/data/workspaces
      - db:/data
    environment:
      CLAW_WORKSPACE_ROOT: /data/workspaces
      OPENAI_API_KEY: sk-xxx
      OPENAI_BASE_URL: https://api.openai.com/v1
      OPENAI_MODEL_NAME: qwen
      DATABASE_PATH: /data/claw_agent.db
      PORT: "18008"
    # For sandbox support (Linux only)
    # security_opt:
    #   - seccomp:unconfined
    # cap_add:
    #   - SYS_ADMIN

volumes:
  workspaces:
  db:
```
