# 🦞 Claw Agent Web UI 渐进式迭代开发计划 (Next.js + Rust)

基于当前项目的技术栈（前端 `Next.js` + `TypeScript` + `Tailwind CSS`，后端 `Rust` api-server），为了避免一开始架构过于庞大导致失控，建议采用 **“从小闭环到大生态”** 的 5 阶段（Phase）迭代策略。

整体界面布局目标：**IDE 工作台模式 (左侧会话 + 右侧辅助视窗 + 底部日志)**

---

## Phase 1: 基础设施打通 (基础 Chat MVP)
**目标**：跑通端到端的数据流，实现最基本的流式对话交互。

*   **后端 (Rust `api-server`)**:
    *   梳理并确保 `chat.rs` 提供标准的 SSE (Server-Sent Events) 接口，或基于 WebSocket 的双向通信接口。
    *   保证 `runtime_bridge.rs` 能够正确实例化 `ConversationRuntime`，接收 HTTP 输入并返回大模型原始流。
*   **前端 (Next.js)**:
    *   使用 `ai` 库 (如 Vercel AI SDK) 或原生 `EventSource` 实现对后端 SSE 接口的对接。
    *   完成基础的聊天流式渲染 (Markdown 解析，如使用 `react-markdown` + `remark-gfm`)。
    *   实现简单的会话历史记录管理（Context 保存）。
*   **此阶段产出**：一个纯文本对话的 Web 界面，像一个基础版的 ChatGPT，Agent 会思考并回复文本，但还不渲染复杂的工具动作。

---

## Phase 2: 工具链可视化 (单向渲染边界)
**目标**：让黑盒的 Agent 行为“清晰可见”，解析并展示 Agent 调用了哪些内部工具。

*   **前端交互设计**:
    *   解析后端下发的 `ToolResultContentBlock` 或自定义的 SSE 事件类型。
    *   **文件操作可视化**：当 Agent 调用 `read_file`, `write_file` 时，在对话流中插入一个小卡片（Card），折叠展示文件路径和代码 Diff（可以使用 `react-syntax-highlighter`）。
    *   **网络操作可视化**：当 Agent 调用 `WebSearch` 时，渲染一个带链接的“搜索来源”组件。
    *   **布局升级**：在右侧引入一个简易的 **Todo 面板**。监听大模型的 `TodoWrite` 工具调用，提取状态数据，渲染成实时的 Checklist。
*   **此阶段产出**：Agent 不再是简单的文本回复者，用户能直观看到它在读文件、写文件、改计划。

---

## Phase 3: 安全边界与反向控制 (Human-in-the-Loop)
**目标**：建立信任机制，拦截高危操作，允许人类随时介入。

*   **后端支持**:
    *   调整 `permission_enforcer`，对于需要 `DangerFullAccess` 的工具（如 `bash`, 删除文件），后端不要直接拒绝，而是暂停（Suspend）任务，向前端发送一个 `PermissionRequest` 事件，等待异步回调（通过 HTTP POST 提交审批结果）。
*   **前端交互设计**:
    *   **审批流拦截**：监听到审批事件时，在聊天流最新处渲染一个高亮的 **审批组件 (Approval Modal/Card)**。展示即将执行的 Bash 脚本或危险操作，提供 `[Approve]` 和 `[Deny]` 按钮，并附带输入框让用户补充拒绝原因。
    *   **主动提问响应**：适配 `AskUserQuestion` 工具，渲染包含选项 (options) 的表单。
    *   **底部面板**：引入一个折叠的 **终端视图 (Terminal Panel)** (可用 `xterm.js`)，专门用来以流式的方式打印 `bash` 工具的标准输出/错误输出，不污染主聊天界面。
*   **此阶段产出**：系统具备了工业级的安全管控感，用户成为了 Agent 的“主管”。

---

## Phase 4: 异步多任务与工作区集成 (Task Runner)
**目标**：利用后端的 Task/Worker 机制，释放 Agent 并发能力。

*   **前端交互设计**:
    *   **子任务托盘**：在顶部 Header 或右下角增加一个“后台任务管理 (Background Tasks)” 弹窗。
    *   当 Agent 触发 `Agent` (子 Agent) 或 `TaskCreate` 时，将其剥离主对话流，在任务托盘中以独立进度条或列表项显示。
    *   **文件树 (File Explorer)**：前端在右侧或左侧边栏加入工作区目录树。Agent 修改文件后，向前端发送事件，前端局部刷新文件树，甚至允许用户点击文件查看代码。
*   **此阶段产出**：Web UI 蜕变成为一个协同工作台，支持主线聊天和支线任务并发执行。

---

## Phase 5: 无限能力扩展与管理 (生态打通)
**目标**：将 MCP 协议、沙盒配置暴露给用户，提供平台化体验。

*   **前端交互设计**:
    *   **设置中心 (Settings/MCP Hub)**：提供独立的弹层，允许用户增删改查 MCP 外部服务器（比如填入 Jira、Github、Notion 的 MCP 连接配置）。
    *   **模型与 Provider 切换**：在顶部增加下拉框，动态调整底层的 `claude-opus`, `openai-compat` 等模型选项。
    *   **会话导出与快照**：支持将会话、Todo 和修改过的文件树打包保存为快照或导出。
*   **此阶段产出**：一个完整、可商用、极具极客感的高阶 AI Agent 协作平台。

---

### 💡 给你的前端实施建议
1. **状态管理**：由于涉及到复杂的实时事件（Chat, Terminal, Todos, Task, Approvals），建议在 Next.js 中使用 **Zustand**，它比 Context API 更适合这种高频更新的场景。
2. **样式组件库**：推荐使用 **shadcn/ui** 配合 Tailwind CSS，它的极简现代风非常适合构建复杂的 IDE 形态面板（如 Resizable Panel, ScrollArea, Cards）。
3. **SSE 状态机**：后端推流的事件可能会非常细碎，前端需要编写一个健壮的 Event Reducer，将 `chunk` 拼接组装成完整的 Tool 调用状态。
