import asyncio
from app.runner.runtime.sandbox_claude import OpenSandboxClaudeRuntime
from app.runner.runtime.base import RuntimeRequest
from pathlib import Path

async def main():
    runtime = OpenSandboxClaudeRuntime(
        api_url="http://10.50.70.91:28080",
        sandbox_api_key="ad9d2a2cf1f26431415c79bd9b84582a769b86ace04c8300be6a23291a74b48a",
        sandbox_template="agent/claude-agent-sdk-runtime:2026-04-21"
    )
    
    def on_event(event_type, msg, level):
        print(f"[{level}] {event_type}: {msg}")

    req = RuntimeRequest(
        task_id="test",
        task_dir=Path("."),
        prompt="test",
        claude_session_id=None
    )
    try:
        await runtime.run(req, on_event)
    except Exception as e:
        print(f"Error: {e}")

asyncio.run(main())
