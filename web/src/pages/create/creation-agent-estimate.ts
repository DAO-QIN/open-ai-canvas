import { useEffect, useMemo, useState } from "react";

import { modelQuoteRequest, requestCreditCost } from "@/lib/model-pricing";
import { quoteModel } from "@/services/api/logical-models";
import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

/** 点发送即同意"预估 × 1.2"以内的消耗；超出时对话里才出现确认（创作页优化方案 5.7）。 */
export const CREATION_AGENT_PREAUTHORIZATION_FACTOR = 1.2;

/**
 * 自动模式发送前的预估：按当前图片模型出 1 张图的价格。优先用服务端报价，拿不到时用本地价格表；
 * 都没有时返回 null，界面不显示预估，服务端也不预授权（每个生成方案都要确认）。
 */
export function useCreationAgentEstimate(config: AiConfig, imageModel: string | undefined, enabled: boolean) {
    const model = enabled ? imageModel?.trim() || "" : "";
    const imageConfig = useMemo(() => (model ? { ...config, model, imageModel: model, count: "1" } : null), [config, model]);
    const request = useMemo(() => (imageConfig ? modelQuoteRequest(imageConfig, model, "image") : undefined), [imageConfig, model]);
    const fallback = useMemo(() => {
        if (!imageConfig) return null;
        const channel = resolveModelChannel(imageConfig, model);
        return requestCreditCost({ channelMode: channel.scope === "system" ? "remote" : "local", modelCosts: channel.modelCosts, model: modelOptionName(model), count: 1, capability: "image", config: imageConfig });
    }, [imageConfig, model]);
    const requestKey = request ? JSON.stringify(request) : "";
    const [quoted, setQuoted] = useState<{ key: string; credits: number } | null>(null);
    useEffect(() => {
        if (!request) return;
        const controller = new AbortController();
        quoteModel(request, controller.signal)
            .then(({ quote }) => {
                if (!controller.signal.aborted) setQuoted({ key: requestKey, credits: quote.amountMicrocredits / 1_000_000 });
            })
            .catch(() => undefined);
        return () => controller.abort();
        // requestKey 已覆盖 request 的内容；request 对象本身每次渲染都可能是新引用。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requestKey]);
    if (!model) return null;
    return quoted?.key === requestKey ? quoted.credits : fallback;
}

/** 发送时的预授权额度：预估 × 1.2，保留 4 位小数，不超过本轮积分上限；没有预估时为 0。 */
export function creationAgentPreauthorizedCredits(estimate: number | null | undefined, maxCredits: number) {
    if (!estimate || !Number.isFinite(estimate) || estimate <= 0 || !(maxCredits > 0)) return 0;
    return Math.min(maxCredits, Math.round(estimate * CREATION_AGENT_PREAUTHORIZATION_FACTOR * 10000) / 10000);
}
