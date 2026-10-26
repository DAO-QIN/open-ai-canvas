# 首页 Agent

状态：设计稿第 2 版，待确认后再实施。本文不包含代码改动。

基线：`DAO-QIN/open-ai-canvas` `main` `afaa2de7`，数据库 `CurrentSchemaVersion = 63`。文中引用的文件、函数、接口和事件名均按该基线核对；实施前以最新代码为准。

第 2 版依据：2026-10-25 在已登录的 kunrouai.com 上实测首页 Agent 的报告（`D:\laji\yingce\output\kunrouai-agent-capture-20261025\REPORT.md`，含脱敏样例和截图）。第 1 版中对 kunrouai 的推断已按实测修正。

## 1. 目标

首页「Agent 模式」从“新建画布并跳转”的入口卡片，改为**在首页内完成多轮创作对话**：

1. 用户在首页输入想法，Agent 制定计划、提问、提出生成方案；用户在首页修改、确认或拒绝方案。
2. 方案确认后的产出与首页普通生成是**同一种生成记录**，共用结果卡、重试、清理失败和加入参考。
3. 同一个创作会话可以在普通模式和 Agent 模式之间切换，Agent 能看到并引用本会话已有作品。
4. 会话保存在服务端，可刷新、换标签、跨设备恢复，通过 `/create/:sessionId?mode=agent|image|video|text|audio` 打开。
5. 任何收费生成都要经用户确认；确认时服务端核对报价。
6. 用户能看清每一轮的文本费用和生成费用。

不做：首页不复制画布的节点编排；需要编排时提供「转到画布继续」。

## 2. kunrouai 实测结论

只列影响设计的结论。完整字段、样例和证据见实测报告。

### 2.1 已证实的结构

| 方面 | 实测 |
| --- | --- |
| 会话创建 | 首次发消息前 `POST /api/creation-agent/session`，正文 `{}`，**会话 ID 由服务端生成**；随后路由变为 `/create/:sid`。普通模式切换为 `?mode=image`，切回为 `?mode=agent`。 |
| 会话粒度 | 一个创作会话对应**一条** Agent 事件流，没有对外暴露“运行”概念。会话快照字段：`id, model, status, events, reasoningEffort, lastSeq, skills`。 |
| 发消息 | `POST .../message`，`{text, requestId(UUID), references, reasoningEffort, skillIds}`，响应只有 `{code:0}`，结果全部走事件流。 |
| 事件流 | `GET .../events?after=<lastSeq>`；外层固定 `event:agent`，有 `:connected`、`:heartbeat` 注释。业务信封 `{id, seq, position, type, data}`。 |
| 增量更新 | 流式输出块用**同一个外层 `id` 反复推送**，`seq` 递增、`position` 不变、`data.text` 是**累计全文**。快照只返回每个 `id` 的最新版本（实测 302 个 seq 合并为 64 条）。 |
| 事件类型 | 实测 11 种：`message`、`state`、`output`（`reasoning/tool/message` 三种块）、`reasoning`、`plan`、`question`、`approval`、`result`、`usage`、`context`、`activity`。`composition`、`skill` 仅见于前端代码。 |
| 会话状态 | 实测 `idle → ready → running → input/approval → waiting → ready → running → … → stopped`。`composing`、`error` 未出现。 |
| 工具名 | `update_plan`、`request_user_input`、`plan_generation`。 |
| 选择题 | 回答 `{selectedOptions: string[](选项文字), answer: string}`；回答后追加一条用户 `message`，其 `requestId` 为 `question:<qid>`。 |
| 方案 | `approval.data = {id, status, form, credits:"6", quoteVersion:1, outputId}`，`form = {sessionId, type, prompt, references, config, count}`；提交后补 `entryId`。方案状态：`pending/rejected/submitted/completed`。 |
| 方案修改 | 可改提示词（Markdown，上限 12000 字）、模型、数量；预计积分在**前端**按模型目录的计价公式实时计算。 |
| 决定 | 拒绝 `{approve:false, quoteVersion}`；确认 `{approve:true, quoteVersion, prompt, config, count, expectedCredits:"6"}`。响应只有 `{code:0}`。 |
| 一键确认 | 待确认方案多于 1 个时出现，显示合计；前端按顺序逐个提交，任何一个没进入 `submitted/completed` 就停止（前端代码，未点击）。 |
| 确认后顺序 | `result(entry pending, 已有 taskId)` → `approval(submitted, entryId)` → `state(waiting)` → 任务 `queued → running → succeeded` → `result(entry success)` → `approval(completed)` → `state(ready)` → `state(running)` **自动继续**。 |
| 生成记录 | `{id, sessionId, type, prompt, references, config, status, results[], createTime}`；`results[] = {id:"slot-0", status, taskId, url, width, height, bytes, mimeType, startedAt, completedAt}`。 |
| 用量 | `usage = {purpose:"reply", credits, inputTokens, cachedTokens, outputTokens, reasoningTokens}`；`context = {used, budget, remaining, window, reservedOutput, tokenizer}`。用量行的上下文占比 = `inputTokens / context.budget`。两者**不相邻**（首轮 seq 65 与 72）。 |
| 计划浮条 | 「创作计划 n/m」中 n 是**当前步骤序号**，不是完成数（浮条 3/4 时实际完成 2/4）。 |
| 停止 | `POST .../stop`，无正文；发 `state(stopped)` 和 `activity`“已停止继续规划；已确认的生成和合成任务将继续完成”。 |
| 恢复 | 刷新和新标签都是：读快照 → 读生成记录 → `events?after=<lastSeq>`。 |
| 幂等 | 前端对发送参数做 SHA-256 指纹存 `sessionStorage`，相同指纹复用 `requestId`。服务端是否去重**未验证**。 |
| 列表 | 会话列表 `queryPage` 页码分页；生成记录 `searchCount:false` 时 `total` 恒为 `"0"`。 |

### 2.2 实测暴露的问题（本设计要避免）

1. **每次等待结束都开一个收费文本轮次**：回答问题、处理完最后一个方案、生成完成，都会 `ready → running`。实测文本费用 9 积分，比生成费用 6 积分还多，且最后 1 积分找不到对应的用量事件。
2. **拒绝后会被重新提出**：第 2 张被拒绝，第 1 张成功后 Agent 用新方案 ID 又提了第 2 张。
3. **Agent 自述与事实冲突**：它说第 3 张“还没提交过”，但事件里第 3 张已提出并被拒绝。
4. **计划浮条进度语义误导**：n/m 看起来像完成数，实际不是。
5. **用量和上下文靠相邻关系配对**会配错。
6. **同一含义多套枚举**：任务 `succeeded`、记录 `success`、方案 `completed`。
7. **数字类型混用**：积分、计数、字节数、时间戳是字符串，其余是数字。
8. **列表总数不可靠**：`total:"0"` 时实际有记录。
9. **窄屏计划浮条遮挡内容**。
10. 事件流有 9 个序号缺口、少量乱码字符（原因未确认，可能是采集问题），说明客户端必须能容忍缺口并在缺口时重读快照。

### 2.3 未验证（本设计自行定义行为）

报价冲突的错误格式、`history?before` 分页、`/skill` 请求和 `skill` 事件、重试和清理失败、视频合成、断线后 `Last-Event-ID` 与 `after` 的优先级、服务端 `requestId` 去重、运行中停止时生成任务是否继续。

## 3. 现状

| 方面 | 现状 | 位置 |
| --- | --- | --- |
| 首页 Agent 入口 | 入口卡片，新建画布后跳转 `/canvas/:id?agent=1` | `web/src/pages/create/creation-agent-entry.tsx` |
| 首页会话存储 | 只在浏览器本地（localforage） | `web/src/services/creation-conversation-store.ts` |
| Agent 运行时 | pi 运行时，后端内嵌或独立 `yingce-agent` | `backend/agent-runtime/pi`、`cloud_agent_pi_*.go` |
| 运行记录 | `cloud_agent_executions`（含 `ConversationID`、`CanvasID`、`StateJSON`），事件 `cloud_agent_event_records`（`run_id + sequence`） | `backend/internal/model/cloud_agent.go` |
| 不绑定画布的运行 | 已支持，只开放计划、提问、技能、记忆 | `validateCloudAgentRequest`（`cloud_agent.go`） |
| 工具范围 | `agenttool.Scope{Canvas, Skills, Vision, ReadOnly, IncludeProfile}` | `cloudAgentToolScope` |
| 媒体生成 | `generate_media` 要求画布 `snapshotHash`，结果写画布节点；**确认后等待任务完成再继续**（`advanceCloudAgentMedia`） | `cloud_agent_media.go`、`cloud_agent_runtime_media.go` |
| 审批决定 | `POST /api/agent/runs/:id/approvals/:approvalId/decision`，可带 `mediaSettings`，不能改提示词和数量，请求体上限 4096 字节 | `backend/internal/handler/agent.go` |
| 服务端报价 | `POST /api/models/:id/quote`、`POST /api/model-catalog/quote`；画布创意互动的 `creation_submissions` 有带签名和过期时间的报价 | `handler/logical_models.go`、`handler/model_catalog.go`、`app/creation.go` |
| 任务关联 | `Task.AgentRunID`、`Task.ApprovalID`、`Task.GenerationID` | `backend/internal/model/models_task.go` |
| 前端可复用 | `AgentPlanBar`、`AgentQuestionBar`、`AgentToolCard`、`ApprovalCard`、`AgentContextRing`、首页结果卡 | `web/src/components/canvas/canvas-cloud-agent-*.tsx`、`web/src/pages/create/*` |
| 转入画布 | 已有 | `continueCreationConversationOnCanvas` |

注意命名：已有表 `creation_runs`、`creation_submissions` 属于画布创意互动（`canvas-creative-interaction.tsx`），与本设计的首页创作会话无关，本设计不修改它们。

后端现有事件类型（内部）：`assistant_message`、`assistant_delta`、`text_delta`、`reasoning_message`、`reasoning_delta`、`plan_updated`、`user_question`、`approval_requested`、`approval_decided`、`approval_deferred`、`generation_task_created`、`tool_completed`、`tool_failed`、`tool_arguments_rejected`、`usage`、`context_pressure`、`context_compacted`、`canvas_updated`、`user_interjection*`、`run_completed`、`run_failed`、`run_cancelled`。

### 3.1 历史尝试

| 来源 | 内容 | 结论 |
| --- | --- | --- |
| 上游 [#823](https://github.com/ddcat-ai/open-ai-canvas/pull/823)（已关闭） | 首页 Agent 全量迁入，约 5 万行 | 思路可借鉴，体量无法审查 |
| iGO 首页 Agent 补丁（`output/homepage-agent-review-20261016/REPORT.md`） | 2.5 万行，服务端会话、幂等重试、精确引用作品 | 与 main 冲突 30 个文件；会话目录无分页；未合入 |

## 4. 总体设计

### 4.1 关键决定

| 决定 | 内容 | 理由 |
| --- | --- | --- |
| D1 会话级接口 | 前端只面对“创作会话”，Agent 接口挂在会话下；内部仍按“每轮一个运行”复用现有 `cloud_agent_executions` | 与 kunrouai 一致，前端不必管理多个运行；后端复用全部运行时、审批、恢复能力 |
| D2 服务端整理事件 | 新增会话级公开事件流，服务端把内部事件整理成公开类型后写入独立表，前端直接渲染 | 刷新恢复只需“快照 + `after`”；内部事件改名不影响前端；快照天然是合并后的结果 |
| D3 报价在服务端 | 方案卡实时预计积分调用现有报价接口（防抖）；确认时服务端再核价 | 不在前端复制计价公式；与扣费口径一致 |
| D4 事实帧 | 每轮开始前把本会话的方案和生成记录状态以结构化事实注入 Agent | 解决 §2.2 第 2、3 条 |
| D5 自动继续可控 | 生成完成后只在计划还有未完成步骤时自动继续；每轮显示文本积分 | 解决 §2.2 第 1 条 |
| D6 统一枚举和类型 | 公开接口里成功统一为 `succeeded`；积分统一为微积分字符串；计数、时间用数字 | 解决 §2.2 第 6、7 条 |

### 4.2 概念

| 概念 | 说明 |
| --- | --- |
| 创作会话 | 首页的一段对话，`/create/:sessionId`。包含普通生成记录和 Agent 时间线。 |
| 生成记录（entry） | 一次生成请求及其结果槽位。普通模式提交或 Agent 方案确认后产生。 |
| Agent 轮次（run） | 内部概念：用户一条消息、一次回答或一次自动继续，对应一个 `cloud_agent_executions` 记录，`ConversationID = 会话 ID`。前端不感知。 |
| 方案（proposal） | `generate_media` 在首页提交的待确认生成请求，带报价。 |
| 公开事件 | 会话级事件，统一信封，按会话序号续读。 |

### 4.3 会话状态

公开 `status`：

| 状态 | 含义 | 进入条件 |
| --- | --- | --- |
| `idle` | 新会话，未发消息 | 创建 |
| `ready` | 已受理输入，准备运行 | 收到消息、回答、方案全部处理完、生成全部完成 |
| `running` | Agent 思考或调用工具 | 运行开始 |
| `input` | 等待用户回答选择题 | `ask_user` |
| `approval` | 有待确认方案 | `generate_media` 提出方案且本轮没有其他待办 |
| `waiting` | 等待已确认的生成完成 | 方案确认、任务未结束 |
| `composing` | 等待视频合成（阶段 4） | 合成确认 |
| `stopped` | 用户停止 | `stop` |
| `error` | 运行失败 | 运行失败且不可自动恢复 |

同一会话同时最多一个活跃轮次。`ready → running` 的自动继续规则见 §8.3。

### 4.4 主流程

1. 用户首次发送时，前端 `POST /api/creation/sessions` 拿到服务端生成的会话 ID，`navigate` 到 `/create/:id?mode=agent`，再发消息。
2. `POST /api/creation/sessions/:id/agent/messages`：服务端按 `requestId` 去重，创建内部运行（带事实帧），公开事件写入 `message(user)`、`state(ready)`。
3. 前端订阅 `GET /api/creation/sessions/:id/agent/events?after=<lastSeq>`。
4. Agent 运行，公开事件依次出现 `state(running)`、`output`、`plan`、`question` 或 `approval`。
5. 方案确认：`POST .../agent/proposals/:pid/decision`；服务端核价、创建生成记录和任务，写 `result(pending)`、`approval(submitted)`、`state(waiting)`。
6. 任务完成：写 `result(succeeded)`、`approval(completed)`；按 §8.3 决定是否 `state(ready) → running`。
7. 每轮结束写 `usage`（同一轮次带 `turnId`，与 `context` 配对）。

## 5. 数据表

新增迁移 `version 64`，名称 `creation_sessions`。兼容 SQLite 和 PostgreSQL。完成后同步 `docs/content/docs/backend/backend-database.mdx`。

### 5.1 `creation_sessions`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `varchar(36)` 主键 | 服务端生成；本地历史导入时沿用旧 ID（校验格式和归属） |
| `user_id` | `varchar(36)`，索引 | |
| `title` | `varchar(240)` | |
| `last_mode` | `varchar(16)` | `agent/image/video/text/audio` |
| `agent_status` | `varchar(16)` | 公开会话状态，见 §4.3 |
| `agent_model` | `varchar(160)` | 会话选用的文本模型（逻辑模型 ID） |
| `reasoning_effort` | `varchar(16)` | |
| `skill_ids_json` | `text` | 当前选用技能 |
| `active_run_id` | `varchar(80)`，可空 | 当前内部轮次 |
| `last_seq` | `bigint` | 公开事件最大序号 |
| `entry_count` | `int` | |
| `latest_entry_id` | `varchar(36)`，可空 | “刚才那张”的解析依据 |
| `canvas_id` | `varchar(80)`，可空 | 转入画布后关联 |
| `source` | `varchar(16)` | `server` / `local_import` |
| `deleted_at` | `timestamp`，可空，索引 | 软删除，不删任务、账务和素材；用普通时间字段而非 `gorm.DeletedAt`，避免 SQLite → PostgreSQL 搬迁漏掉已删除行 |
| `created_at`、`updated_at` | `timestamp` | `(user_id, updated_at, id)` 索引，游标分页 |

### 5.2 `creation_entries`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `varchar(36)` 主键 | |
| `session_id` | `varchar(36)`，索引 | |
| `user_id` | `varchar(36)`，索引 | |
| `origin` | `varchar(16)` | `manual` / `agent` |
| `proposal_id` | `varchar(160)`，可空 | Agent 方案 ID；`(session_id, proposal_id)` 唯一 |
| `client_operation_id` | `varchar(80)` | 幂等键；`(user_id, client_operation_id)` 唯一 |
| `retry_of` | `varchar(36)`，可空 | |
| `type` | `varchar(16)` | `image/video/text/audio` |
| `prompt` | `text` | 实际提交的提示词 |
| `config_json` | `text` | 实际生效参数（模型、画幅、分辨率、质量、时长、数量） |
| `references_json` | `text` | 稳定定位：素材 ID、存储键或“记录 ID + 槽位”；不存签名 URL |
| `credits_microcredits` | `bigint` | 确认时报价 |
| `status` | `varchar(16)` | `pending/running/succeeded/partial/failed/cancelled` |
| `results_json` | `text` | 槽位数组：`{slot, status, taskId, assetId, storageKey, width, height, bytes, mimeType, durationMs, failure}`；不存签名 URL |
| `hidden_failed` | `bool` | 清理失败后隐藏失败槽位 |
| `revision` | `bigint` | 修订号；多个任务同时完成时按修订号 CAS 写回，避免互相覆盖结果 |
| `created_at`、`updated_at` | `timestamp` | `(session_id, created_at, id)` 索引 |

### 5.3 `creation_entry_tasks`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `entry_id`、`task_id` | `varchar(36)` | 联合主键；`task_id` 单独索引，任务完成时反查记录 |
| `slot` | `int` | 槽位序号 |
| `user_id` | `varchar(36)` | |

用于任务完成时更新记录状态，以及素材删除前的引用检查（`AGENTS.md` 要求先检查业务引用）。

### 5.4 `creation_agent_events`

会话级公开事件，追加写入。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `session_id` | `varchar(36)` | 联合主键之一 |
| `seq` | `bigint` | 联合主键之一，会话内递增 |
| `item_id` | `varchar(80)`，索引 | 公开事件 ID；同一条内容的后续更新沿用同一个 `item_id` |
| `position` | `bigint` | 展示位置，取该 `item_id` 首次出现时的 `seq` |
| `type` | `varchar(24)` | 公开事件类型，见 §7 |
| `run_id` | `varchar(80)`，可空 | 来源内部轮次 |
| `turn_id` | `varchar(80)`，可空 | 轮次 ID，用于 `usage` 与 `context` 配对 |
| `request_id` | `varchar(80)`，可空 | 用户消息的 `requestId`；`(session_id, request_id)` 唯一，用于消息去重 |
| `data_json` | `text` | 载荷 |
| `user_id` | `varchar(36)` | |
| `created_at` | `timestamp` | |

- 与内部运行状态在**同一事务**写入（与 `cloud_agent_event_records` 的约定一致），避免公开事件与内部状态不一致。
- 流式块按节流写入：同一块距上次写入超过 300 ms 或新增超过 200 字时写一条，块结束时必写终稿。
- 快照只取每个 `item_id` 的最新一条；历史分页按 `position` 倒序。
- 序号由 `creation_sessions.last_seq` 在同一事务中原子递增分配，保证会话内连续。
- 保留策略：后台只清理**一小时前**写入、且已被更新版本取代的中间版本。在线客户端早已越过这些序号，不会看到缺口；很久后才续读的客户端遇到缺口会按 §7.1 重读快照一次。

### 5.5 `cloud_agent_executions` 新增列

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `target` | `varchar(16)`，默认 `canvas` | `canvas` / `creation`；旧数据回填 `canvas` |
| `creation_session_id` | `varchar(36)`，索引，可空 | `target = creation` 时必填 |

### 5.6 方案报价（存在运行状态中）

现有审批记录（`StateJSON`）在 `target = creation` 下补充：`form{type, prompt, references, config, count}`、`quoteVersion`、`creditsMicrocredits`、`quoteHash`、`entryId`、`decisionId`。

## 6. 接口

所有接口沿用 `{code, data, msg, reason}` 信封和登录态，service 层校验归属。完成后同步 `docs/content/docs/backend/http-api.mdx` 与 `GET /api/openapi.yaml`。

积分在接口中一律用**微积分整数的字符串**（如 `"6000000"`），字段名带 `Microcredits` 后缀；计数、宽高、时长、时间戳用数字。

### 6.1 创作会话

| 方法与路径 | 请求 | 响应与说明 |
| --- | --- | --- |
| `GET /api/creation/sessions?cursor=&limit=` | `limit` 默认 20，最大 100 | `{sessions:[{id,title,lastMode,agentStatus,entryCount,updatedAt}], nextCursor}`；`nextCursor` 为空表示读完；不返回总数 |
| `POST /api/creation/sessions` | `{title?, mode?}` | 新建，服务端生成 ID |
| `GET /api/creation/sessions/:id` | | 会话详情 |
| `PATCH /api/creation/sessions/:id` | `{title?, agentModel?, reasoningEffort?, skillIds?}` | 修改会话设置 |
| `DELETE /api/creation/sessions/:id` | | 软删除；有活跃轮次或待确认方案时 `409 creation_session_busy` |
| `POST /api/creation/sessions/import` | `{sessions:[...]}`，单次最多 50 个 | 导入浏览器本地历史；按会话 ID 和消息 ID 去重，只接受归属本人的任务 ID |

### 6.2 生成记录

| 方法与路径 | 请求 | 响应与说明 |
| --- | --- | --- |
| `GET /api/creation/sessions/:id/entries?before=&limit=` | `limit` 默认 20 | `{entries, nextBefore}`；不返回总数；未结束的记录先按任务状态校准 |
| `POST /api/creation/sessions/:id/entries` | `{clientOperationId, type, prompt, config, references, tasks}` | 普通模式提交；`tasks` 是 1–4 个与 `POST /api/tasks` 相同的任务输入，每项一个槽位；同 `clientOperationId` 返回原记录并只补建缺失槽位 |
| `GET /api/creation/entries/:id` | | 单条记录 |
| `POST /api/creation/entries/:id/retry` | 无 | 把失败或已取消槽位的原任务重新排队（沿用 `POST /api/tasks/:id/retry`），记录回到进行中，不新建记录 |
| `POST /api/creation/entries/:id/clear-failed` | | 隐藏失败槽位，不删任务和账务 |

实现要点（PR2）：

- **不在服务端重新组装供应商请求。** 客户端仍按现有方式准备任务输入（协议参数、参考上传、计费字段），服务端逐个交给 `CreateTask`，模型路由、能力校验、额度和计费都沿用任务入口。
- **防重复扣费。** 任务创建本身没有服务端幂等。每个槽位的任务 ID 由服务端从 `(用户, 记录, 槽位)` 推导（`CreateTaskRequest` 的内部字段 `fixedTaskID`，客户端无法指定）；重试同一操作时先按该 ID 查任务，已存在就复用；并发撞主键时建任务与预扣积分的事务整体回滚，再复用先到者。文本回放任务同样使用该 ID。
- **准入失败。** 某槽位建任务失败（如积分不足）时记录为没有 `taskId` 的失败槽位；所有槽位都失败时接口返回第一个准入错误，记录保留为失败。同一操作重放不再尝试这些槽位，需要客户端以新操作重新提交。
- **回写。** 任务终态协调器在所有终态路径上同步引用该任务的记录，结算或退款后再同步一次扣费；文本回放完成也会同步。未经过协调器的路径（如直接取消排队任务）由读取时校准兜底。
- **扣费汇总。** `creditsMicrocredits` 汇总关联计费单：已结算取实际金额，已退款扣除退款，其余取预扣金额。
- **素材引用。** 生成记录的参考与结果纳入资源引用汇总，未删除会话中的记录会阻止素材删除，占用来源显示为“首页创作记录”。

### 6.3 Agent（会话级）

| 方法与路径 | 请求 | 响应与说明 |
| --- | --- | --- |
| `GET /api/creation/sessions/:id/agent` | | 快照：`{status, lastSeq, items, historyBefore, model, reasoningEffort, skills}`；`items` 为每个 `item_id` 的最新版本，最多 100 条，按 `position` 正序 |
| `GET /api/creation/sessions/:id/agent/history?before=<position>&limit=` | | 更早的 `items` 和新的 `historyBefore`；为空表示读完 |
| `GET /api/creation/sessions/:id/agent/events?after=<seq>` | 也接受 `Last-Event-ID`，两者都有时取较大值 | SSE，见 §7.1 |
| `POST /api/creation/sessions/:id/agent/messages` | `{text, requestId, references, reasoningEffort, skillIds}` | `{accepted:true, seq}`；同会话同 `requestId` 重复提交返回原 `seq`，不新开轮次；有活跃轮次时作为插话送达（复用现有插话机制） |
| `POST /api/creation/sessions/:id/agent/questions/:qid/answer` | `{selectedOptions:string[], answer:string}` | `selectedOptions` 传选项 ID（不是文字）；重复回答返回 `409 question_answered` |
| `POST /api/creation/sessions/:id/agent/proposals/:pid/decision` | 见下 | `{proposal, entry?}`：直接返回最新方案和生成记录，前端不必等事件 |
| `POST /api/creation/sessions/:id/agent/stop` | 无正文 | 停止当前轮次，不取消已受理的生成任务 |

**方案决定请求：**

```json
{
  "decisionId": "客户端生成的 UUID",
  "approve": true,
  "quoteVersion": 1,
  "expectedCreditsMicrocredits": "6000000",
  "prompt": "修改后的提示词",
  "config": { "logicalModelId": "...", "aspectRatio": "3:4", "resolution": "1K", "quality": "auto" },
  "count": 1
}
```

- 拒绝只需 `{decisionId, approve:false, quoteVersion}`，可选 `reason`。
- 服务端按修改后的内容重新报价；`quoteVersion` 不一致或积分不等于 `expectedCreditsMicrocredits` 时返回 `409 quote_changed`，`data` 带最新方案和报价，不创建任务。
- 同一 `decisionId` 重复提交返回第一次的结果。
- 请求体上限 64 KB。
- 内部实现：转调现有审批决定逻辑，扩展 `mediaSettings` 以外的 `prompt`、`count` 字段。现有 `POST /api/agent/runs/:id/approvals/:approvalId/decision` 保持不变，供画布使用。

**实时报价：** 方案卡编辑时，前端防抖 300 ms 调用现有 `POST /api/models/:id/quote`，显示预计积分；报价失败时禁用确认按钮并显示原因。不在前端复制计价公式。

**一键确认：** 前端按顺序逐个调用决定接口；某个返回非成功、或返回的方案状态不是 `submitted` 时停止，提示用户已确认几个、剩余几个。

### 6.4 错误原因（`reason`）

| reason | HTTP | 说明 |
| --- | --- | --- |
| `creation_session_not_found` | 404 | 会话不存在、已删除或不属于当前用户 |
| `creation_session_busy` | 409 | 删除时仍有活跃轮次或待确认方案 |
| `quote_changed` | 409 | 报价已变化，`data` 带最新方案 |
| `proposal_not_pending` | 409 | 方案已被处理，`data` 带最新方案 |
| `question_answered` | 409 | 问题已回答 |
| `creation_entry_not_found` | 404 | |
| `agent_budget_exceeded` | 402 | 本轮或会话积分预算不足 |

## 7. 公开事件

### 7.1 SSE 帧

```text
:connected

id:12
event:agent
data:{"id":"<itemId>","seq":12,"position":10,"type":"output","turnId":"<runId>","data":{...}}

:heartbeat
```

- 每 15 秒一个 `:heartbeat`。
- `id:` 行写 `seq`，供 `Last-Event-ID` 使用。
- 客户端按 `id` 保留最大 `seq` 的版本，按 `position` 排序；`seq ≤` 当前游标的帧丢弃。
- 客户端发现 `seq` 不连续时，重读快照，再从快照的 `lastSeq` 续读。

### 7.2 事件类型

| 类型 | 载荷 | 来源（内部事件） | 展示 |
| --- | --- | --- | --- |
| `state` | `{status}` | 运行状态变化 | 状态行、输入框按钮（发送/停止） |
| `message` | `{role, text, requestId?, references?}` | 用户消息、回答、`assistant_message` 终稿 | 用户气泡 / 正文 |
| `output` | `{kind:"reasoning"\|"tool"\|"message", status:"streaming"\|"completed"\|"interrupted", text, toolName?, callId?, preview?, durationMs?}` | `*_delta`、`tool_completed`、`tool_failed` | 流式正文、思考折叠、工具行；同名同状态的连续工具行折叠 |
| `plan` | `{explanation, steps:[{step, status}], completedCount, currentIndex}` | `plan_updated` | 计划浮条显示「已完成 completedCount/总数」，不用当前序号冒充进度 |
| `question` | `{id, question, options:[{id, label, description}], multiple, status, selectedOptions?, answer?}` | `user_question` | 选择题卡，回答后折叠可展开 |
| `approval` | `{id, status:"pending"\|"rejected"\|"submitted"\|"completed"\|"failed", form:{type, prompt, references, config, count}, creditsMicrocredits, quoteVersion, entryId?}` | `approval_requested`、`approval_decided` | 方案卡；连续方案成组，待确认多于 1 个显示一键确认和合计 |
| `result` | 生成记录对象（§5.2 的公开形式） | 记录创建与任务状态变化 | 结果卡，占据对应方案卡的位置 |
| `usage` | `{creditsMicrocredits, inputTokens, cachedTokens, outputTokens, reasoningTokens}` | `usage` | 与同 `turnId` 的 `context` 合并为一行；显示本轮文本积分 |
| `context` | `{used, budget, remaining, window, reservedOutput}` | `context_pressure` | 同上 |
| `activity` | `{text}` | 停止、压缩、插话送达等 | 灰色提示行 |
| `composition` | 阶段 4 定义 | | 合成卡 |

状态枚举在公开接口中统一：方案 `completed` 表示其生成记录已结束；生成记录和任务都用 `succeeded`。

## 8. Agent 行为

### 8.1 工具范围（`target = creation`）

在 `agenttool.Scope` 增加 `Creation bool`。

| 工具 | 开放 | 说明 |
| --- | --- | --- |
| `plan_update`、`ask_user` | 是 | `ask_user` 选项增加稳定 `id` |
| `skill_search`、`recall_lessons`、`remember_lesson`、`model_list` | 是 | 不变 |
| `creation_generate_media`（首页版 `generate_media`） | 是 | 独立工具名，不改画布版契约；不要求 `snapshotHash`，不写画布；参数 `mode, prompt, title, 模型选择, 规格, references[{entryId,slot}|{resourceId}]`；每次一个方案、一个结果 |
| `creation_read_entries` | 新增 | 分页读本会话生成记录摘要 |
| `creation_inspect_result` | 新增，需视觉能力；推迟到 PR7 | 按“记录 ID + 槽位”读真实图片，复用 `canvas_inspect_image` 的图片准备 |
| `canvas_*`、`previs_*`、`image_layer_split`、`image_annotation_render` | 否 | |
| `compose_video` | 阶段 4 | |
| `web_search`、`web_fetch` | 阶段 4 | 出站经 `internal/outbound` 的 SSRF 校验 |

### 8.2 事实帧

每个轮次开始前，服务端注入本会话的结构化事实（复用现有任务事实帧机制 `cloud_agent_task_facts.go` 的做法）：

- 本会话所有方案：ID、简述、状态（待确认 / 已拒绝 / 已提交 / 已完成 / 失败）、拒绝原因。
- 最近生成记录：ID、类型、状态、槽位数，`latest_entry_id`。
- 当前计划。

系统提示词（首页版）规定：

- 已拒绝的方案不得以相同内容再次提出，除非用户明确要求；要换方向先用 `ask_user` 确认。
- 关于“提过什么、生成过什么”的陈述以事实帧为准。
- “刚才那张”指 `latest_entry_id`；用户明确指定旧作品时以用户为准。
- 不包含画布布局和节点规则。

### 8.3 自动继续

| 触发 | 规则 |
| --- | --- |
| 用户回答选择题 | 继续（用户明确期待回应） |
| 方案全部处理完（含全部拒绝） | 有已确认方案时等待生成；全部拒绝时继续一轮询问下一步 |
| 生成全部完成 | 计划还有未完成步骤时继续；否则停在 `ready`，不自动开新轮 |
| 生成失败 | 继续一轮说明失败并给出选项，不自动重新提交收费生成 |

每次自动继续写一条 `activity`（如“生成完成，继续下一步”），随后该轮的 `usage` 会显示本轮文本积分。会话设置里提供“生成完成后自动继续”开关，默认开。

### 8.3.1 PR4 实现说明

- 运行：`CloudAgentRequest.creationSessionId`（与 `canvasId` 互斥）、`autoContinue`（省略为开）。运行行写 `target=creation` 与 `creation_session_id`。同一会话同时只允许一轮，占用随运行结束自愈（下一轮创建时发现占用者已结束即释放）。续轮的 parent 必须属于同一会话。
- 生成：方案先做不收费准入与报价，进入审批（预览 `kind=creation_generation`）。批准后在同一事务里创建任务与 `origin=agent` 的生成记录（`proposal_id` = 审批 ID，`client_operation_id` = `agent:<审批 ID>`，记录 ID 由用户和审批 ID 推导），任一失败整体回滚。任务终态由任务协调器回写记录，Agent 只把记录的槽位结果作为工具结果交给模型。
- 拒绝：本轮结束且不产生任务或记录，方案在运行状态 `creationProposals` 里记为 `reject`，续轮继承（未决定的记为 `expired`）。“全部拒绝时继续一轮”随 PR6 的决定接口实现。
- 事实帧：每次模型请求末尾附一条 `kind=creation_facts` 的运行状态消息，含最近 8 条生成记录（槽位、资源 ID、尺寸、失败原因）与方案决定；只用于本次请求，不写回对话历史。
- 自动继续：关闭时生成完成即结束本轮；开启时失败续跑一轮说明原因，成功只在计划还有 `pending` 步骤时续跑，否则直接结束本轮（不额外花一次模型调用）。
- 系统提示词：`agent-system-policy.md` v19 增加“首页创作会话”一节；执行上下文在首页会话里带 `target: "creation"`。

### 8.3.2 PR5–PR7 实现说明

- 公开事件：仓储层在追加运行日志的同一事务里回调整理器（`repository.CloudAgentJournalAppended`），把 `target=creation` 运行的内部事件整理成 §7.2 的公开事件。方案卡、结果卡等同一条内容的每个版本都是完整内容，快照只取最新版本。
- 流式正文不落库：事件流每秒检查一次，把当前步骤的草稿正文作为 `event:live` 帧附带。
- 方案决定：`decision` 转调画布审批决定；`expectedCreditsMicrocredits` 与当前报价不符时 `409 quote_changed`。方案卡编辑提示词、数量和实时报价（原 PR6 的其余部分）尚未实现，审批时可改模型和规格。
- 首页界面：Agent 模式下首页切换为 Agent 工作区（时间线、计划浮条、选择题、方案卡、结果卡、用量行、停止），复用画布 Agent 的正文、计划与选择题组件；右下角的画布助手入口在首页 Agent 模式下隐藏。

### 8.4 预算

- 沿用运行预算 `Budget.MaxCredits`，并新增会话级累计上限（默认取运行时策略配置）。
- 生成费用在方案确认时按报价预扣；文本费用按每轮 `usage` 结算。
- 预算不足返回 `agent_budget_exceeded`，前端提示并停在 `ready`。

## 9. 前端

### 9.1 路由与入口

- `/create/:sessionId?mode=agent|image|video|text|audio`；`/create` 和 `/` 打开最近会话或空白新会话（发送时才创建）。
- 「Agent 模式」成为输入框中的一个模式；是否默认见 §11。
- 删除 `creation-agent-entry.tsx` 入口卡片；保留「转到画布继续」。

### 9.2 组件

| 组件 | 来源 |
| --- | --- |
| 时间线（按 `position` 渲染 `items`，同 `id` 取最大 `seq`） | 新建 `web/src/lib/creation-agent/timeline.ts`（纯函数，单独测试） |
| 方案组卡：编辑提示词（Markdown，12000 字上限）、模型、参数、数量；实时报价；确认、暂不生成、一键确认、合计 | 复用 `ApprovalCard` 与图片、视频审批设置的逻辑，按首页样式重做 |
| 计划浮条（已完成数/总数，可展开） | 复用 `AgentPlanBar`；窄屏改为可收起的顶部条，不遮挡时间线 |
| 选择题卡（单选/多选 + 其他想法） | 复用 `AgentQuestionBar` |
| 工具行、思考折叠 | 复用 `AgentToolCard` / `AgentOperationFeed` |
| 结果卡 | 复用首页普通模式结果卡 |
| 用量行（输入、缓存及命中率、输出、思考、上下文占比、本轮积分） | 复用 `AgentContextRing` 的数据，改为单行 |

### 9.3 数据与恢复

- React Query 键：`["creation-session", scope, id]`、`["creation-entries", scope, id]`、`["creation-agent", scope, id]`；账号切换时清空。
- 恢复顺序：读会话快照 → 读生成记录第一页 → `events?after=lastSeq`。
- 断线重连：间隔 2 秒起、指数退避至 30 秒；页面隐藏时断开，可见时重连。
- `requestId`：对 `{sessionId, text, references, skillIds(排序)}` 做 SHA-256 指纹，存 `sessionStorage`（键含用户与会话），相同指纹复用；成功后删除。服务端同样按 `requestId` 去重。
- 本地历史导入：首次进入时后台调用导入接口；失败不阻塞，保留本地副本。

普通模式接入（PR3，已实现）：

- 生成流程只替换建任务这一步：`createCreationEntryTaskCreator` 收齐一次生成的全部任务输入后提交一条生成记录，再按槽位把服务端建好的任务交还；参考上传、流式文本、等待、结果物化和重试上下文不变。生成记录的 `config` 保存模型、参数和已上传附件的展示信息，`references` 只放已上传的资源。
- 会话列表以服务端为准，浏览器 localforage 只做缓存；打开服务端会话时读取它的生成记录，与缓存消息合并（按 `entryId`、`clientOperationId` 或导入键 `import:<会话>:<消息ID>` 对上，本地正在生成的消息保留本地版本）。
- 本地新会话 ID 带 `local:` 前缀，第一次提交时才在服务端创建会话并换成服务端 ID，地址随之变为 `/create/:id?mode=`。
- 打开 `/create` 时从空白会话开始（原先会自动打开最近一次的会话），历史会话从抽屉或 `/create/:id` 进入；会话不存在时提示并回到 `/create`。
- 重试失败消息时调用 `clear-failed` 隐藏旧的失败记录，刷新或换设备后不再出现。

## 10. 计费与安全

- 所有生成必须经方案确认；首页第一版不提供“免确认生成”。
- 确认时服务端重新报价并比对；生成费用按确认报价预扣，与现有任务计费一致。
- 幂等：会话导入按会话 ID；普通提交按 `clientOperationId`；消息按 `(session_id, requestId)`；方案决定按 `decisionId`；任务提交沿用现有幂等键。
- 归属：会话、记录、轮次、任务、素材在 service 层逐一校验；Agent 读取记录时再校验记录属于运行绑定的会话。
- 参考素材只存稳定定位符，展示时再签名；事件、日志和记忆中不写签名 URL 和密钥。
- 删除会话为软删除；素材删除前把 `creation_entry_tasks` 纳入引用检查。
- 停止只停编排；已确认的生成任务照常完成并回写记录。
- `web_search` / `web_fetch` 走出站白名单与 SSRF 防护，结果视为不可信资料。

## 11. 待确认问题

| 问题 | 建议 |
| --- | --- |
| Agent 模式是否作为首页默认模式 | kunrouai 默认 Agent。建议第一版默认仍为图片模式，Agent 稳定后切默认 |
| 生成完成后自动继续是否默认开启 | 默认开启，但仅在计划有未完成步骤时继续（§8.3） |
| 本地历史是否导入服务端 | 导入；失败不阻塞 |
| 首页 Agent 的默认文本模型 | 选价格低、支持工具调用的模型（kunrouai 用 `deepseek-flash`），后台可配 |
| 会话级积分上限默认值 | 后台运行时策略配置，建议默认 50 积分/会话/天 |
| 视频合成、联网搜索是否进第一期 | 不进，放阶段 4 |
| 起手模板 | kunrouai 首页实测没有，改为低优先级 |
| 首页的方案扩展字段是否同步到画布 Agent | 第一版只在首页启用 |

## 12. PR 拆分

每个 PR 独立可审查、可回退；行数为估算。

| PR | 内容 | 主要文件 | 规模 | 依赖 |
| --- | --- | --- | --- | --- |
| PR0 | 合入稳定性修复 [#738](https://github.com/ddcat-ai/open-ai-canvas/pull/738)、[#732](https://github.com/ddcat-ai/open-ai-canvas/pull/732)、[#729](https://github.com/ddcat-ai/open-ai-canvas/pull/729) | `cloud_agent_*`、`agent-runtime.mjs` | ~0.6k | 无 |
| PR1 | 迁移 v64：§5 全部表和列；repository 层；数据库文档 | `internal/model`、`internal/database/migrations.go`、`internal/repository` | ~0.8k | 无 |
| PR2 | 创作会话与生成记录接口（§6.1、§6.2）；任务完成回写记录；素材引用检查 | `internal/app/creation_session*.go`、`internal/handler/creation_session.go`、`http-api.mdx` | ~1.3k | PR1 |
| PR3 | 首页普通模式改用服务端会话：`/create/:sessionId?mode=`、游标分页历史、本地历史导入 | `web/src/pages/create/*`、`web/src/services/api/creation-sessions.ts` | ~1.2k | PR2 |
| PR4 | Agent `creation` 目标：工具范围、首页版 `generate_media`、`creation_read_entries`、`creation_inspect_result`、事实帧、首页系统提示词、自动继续规则 | `cloud_agent.go`、`cloud_agent_tool_registry.go`、`cloud_agent_tools*.go`、`cloud_agent_media*.go`、`cloud_agent_task_facts.go`、`internal/prompts` | ~1.8k | PR0、PR1 |
| PR5 | 会话级 Agent 接口与公开事件：整理器（内部事件 → 公开事件，同事务写入）、快照、历史、SSE、消息去重、停止 | `internal/app/creation_agent*.go`、`internal/handler/creation_agent.go` | ~1.6k | PR2、PR4 |
| PR6 | 方案报价与决定：表单字段、`quoteVersion`、`decisionId`、`quote_changed`、`proposal_not_pending`、请求体上限 | `cloud_agent_media_approval.go`、`cloud_agent_approval_preview.go`、`creation_agent_decision.go` | ~0.8k | PR5 |
| PR7 | 首页 Agent 界面：时间线、方案组卡与实时报价、一键确认、计划浮条、选择题卡、用量行、停止与恢复、断线重连 | `web/src/lib/creation-agent/*`、`web/src/pages/create/*` | ~2.5k | PR3、PR6 |
| PR8 | 视频合成工具与合成卡 | `cloud_agent_composition.go`、合成卡 | ~1k | PR7 |
| PR9 | `web_search` / `web_fetch` | `cloud_agent_tools_web.go`、`internal/outbound` | ~0.6k | PR7 |

PR1–PR3 与 PR4 可并行。PR3 合入后普通模式即获得跨设备同步，可单独上线。

每个 PR 的验证：

- 后端：`cd backend && go test ./...`；PR1、PR2、PR5 另在 PostgreSQL 上验证迁移、幂等和同事务写入。
- PR5 增加整理器单元测试：流式块合并、快照只含最新版本、`after` 续读无重复、序号缺口触发重读。
- PR4 增加行为测试：已拒绝方案不重复提出、事实帧内容正确、生成完成后按计划决定是否继续。
- 前端：`cd web && bun run build`；时间线纯函数专项测试。
- 浏览器验收（PR3、PR7）：见 §13。
- 实现后写入 `docs/content/docs/progress/pending-test.mdx`。

## 13. 验收清单

- [ ] 首页 Agent 发消息后不跳页，计划、提问、方案、结果都在首页显示。
- [ ] 首次发送后地址变为 `/create/:id?mode=agent`；切换普通模式后地址带 `mode=image`，时间线保留。
- [ ] 方案可改提示词、模型、参数、数量，预计积分实时更新；确认后才扣生成费用。
- [ ] 确认前报价变化时，服务端返回 `quote_changed` 并显示最新报价。
- [ ] 一键确认按顺序执行，中途失败即停，提示已确认数量。
- [ ] 结果卡与普通模式一致，可重试、清理失败、加入参考。
- [ ] 被拒绝的方案不会以相同内容再次出现。
- [ ] Agent 关于已提交、已拒绝内容的陈述与事件一致。
- [ ] 计划浮条显示的是已完成数。
- [ ] 每轮用量行显示本轮文本积分，与账务一致。
- [ ] 生成完成后，计划没有剩余步骤时不自动开新轮。
- [ ] 刷新、新标签、换浏览器后恢复一致；断网恢复后自动续读且无重复。
- [ ] 同一 `requestId` 重复发送不产生第二轮。
- [ ] 停止 Agent 后，已确认的生成任务照常完成。
- [ ] 账号切换后看不到上一个账号的会话。
- [ ] 历史列表超过一页时可继续加载。
- [ ] 窄屏下计划浮条不遮挡方案卡和选择题。
- [ ] 本地旧会话导入后内容一致，重复导入不产生重复记录。
