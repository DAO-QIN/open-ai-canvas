// 创作页背景层：空态是点阵加月光（和加载动画同一套点距与节奏），对话中取最新一组结果的颜色。
// 两层都是纯装饰（aria-hidden），只用 CSS 绘制，不常驻逐帧动画。

import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { usableResultUrl } from "./creation-result-urls";
import type { CreationMessage } from "./creation-types";
import "./creation-backdrops.css";

/** 空态背景：22px 点阵只在上半屏可见，顶部一团中性冷白的光；进页面时从标题处扩散一圈涟漪后静止。 */
export function CreationLaunchBackdrop() {
    return (
        <div className="creation-launch-backdrop" aria-hidden="true">
            <span className="creation-launch-moonlight" />
            <span className="creation-launch-dots" />
            <span className="creation-launch-ripple" />
        </div>
    );
}

/**
 * 对话里最新一张已完成的结果图，用作背景色。资源图走 `variant=thumbnail`（缩略图未就绪时后端回退原图），
 * 不额外请求签名地址；没有可用结果时返回空串。
 */
export function latestCreationResultImage(messages: readonly CreationMessage[]): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== "assistant" || message.mode === "video" || message.status === "error" || message.status === "cancelled") continue;
        const keys = message.resultStorageKeys || [];
        for (const key of keys) {
            const id = resourceIdFromStorageKey(key);
            if (id) return `${resourceFileUrl(id)}?variant=thumbnail`;
        }
        for (const url of message.resultUrls || []) {
            const usable = usableResultUrl(url);
            if (usable) return usable;
        }
    }
    return "";
}

/** 对话中背景：结果图放大、重度模糊、低透明度，往下渐隐；换一组结果时淡入新的颜色。 */
export function CreationAmbientBackdrop({ url }: { url: string }) {
    if (!url) return null;
    return (
        <div className="creation-ambient" aria-hidden="true">
            <img key={url} src={url} alt="" decoding="async" />
        </div>
    );
}
