import { formatCredits } from "@/constant/credits";

/**
 * 联网工具（web_search / web_fetch）的展示口径，首页创作与画布助手共用。
 *
 * 只读事件载荷，不依赖组件：tool_started 带后端截断过的 query / url；结束事件的 result 是工具回执，
 * 扣费金额 chargedMicrocredits 由后端放在事件上（不进模型上下文），复用结果或免费时没有这一项。
 */

/** 一条联网来源，只保留展示需要的字段；链接只接受 http(s)。 */
export type AgentWebSource = { title: string; url: string; siteName?: string };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const httpURL = (value: string) => /^https?:\/\//i.test(value);

export function isAgentWebTool(toolName: string) {
    return toolName === "web_search" || toolName === "web_fetch";
}

export function agentWebHost(value: string) {
    try {
        return new URL(value).hostname.replace(/^www\./, "");
    } catch {
        return "";
    }
}

/** 执行期间的一行：搜索带关键词，读取网页带站点；不是联网工具时返回 undefined。 */
export function agentWebToolRunningLabel(toolName: string, payload: unknown = {}): string | undefined {
    const fields = record(payload);
    if (toolName === "web_search") {
        const query = text(fields.query);
        return query ? `正在联网搜索「${query}」` : "正在联网搜索";
    }
    if (toolName === "web_fetch") {
        const host = agentWebHost(text(fields.url));
        return host ? `正在阅读网页 ${host}` : "正在阅读网页";
    }
    return undefined;
}

/** 本次搜索实际扣的积分（微积分）；没有扣费时为 0。 */
export function agentWebSearchCharged(payload: unknown) {
    const charged = record(payload).chargedMicrocredits;
    return typeof charged === "number" && Number.isSafeInteger(charged) && charged > 0 ? charged : 0;
}

/** 成功时的一行说明：搜索写关键词、来源数（扣了积分再写消耗），读取网页写标题或站点。 */
export function agentWebToolDetail(toolName: string, payload: unknown): string | undefined {
    const result = record(record(payload).result);
    if (toolName === "web_search") {
        const query = text(result.query);
        const count = Array.isArray(result.results) ? result.results.length : 0;
        const charged = agentWebSearchCharged(payload);
        return [query ? `「${query}」` : "", count ? `${count} 个来源` : "未找到相关资料", charged ? `消耗 ${formatCredits(charged)} 积分` : ""].filter(Boolean).join(" · ");
    }
    if (toolName === "web_fetch") {
        const address = text(result.finalUrl) || text(result.url);
        return text(result.title) || agentWebHost(address) || address || undefined;
    }
    return undefined;
}

/** 成功时的来源：搜索给出结果列表（最多 10 条），读取网页给出这一页。 */
export function agentWebSources(toolName: string, payload: unknown): AgentWebSource[] | undefined {
    const result = record(record(payload).result);
    if (toolName === "web_fetch") {
        const url = text(result.finalUrl) || text(result.url);
        if (!httpURL(url)) return undefined;
        const siteName = text(result.siteName);
        return [{ title: text(result.title) || agentWebHost(url) || url, url, ...(siteName ? { siteName } : {}) }];
    }
    if (toolName !== "web_search" || !Array.isArray(result.results)) return undefined;
    const sources = result.results
        .flatMap((item): AgentWebSource[] => {
            const entry = record(item);
            const url = text(entry.url);
            if (!httpURL(url)) return [];
            const siteName = text(entry.siteName);
            return [{ title: text(entry.title) || url, url, ...(siteName ? { siteName } : {}) }];
        })
        .slice(0, 10);
    return sources.length ? sources : undefined;
}
