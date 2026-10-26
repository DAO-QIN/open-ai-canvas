package service

import "yingce/backend/internal/app"

// 首页创作会话与生成记录。
type CreationSessionView = app.CreationSessionView
type CreationSessionPage = app.CreationSessionPage
type CreateCreationSessionRequest = app.CreateCreationSessionRequest
type UpdateCreationSessionRequest = app.UpdateCreationSessionRequest
type CreationEntryView = app.CreationEntryView
type CreationEntryPage = app.CreationEntryPage
type CreationReference = app.CreationReference
type CreationResultSlot = app.CreationResultSlot
type CreationResultResource = app.CreationResultResource
type SubmitCreationEntryRequest = app.SubmitCreationEntryRequest
type ImportCreationSessionsRequest = app.ImportCreationSessionsRequest
type ImportCreationSessionsResult = app.ImportCreationSessionsResult

// 首页创作会话的 Agent。
type CreationAgentItem = app.CreationAgentItem
type CreationAgentSnapshotView = app.CreationAgentSnapshotView
type CreationAgentHistoryView = app.CreationAgentHistoryView
type CreationAgentEventsView = app.CreationAgentEventsView
type CreationAgentMessageRequest = app.CreationAgentMessageRequest
type CreationAgentMessageResult = app.CreationAgentMessageResult
type CreationAgentAnswerRequest = app.CreationAgentAnswerRequest
type CreationAgentDecisionRequest = app.CreationAgentDecisionRequest
type CreationAgentDecisionResult = app.CreationAgentDecisionResult
