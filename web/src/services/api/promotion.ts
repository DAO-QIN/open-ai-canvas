import { compactApiParams, http } from "./request";
import { parsePromotionPolicy } from "@/lib/promotion-policy";

export type PromotionPolicy = ReturnType<typeof parsePromotionPolicy>;
export type PromotionProfile = { userId: string; inviteCode: string | null; paused: boolean; ratioOverrideBps: number | null; version: number };
export type PromotionOverview = {
    policy: PromotionPolicy;
    profile: PromotionProfile;
    effectiveRatioBps: number;
    canPromote: boolean;
    inviteCount: number;
    totalMicrocredits: string;
    frozenMicrocredits: string;
    availableMicrocredits: string;
    transferredMicrocredits: string;
    voidedMicrocredits: string;
    serverTime: string;
};
export type CommissionRecord = {
    id: string;
    paymentOrderId: string;
    inviterId: string;
    baseMicrocredits: string;
    amountMicrocredits: string;
    transferredMicrocredits: string;
    voidedMicrocredits: string;
    ratioBps: number;
    freezeDays: number;
    policyVersion: number;
    profileVersion: number;
    availableAt: string;
    createdAt: string;
    voidReason?: string;
};
export type PromotionTransfer = { id: string; requestId: string; amountMicrocredits: string; createdAt: string };
export type TransferRequest = Pick<PromotionTransfer, "requestId" | "amountMicrocredits">;
export type PromotionInvitation = { id: string; displayName: string; createdAt: string };
export type AdminPromotionProfile = PromotionProfile & { username: string; userStatus: "active" | "disabled" };
export type PromotionPage<T> = { items: T[]; total: number; page: number; pageSize: number };

export function validateInviteCode(code: string, signal?: AbortSignal) {
    return http.get<{ valid: boolean }>(`/public/invite-code/${encodeURIComponent(code)}`, { signal });
}
export function getPromotionOverview(signal?: AbortSignal) {
    return http.get<PromotionOverview>("/promotion/overview", { signal });
}
export function createPromotionCode() {
    return http.post<PromotionProfile>("/promotion/code");
}
export function getPromotionInvitations(page: number, signal?: AbortSignal) {
    return http.get<PromotionPage<PromotionInvitation>>("/promotion/invitations", { params: { page, pageSize: 20 }, signal });
}
export function getPromotionRecords(page: number, signal?: AbortSignal) {
    return http.get<PromotionPage<CommissionRecord>>("/promotion/records", { params: { page, pageSize: 20 }, signal });
}
export function getPromotionTransfers(page: number, signal?: AbortSignal) {
    return http.get<PromotionPage<PromotionTransfer>>("/promotion/transfers", { params: { page, pageSize: 20 }, signal });
}
export function transferPromotion(request: TransferRequest) {
    return http.post<PromotionTransfer>("/promotion/transfers", request);
}
export function getPromotionTransferResult(requestID: string, signal?: AbortSignal) {
    return http.get<PromotionTransfer>(`/promotion/transfers/${encodeURIComponent(requestID)}`, { signal });
}
export async function getAdminPromotionPolicy(signal?: AbortSignal) {
    return parsePromotionPolicy(await http.get<unknown>("/admin/promotion/policy", { signal }));
}
export async function updatePromotionPolicy(policy: PromotionPolicy) {
    return parsePromotionPolicy(await http.put<unknown>("/admin/promotion/policy", parsePromotionPolicy(policy)));
}
export function getAdminPromotionProfiles(keyword: string, page: number, signal?: AbortSignal) {
    return http.get<PromotionPage<AdminPromotionProfile>>("/admin/promotion/profiles", { params: compactApiParams({ keyword, page, pageSize: 20 }), signal });
}
export function updatePromotionProfile(profile: PromotionProfile) {
    return http.put<PromotionProfile>(`/admin/promotion/profiles/${encodeURIComponent(profile.userId)}`, {
        version: profile.version,
        paused: profile.paused,
        ratioOverrideBps: profile.ratioOverrideBps,
    });
}
export function getAdminPromotionRecords(userId: string, page: number, signal?: AbortSignal) {
    return http.get<PromotionPage<CommissionRecord>>("/admin/promotion/records", { params: compactApiParams({ userId, page, pageSize: 20 }), signal });
}
export function voidPromotionCommission(id: string, reason: string) {
    return http.post<{ voided: boolean }>(`/admin/promotion/records/${encodeURIComponent(id)}/void`, { reason });
}
