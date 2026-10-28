import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { browserTimezoneOffset } from "@/lib/credit-usage";
import { getCreditUsage } from "@/services/api/wallet";

// 看板数据按天聚合，一分钟内重复进入不再请求；用户可在看板里手动刷新。
const CREDIT_USAGE_STALE_TIME_MS = 60_000;

export const creditUsageQueryKey = (userId: string, timezoneOffset: number) => ["credit-usage", userId, timezoneOffset] as const;

/** 当前用户最近 365 天的积分用量；个人信息与用量看板共用同一份缓存。 */
export function useCreditUsage(userId?: string, enabled = true) {
    const timezoneOffset = useMemo(() => browserTimezoneOffset(), []);
    return useQuery({
        queryKey: creditUsageQueryKey(userId || "", timezoneOffset),
        queryFn: ({ signal }) => getCreditUsage(timezoneOffset, signal),
        enabled: Boolean(userId) && enabled,
        staleTime: CREDIT_USAGE_STALE_TIME_MS,
        refetchOnWindowFocus: false,
        retry: false,
    });
}
