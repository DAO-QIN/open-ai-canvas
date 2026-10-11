import { ArrowDownLeft, Coins, UserRound } from "lucide-react";
import { StatusBadge } from "@/components/ui/base/badges/status-badge";
import { commissionRemaining, formatPromotionCredits as credits } from "@/lib/promotion-credits";
import type { CommissionRecord, PromotionInvitation, PromotionTransfer } from "@/services/api/promotion";
import { commissionStatus, promotionDate } from "./presentation";

export function InvitationItem({ invitation }: { invitation: PromotionInvitation }) {
    return (
        <li className="promotion-record-item">
            <div className="promotion-record-main">
                <span className="promotion-record-icon">
                    <UserRound aria-hidden />
                </span>
                <div className="promotion-record-copy">
                    <strong>{invitation.displayName}</strong>
                    <span>注册于 {promotionDate(invitation.createdAt)}</span>
                </div>
                <StatusBadge label="已加入" />
            </div>
        </li>
    );
}

export function CommissionItem({ record, serverNow }: { record: CommissionRecord; serverNow: number }) {
    const status = commissionStatus(record, serverNow);
    const remaining = commissionRemaining(record);
    return (
        <li className="promotion-record-item">
            <div className="promotion-record-main">
                <span className="promotion-record-icon">
                    <Coins aria-hidden />
                </span>
                <div className="promotion-record-copy">
                    <strong>
                        好友充值返利 <StatusBadge tone={status.tone} label={status.label} />
                    </strong>
                    <span>
                        充值到账 {credits(record.baseMicrocredits)} 积分 × {record.ratioBps / 100}%
                    </span>
                </div>
                <strong className="promotion-record-amount">
                    +{credits(record.amountMicrocredits)} <small>积分</small>
                </strong>
            </div>
            <div className="promotion-record-meta">
                <span>获得于 {promotionDate(record.createdAt)}</span>
                {remaining > BigInt(0) ? (
                    <span>
                        {status.label === "待解锁" ? "解锁于" : status.label === "待确认" ? "解锁时间待确认" : "已解锁"} {promotionDate(record.availableAt)}
                    </span>
                ) : null}
                <details className="promotion-receipt">
                    <summary>查看明细</summary>
                    <dl>
                        <div>
                            <dt>充值订单</dt>
                            <dd>{record.paymentOrderId}</dd>
                        </div>
                        <div>
                            <dt>获得返利</dt>
                            <dd>{credits(record.amountMicrocredits)} 积分</dd>
                        </div>
                        <div>
                            <dt>{status.label === "待解锁" ? "待解锁" : "剩余返利"}</dt>
                            <dd>{credits(remaining.toString())} 积分</dd>
                        </div>
                        <div>
                            <dt>已转入积分</dt>
                            <dd>{credits(record.transferredMicrocredits)} 积分</dd>
                        </div>
                    </dl>
                </details>
            </div>
        </li>
    );
}

export function TransferItem({ transfer }: { transfer: PromotionTransfer }) {
    return (
        <li className="promotion-record-item">
            <div className="promotion-record-main">
                <span className="promotion-record-icon">
                    <ArrowDownLeft aria-hidden />
                </span>
                <div className="promotion-record-copy">
                    <strong>
                        返利转入积分 <StatusBadge tone="success" label="已到账" />
                    </strong>
                    <span>{promotionDate(transfer.createdAt)}</span>
                </div>
                <strong className="promotion-record-amount">
                    {credits(transfer.amountMicrocredits)} <small>积分</small>
                </strong>
            </div>
            <details className="promotion-receipt promotion-transfer-receipt">
                <summary>转入凭证</summary>
                <dl>
                    <div>
                        <dt>凭证编号</dt>
                        <dd>{transfer.id}</dd>
                    </div>
                </dl>
            </details>
        </li>
    );
}
