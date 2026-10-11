import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { getPromotionOverview } from "@/services/api/promotion";
import { useUserStore } from "@/stores/use-user-store";

/** Page, breadcrumb and account menus share one account-scoped read. */
export function usePromotionOverview(userId?: string, enabled = true) {
    const query = useQuery({
        queryKey: ["promotion", userId, "overview"],
        enabled: Boolean(userId) && enabled,
        queryFn: async ({ signal }) => {
            const overview = await getPromotionOverview(signal);
            if (overview.profile.userId !== userId) throw new Error("邀请奖励与当前用户不一致");
            return overview;
        },
        staleTime: 0,
        refetchOnWindowFocus: true,
    });

    useEffect(() => {
        if (!enabled || query.isFetching || query.error || !query.data) return;
        const store = useUserStore.getState();
        if (store.user?.id !== userId || store.features.promotionEnabled === query.data.policy.enabled) return;
        store.setFeatures({ ...store.features, promotionEnabled: query.data.policy.enabled });
    }, [enabled, query.data, query.error, query.isFetching, userId]);

    return query;
}
