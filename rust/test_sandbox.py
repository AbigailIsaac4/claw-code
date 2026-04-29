import requests
import json

base_url = "http://10.50.70.91:28080/v1"
headers = {"OPEN-SANDBOX-API-KEY": "ad9d2a2cf1f26431415c79bd9b84582a769b86ace04c8300be6a23291a74b48a"}

# 1. Create sandbox
print("Creating sandbox...")
res = requests.post(
    f"{base_url}/sandboxes",
    headers=headers,
    json={
        "image": {"uri": "agent/claude-agent-sdk-runtime:2026-04-21"},
        "resourceLimits": {"cpu": "1", "memory": "2Gi"},
        "entrypoint": ["tail", "-f", "/dev/null"],
        "timeout": 3600
    }
)
print("Create status:", res.status_code)
print("Create text:", res.text)

if not res.ok:
    if res.status_code != 202:
        exit(1)

data = res.json()
sandbox_id = data.get("id") or data.get("sandboxId") or data.get("sandbox_id")
print("Sandbox ID:", sandbox_id)

# 2. Get Execd Endpoint
print("Getting execd endpoint...")
res = requests.get(
    f"{base_url}/sandboxes/{sandbox_id}/endpoints/8080?use_server_proxy=true",
    headers=headers
)
print("Endpoint status:", res.status_code)
print("Endpoint text:", res.text)
if not res.ok:
    exit(1)

execd_url = res.json().get("endpoint") or res.json().get("url")
if not execd_url.startswith("http"):
    execd_url = f"http://{execd_url}"
print("Execd URL:", execd_url)

import time
print("Waiting for execd to start...")
for i in range(30):
    try:
        h = requests.get(f"{execd_url.rstrip('/')}/ping", headers=headers)
        if h.ok:
            print("Execd is ready!")
            break
        else:
            print(f"Health check failed: {h.status_code} {h.text}")
    except:
        pass
    time.sleep(1)
else:
    print("Execd did not become ready")
    st = requests.get(f"{base_url}/sandboxes/{sandbox_id}", headers=headers)
    print("Sandbox status:", st.text)
    exit(1)

# 3. Run command
print("Running command...")
cmd_url = f"{execd_url.rstrip('/')}/command"
res = requests.post(
    cmd_url,
    headers=headers,
    json={"command": "echo ok", "cwd": "/workspace", "timeout": 60000},
    stream=True
)
print("Command status:", res.status_code)
for line in res.iter_lines():
    if line:
        print("SSE Line:", line.decode("utf-8"))

# 4. Clean up
print("Killing sandbox...")
requests.delete(f"{base_url}/sandboxes/{sandbox_id}", headers=headers)
