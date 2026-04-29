import logging
logging.basicConfig(level=logging.DEBUG)
import sys, asyncio
sys.path.append('d:/workspace/agent-web/apps/api')
from app.runner.runtime.sandbox_claude import OpenSandboxClaudeRuntime

async def main():
    rt = OpenSandboxClaudeRuntime('http://10.50.70.91:28080', 'ad9d2a2cf1f26431415c79bd9b84582a769b86ace04c8300be6a23291a74b48a', 'agent/claude-agent-sdk-runtime:2026-04-21')
    await rt.init_runtime()
    print('Success!')

asyncio.run(main())
