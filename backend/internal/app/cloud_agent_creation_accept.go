package app

import (
	"encoding/json"
	"math"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 创作页"提交即返回"：生成任务受理后立即把回执交还模型、结束这一轮，释放 Agent 名额；
// 结果由任务完成后直接出现在对话里（前端按 generation_task_created 建卡并订阅任务状态），
// 不需要 Agent 进程在场。只有本轮下一步要用这次的新成品时，模型才传 waitForResult=true，
// 继续走原来的等待交付。整套商品计划（commerce）有依赖和失败修复，仍等待整套结果。
const cloudAgentCreationAcceptedInstruction = "已受理并开始生成，完成后结果会直接出现在对话里；本轮不需要等待或查询。用一句话告诉用户已开始生成（数量、类型），不要描述尚未生成的画面，不要重复提交。"

func cloudAgentCreationReturnsOnSubmit(state *cloudAgentRuntime, media *cloudAgentMediaPlan) bool {
	return state != nil && media != nil && state.Request.Surface == "creation" && state.CommercePlan == nil && state.CommerceBatch == nil &&
		media.CommerceItemID == "" && media.CommerceRetryFailedTaskID == "" && !media.Args.WaitForResult
}

// cloudAgentCreationBatchReturnsOnSubmit 判断普通多图批次是否在全部受理后即返回。
func cloudAgentCreationBatchReturnsOnSubmit(state *cloudAgentRuntime, call cloudAgentCall, batch *cloudAgentCommerceBatch) bool {
	if state == nil || batch == nil || batch.Kind != "images" || state.Request.Surface != "creation" || state.CommercePlan != nil {
		return false
	}
	var args struct {
		WaitForResult bool `json:"waitForResult"`
	}
	_ = json.Unmarshal([]byte(call.Function.Arguments), &args)
	return !args.WaitForResult
}

func cloudAgentCreationAcceptedResult(task *model.Task, order *model.BillingOrder, mode string) map[string]any {
	result := map[string]any{"phase": "accepted", "taskId": task.ID, "status": task.Status, "mode": mode, "taskSubmitted": true, "delivery": "conversation", "instruction": cloudAgentCreationAcceptedInstruction}
	if order != nil && order.AmountMicrocredits > 0 {
		result["estimatedCredits"] = math.Round(float64(order.AmountMicrocredits)/float64(CreditScale)*10000) / 10000
	}
	return result
}

// cloudAgentRunCommittedMicrocredits 是本轮已提交媒体任务占用的积分：已结算按实扣，已退还为 0，
// 其余按报价、冻结与实扣中的最大值，与 cloudAgentRemainingBudget 同一口径（不含重试链上其他轮次）。
// 预授权额度按"出一张图"的预估给出，只和媒体消耗比；阿Q 自己的文本模型调用不计入（仍受本轮积分上限约束）。
func cloudAgentRunCommittedMicrocredits(repo *repository.Repository, userID string, state *cloudAgentRuntime) (int64, error) {
	ids := make([]string, 0, len(state.TaskIDs))
	seen := map[string]bool{}
	for _, id := range state.TaskIDs {
		if id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	var committed int64
	for offset := 0; offset < len(ids); offset += 500 {
		orders, err := repo.BillingOrdersByTaskIDs(userID, ids[offset:min(offset+500, len(ids))])
		if err != nil {
			return 0, err
		}
		for _, order := range orders {
			// 预授权只和媒体消耗比：文本模型调用和联网搜索（挂在主任务下）都不计入。
			if order.Capability == "text" || order.Capability == webSearchBillingCode {
				continue
			}
			cost := max(order.AmountMicrocredits, order.ReservedAmountMicrocredits, order.ActualAmountMicrocredits)
			switch order.Status {
			case model.BillingStatusRefunded:
				cost = 0
			case model.BillingStatusSettled:
				cost = order.ActualAmountMicrocredits
			}
			if cost > 0 {
				committed += cost
			}
		}
	}
	return committed, nil
}

// cloudAgentCreationAutoApproves 实现创作页"按预估授权"：点发送即同意本轮约 autoApproveCredits 积分以内的
// 媒体消耗（前端按发送前预估 × 1.2 传入，不超过本轮上限）。本轮已提交任务占用加上这次报价不超过
// "预授权 + 用户已批准的金额"时直接执行，不弹确认；超出才进入审批。只读和自动执行模式不受影响。
func (s *Service) cloudAgentCreationAutoApproves(userID string, state *cloudAgentRuntime, quoteMicrocredits int64) (bool, error) {
	if state == nil || state.Request.Surface != "creation" || state.Request.PermissionMode != "request_approval" || quoteMicrocredits < 0 {
		return false, nil
	}
	preauthorized := math.Min(state.Request.Budget.AutoApproveCredits, state.Request.Budget.MaxCredits)
	allowance := math.Floor(preauthorized * float64(CreditScale))
	if math.IsNaN(allowance) || allowance <= 0 || allowance >= float64(math.MaxInt64/2) {
		return false, nil
	}
	remaining, err := cloudAgentRemainingBudget(s.repo, userID, state)
	if err != nil {
		return false, err
	}
	if remaining < 0 || quoteMicrocredits > remaining {
		// 超出本轮积分上限：交给审批卡和准入去报错，不能因为预授权跳过上限。
		return false, nil
	}
	committed, err := cloudAgentRunCommittedMicrocredits(s.repo, userID, state)
	if err != nil {
		return false, err
	}
	approved := max(state.ApprovedMicrocredits, 0)
	if committed > math.MaxInt64-quoteMicrocredits {
		return false, nil
	}
	return committed+quoteMicrocredits <= int64(allowance)+approved, nil
}

// cloudAgentApprovalQuoteMicrocredits 是待审批内容的报价：单项媒体取冻结报价，批次取整批报价。
func cloudAgentApprovalQuoteMicrocredits(approval *cloudAgentApproval) int64 {
	if approval == nil {
		return 0
	}
	if approval.Batch != nil {
		return approval.Batch.QuoteMicrocredits
	}
	if approval.Prepared != nil {
		return approval.Prepared.Quote.AmountMicrocredits
	}
	return 0
}
