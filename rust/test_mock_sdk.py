import asyncio
from opensandbox import Sandbox
from opensandbox.config import ConnectionConfig
from opensandbox.models.execd import RunCommandOpts

async def main():
    config = ConnectionConfig(domain="127.0.0.1:8081", protocol="http", use_server_proxy=True)
    sb = await Sandbox.create("agent/claude-agent-sdk-runtime:2026-04-21", connection_config=config, skip_health_check=True)
    await sb.commands.run("echo ok", opts=RunCommandOpts(working_directory="/workspace"))

asyncio.run(main())
