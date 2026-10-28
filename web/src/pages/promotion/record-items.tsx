import { commissionRemaining, formatPromotionCredits as credits } from "@/lib/promotion-credits";
import type { CommissionRecord, PromotionInvitation, PromotionTransfer } from "@/services/api/promotion";
import { commissionStatus, promotionDateParts } from "./presentation";

function When({ value }: { value: string }) {
    const { day, time } = promotionDateParts(value);
    return (
        <time className="promotion-when" dateTime={value}>
            <b>{day}</b>
            <span>{time}</span>
        </time>
    );
}

export function InvitationItem({ invitation }: { invitation: PromotionInvitation }) {
    return (
        <li className="promotion-ledger-row">
            <When value={invitation.createdAt} />
            <div className="promotion-ledger-what">
                <b>{invitation.displayName}</b>
                <span>通过你的邀请加入</span>
            </div>
            <span className="promotion-state is-done">
                <i aria-hidden />
                已加入
            </span>
            <span className="promotion-ledger-value is-dim" aria-hidden>
                —
            </span>
        </li>
    );
}

export function CommissionItem({ record, serverNow }: { record: CommissionRecord; serverNow: number }) {
    const status = commissionStatus(record, serverNow);
    const remaining = commissionRemaining(record);
    return (
        <li className="promotion-ledger-row">
            <When value={record.createdAt} />
            <div className="promotion-ledger-what">
                <b>好友充值奖励</b>
                <span>
                    到账 {credits(record.baseMicrocredits)} 积分 × {record.ratioBps / 100}%
                </span>
                <details className="promotion-receipt">
                    <summary>明细</summary>
                    <dl>
                        <div>
                            <dt>充值订单</dt>
                            <dd>{record.paymentOrderId}</dd>
                        </div>
                        <div>
                            <dt>获得奖励</dt>
                            <dd>{credits(record.amountMicrocredits)} 积分</dd>
                        </div>
                        <div>
                            <dt>{status.state === "pending" ? "待到账" : "剩余奖励"}</dt>
                            <dd>{credits(remaining.toString())} 积分</dd>
                        </div>
                        <div>
                            <dt>已领取</dt>
                            <dd>{credits(record.transferredMicrocredits)} 积分</dd>
                        </div>
                    </dl>
                </details>
            </div>
            <span className={`promotion-state is-${status.state}`}>
                <i aria-hidden />
                {status.label}
            </span>
            <b className={status.state === "done" ? "promotion-ledger-value is-dim" : "promotion-ledger-value"}>+{credits(record.amountMicrocredits)}</b>
        </li>
    );
}

export function TransferItem({ transfer }: { transfer: PromotionTransfer }) {
    return (
        <li className="promotion-ledger-row">
            <When value={transfer.createdAt} />
            <div className="promotion-ledger-what">
                <b>领进钱包</b>
                <span>1:1 存入积分钱包</span>
                <details className="promotion-receipt">
                    <summary>凭证</summary>
                    <dl>
                        <div>
                            <dt>凭证编号</dt>
                            <dd>{transfer.id}</dd>
                        </div>
                    </dl>
                </details>
            </div>
            <span className="promotion-state is-done">
                <i aria-hidden />
                已到账
            </span>
            <b className="promotion-ledger-value is-dim">{credits(transfer.amountMicrocredits)}</b>
        </li>
    );
}
