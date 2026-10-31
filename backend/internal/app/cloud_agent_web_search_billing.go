package app

// 联网搜索按次扣积分（首页创作与画布助手共用）。
//
//   - 价格是管理员在「联网搜索」配置里填的每次积分（微积分，0 表示免费），只叠加用户分组倍率，
//     与前台统一价模型同一口径；积分功能关闭时不扣费。
//   - 只对真正发往搜索服务的请求计费：发出前冻结，搜到结果才结算，搜索失败或没有结果全额退回；
//     10 分钟内复用的结果不发请求，也不扣费。
//   - 订单挂在本轮 Agent 主任务（即运行 ID）下：计入本轮「单次花费上限」和回复末尾的本轮消耗，
//     用量看板按 Agent 消耗统计。
//   - 幂等键由运行、模型步、调用 ID 和参数摘要派生：检查点冲突重试或进程重启后重放同一次调用，
//     最多扣一次。

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const (
	// webSearchBillingCode 是联网搜索订单的能力、模型和场景编码；用量看板与积分明细据此显示「联网搜索」。
	webSearchBillingCode = "web_search"
	// cloudAgentToolChargedField 是工具结果里只给界面看的扣费金额（微积分）：随工具事件下发，不写进模型上下文。
	cloudAgentToolChargedField = "chargedMicrocredits"
)

// webSearchCharge 是一次 web_search 调用的计费进度；order 为空表示本次不扣费。
type webSearchCharge struct {
	order *model.BillingOrder
	// reserved 表示 order 的积分已经冻结（本次新冻结，或重放时接续的在途订单），结束时必须结算或退回。
	reserved bool
	// charged 是本次调用最终扣掉的积分；重放时包括此前已结算的同一次调用。
	charged int64
}

func webSearchInsufficientCredits() error {
	return BadAuthRequest("积分不足，本次没有联网搜索；充值后再试，或先不联网继续创作")
}

// webSearchUserPrice 返回该用户每次搜索实际扣的积分（已乘分组倍率）；价格为 0 或积分功能关闭时返回 0。
func (s *Service) webSearchUserPrice(userID string, value webSearchSettingValue) (int64, groupPricing, error) {
	if value.PriceMicrocredits == 0 {
		return 0, groupPricing{}, nil
	}
	enabled, err := s.FeatureEnabled(FeatureCredits)
	if err != nil || !enabled {
		return 0, groupPricing{}, err
	}
	// 保存时已校验范围；读到越界值说明配置被改坏，失败关闭，不当作免费。
	if value.PriceMicrocredits < 0 || value.PriceMicrocredits > webSearchMaxPriceMicrocredits {
		return 0, groupPricing{}, BadAuthRequest("联网搜索的积分价格配置无效，请联系管理员")
	}
	access, err := s.userGroupAccess(userID)
	if err != nil {
		return 0, groupPricing{}, err
	}
	pricing, err := access.pricing(model.PriceCurrencyCredits, webSearchBillingCode)
	if err != nil {
		return 0, groupPricing{}, err
	}
	amount, err := creditAmount(value.PriceMicrocredits, 1, pricing.MultiplierBPS)
	if err != nil {
		return 0, groupPricing{}, err
	}
	return amount, pricing, nil
}

// webSearchBillingKey 是一次工具调用的计费幂等键。调用 ID 在不同模型步之间可能复用，所以带上声明它的模型步；
// 同一调用 ID 换了参数也算另一次搜索。
func webSearchBillingKey(state *cloudAgentRuntime, call cloudAgentCall) (string, error) {
	if state == nil || strings.TrimSpace(state.RuntimeRunID) == "" || strings.TrimSpace(call.ID) == "" {
		return "", BadAuthRequest("联网搜索缺少运行归属，本次没有搜索，也没有扣积分")
	}
	digest, err := cloudAgentCallDigest(call)
	if err != nil {
		return "", err
	}
	step := state.PiModelTaskID
	if step == "" {
		step = "step:" + strconv.Itoa(state.Step)
	}
	sum := sha256.Sum256([]byte(strings.Join([]string{state.RuntimeRunID, step, call.ID, digest}, "\x00")))
	return webSearchBillingCode + ":" + hex.EncodeToString(sum[:]), nil
}

// prepareWebSearchCharge 在发往搜索服务前确定本次是否扣费，并预检本轮花费上限和余额。这里还不冻结积分：
// 每日次数用完或余额不足时，不会在积分明细里留下冻结后又退回的记录。cached 表示直接复用 10 分钟内的结果。
func (s *Service) prepareWebSearchCharge(userID string, state *cloudAgentRuntime, call cloudAgentCall, value webSearchSettingValue, cached bool) (*webSearchCharge, error) {
	charge := &webSearchCharge{}
	amount, pricing, err := s.webSearchUserPrice(userID, value)
	if err != nil && cached {
		// 复用结果本来就不扣费，价格算不出来（如分组配置缺失）也不拦。
		return charge, nil
	}
	if err != nil || amount == 0 {
		return charge, err
	}
	key, err := webSearchBillingKey(state, call)
	if err != nil {
		return nil, err
	}
	existing, err := s.repo.BillingOrderByIdempotencyKey(userID, key)
	if err == nil {
		// 同一次调用被重放：沿用原订单，不冻结第二份。已退回或待核对的订单不再改动，本次也不另扣。
		switch existing.Status {
		case model.BillingStatusSettled:
			charge.charged = existing.ActualAmountMicrocredits
		case model.BillingStatusReserved, model.BillingStatusRunning:
			charge.order, charge.reserved = existing, true
		}
		return charge, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if cached {
		return charge, nil
	}
	remaining, err := cloudAgentRemainingBudget(s.repo, userID, state)
	if err != nil {
		return nil, err
	}
	if remaining < amount {
		// 两个入口的花费上限在不同位置设置，提示要指向用户能找到的那一项。
		if state.Request.Surface == "creation" {
			return nil, BadAuthRequest("本次对话剩余的花费额度不够再搜索一次，没有联网搜索；需要的话在「偏好 → 更多设置」调高单次花费上限后再试")
		}
		return nil, BadAuthRequest("本轮剩余的积分预算不够再搜索一次，没有联网搜索；需要的话在「Agent 设置 → 预算」调高积分上限后再试")
	}
	account, err := s.repo.CreditAccount(userID)
	if err != nil {
		return nil, err
	}
	if account.AvailableMicrocredits < amount {
		return nil, webSearchInsufficientCredits()
	}
	now := time.Now()
	charge.order = &model.BillingOrder{
		ID: newID(), UserID: userID, IdempotencyKey: key, TaskID: state.RuntimeRunID,
		Model: webSearchBillingCode, Capability: webSearchBillingCode, Scene: webSearchBillingCode, BillingMode: "fixed_request",
		UnitPriceMicrocredits: value.PriceMicrocredits, MultiplierBasisPoints: pricing.MultiplierBPS, Quantity: 1,
		AmountMicrocredits: amount, ReservedAmountMicrocredits: amount, ChargeLimitSet: true, ChargeLimitMicrocredits: amount,
		UserGroup: pricing.GroupCode, PriceCurrency: pricing.Currency, CurrencyRateMicrocredits: pricing.RateMicrocredits,
		// 冻结即视为请求在途：订单没有可执行任务，进程若在搜索途中退出，超过 40 分钟会进入待核对队列
		// （开启自动退回时自动退回），不会一直冻结。
		Status: model.BillingStatusRunning, StartedAt: &now,
	}
	return charge, nil
}

// reserveWebSearchCharge 冻结本次搜索的积分；冻结时的原子扣减是余额够不够的最终判断。
func (s *Service) reserveWebSearchCharge(charge *webSearchCharge) error {
	if charge == nil || charge.order == nil || charge.reserved {
		return nil
	}
	if err := s.repo.ReserveBillingOrder(charge.order); err != nil {
		if errors.Is(err, repository.ErrInsufficientCredits) {
			return webSearchInsufficientCredits()
		}
		return err
	}
	charge.reserved = true
	return nil
}

// finishWebSearchCharge 在拿到结果后结算：有结果才扣，没有结果全额退回。
func (s *Service) finishWebSearchCharge(charge *webSearchCharge, found bool) {
	if !found {
		s.releaseWebSearchCharge(charge, "没有搜到结果，积分已退回")
		return
	}
	if charge == nil || charge.order == nil || !charge.reserved {
		return
	}
	order := charge.order
	charge.reserved = false
	if err := s.SettleBilling(order.ID, ""); err != nil {
		// 搜索结果照常交给 Agent；冻结的积分转待核对，由管理员结算或退回。
		log.Printf("[Agent] web search billing settle failed: billing_order_id=%s error=%v", order.ID, err)
		s.markWebSearchChargeUncertain(order.ID, "搜索已完成但积分结算失败，费用待核对")
		return
	}
	charge.charged = order.AmountMicrocredits
}

// releaseWebSearchCharge 退回本次冻结的积分。
func (s *Service) releaseWebSearchCharge(charge *webSearchCharge, reason string) {
	if charge == nil || charge.order == nil || !charge.reserved {
		return
	}
	order := charge.order
	charge.reserved = false
	if err := s.RefundBilling(order.ID, reason); err != nil {
		log.Printf("[Agent] web search billing refund failed: billing_order_id=%s error=%v", order.ID, err)
		// 退款写失败不能当没发生：转待核对，避免订单停在 running 被当成已扣费。
		s.markWebSearchChargeUncertain(order.ID, "积分退回失败，费用待核对")
	}
}

func (s *Service) markWebSearchChargeUncertain(orderID, reason string) {
	if err := s.MarkBillingUncertain(orderID, reason); err != nil {
		log.Printf("[Agent] web search billing uncertainty update failed: billing_order_id=%s error=%v", orderID, err)
	}
}
