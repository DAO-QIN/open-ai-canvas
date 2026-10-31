# 实时对话功能实现（第一阶段 MVP）

## 项目概述

实现第一阶段（MVP）：**本地语音录制 + 浏览器语音识别转写**。点击麦克风按钮 → 按钮原位变成录音胶囊 → 点完成后自动转写为文字 → 文字填入输入框或直接发送。

第一阶段**不接入语音大模型、不依赖后端与 API Key**，转写由浏览器内置 Web Speech API 完成，零配置可用。

---

## 交互流程

1. 点击麦克风按钮（`VoiceRecordingButton`）
2. 按钮原位变成 `VoiceRecordingInline` 录音胶囊（不弹窗、与按钮同高），自动开始录音，焦点移到「完成」
3. 胶囊里依次是取消、5 根实时音量条（AnalyserNode 频段能量）、时长、完成
4. 点完成（或回车、录满 60 秒）→ 停止录音并等待浏览器语音识别收尾，胶囊同宽显示「识别中」
5. 识别成功 → 立即回调文本，由调用方填入输入框或直接发送；胶囊变回按钮，焦点回到按钮
6. 点取消或按 Esc → 放弃本次录音
7. 识别失败（不支持 / 权限拒绝 / 无语音 / 网络异常）→ 轻提示说明原因，胶囊收回成按钮，再点一次即可重试

---

## 技术架构

```
用户点击"实时对话"按钮
        │
        ▼
VoiceRecordingButton（按钮原位变成录音胶囊，不弹窗）
        │
        ▼
VoiceRecordingInline 录音胶囊（voice-recording.css）
        ├── useVoiceRecording：MediaRecorder 录制 + AnalyserNode 实时频段能量
        ├── AudioWaveform：5 根音量条 + 时长显示
        └── useSpeechRecognition：Web Speech API 实时转写
                │
                ▼
点击完成 → speech.stop() 返回文本 → onTranscribed(文本) → 填入输入框
```

## 前端实现

### 组件

| 文件 | 说明 |
|------|------|
| `components/conversation/voice-recording-button.tsx` | 语音输入按钮：点击后原位变成录音胶囊（局部状态，不弹窗），收起后焦点回到按钮 |
| `components/conversation/voice-recording-inline.tsx` | 录音胶囊：取消 + 音量条 + 时长 + 完成，完成后自动转写，失败用轻提示 |
| `components/conversation/voice-recording.css` | 胶囊样式；页面用 `--voice-pill-*` 变量对齐自己的控件高度与底色 |
| `components/conversation/audio-waveform.tsx` | 紧凑音量条（5 根竖条，减少动态效果时静止） |
| `components/conversation/index.ts` | 组件统一导出 |

### Hook

| 文件 | 说明 |
|------|------|
| `hooks/use-voice-recording.ts` | 语音录制逻辑（MediaRecorder + AnalyserNode，波形/时长/停止/取消；录满时长自动停止；授权未完成就取消时释放麦克风） |
| `hooks/use-speech-recognition.ts` | 浏览器语音识别（Web Speech API，start/stop/cancel，返回文本与错误） |

## 接入位置

- 创作页输入框：`web/src/pages/create/creation-workspace.tsx`（`CreationComposer` 右侧 `creation-submit-wrap`，发送键左边）
- 测试页：`web/src/pages/test-voice-recording.tsx`（路由 `/test-voice-recording`）

## 使用示例

```tsx
import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";

<VoiceRecordingButton
  disabled={isBusy}
  onTranscribed={(text) => setPrompt((prev) => (prev.trim() ? `${prev} ${text}` : text))}
/>
```

## 浏览器支持

- 语音识别使用 Web Speech API（`SpeechRecognition` / `webkitSpeechRecognition`），Chrome / Edge 支持
- 不支持时轻提示"当前浏览器不支持语音识别，请使用 Chrome 或 Edge 浏览器"，胶囊收回成按钮
- 识别语言默认 `zh-CN`，可通过 `useSpeechRecognition({ lang })` 调整

## 已删除内容

以下第二阶段实验代码已全部删除：

### 前端

- `components/conversation/realtime-conversation.tsx`、`realtime-conversation-button.tsx`、`voice-recording-overlay.tsx`
- `hooks/use-websocket.ts`、`stores/conversation-mode-store.ts`
- `services/api/stt.ts`（后端 Whisper 转写客户端）

### 后端

- `service/stt.go`（OpenAI Whisper 转写）、`model/stt.go`（`stt_results` 表）
- `handler/routes.go` 中 `RegisterSTTRoutes`、`main.go` 中路由注册
- `database/schema.go` 中 `STTResult` 模型注册、`repository/repository.go` 中 `CreateSTTResult`

## 验证情况

- 后端 `go build ./...`：通过
- 前端 `npx tsc --noEmit`：无本次新增类型错误（上游遗留 style profile / image.ts 错误除外）
- 浏览器手动测试（真实麦克风 + 语音识别）未运行，需在 Chrome/Edge 下验证

## 下一步

- [x] 内联录音胶囊 + 浏览器语音识别自动转写（第一阶段 MVP）
- [x] 移除第二阶段实验代码（WebSocket / WebRTC / Realtime API）
- [ ] 语音播放功能（TTS）
- [ ] 语音消息发送和显示
- [ ] 真正实时对话（WebSocket + WebRTC + Realtime API，后续阶段）
