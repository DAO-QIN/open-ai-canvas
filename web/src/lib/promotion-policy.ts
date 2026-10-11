export function parsePromotionPolicy(value: unknown) {
    if (!value || typeof value !== "object") throw new Error("邀请返利配置响应无效，请重新读取");
    const policy = value as Record<string, unknown>;
    const { enabled, ratioBps, freezeDays, version } = policy;
    if (
        typeof enabled !== "boolean" ||
        typeof ratioBps !== "number" ||
        !Number.isSafeInteger(ratioBps) ||
        ratioBps < 0 ||
        ratioBps > 10000 ||
        typeof freezeDays !== "number" ||
        !Number.isSafeInteger(freezeDays) ||
        freezeDays < 0 ||
        freezeDays > 365 ||
        typeof version !== "number" ||
        !Number.isSafeInteger(version) ||
        version < 0
    )
        throw new Error("邀请返利配置不完整或超出范围，请重新读取");
    return { enabled, ratioBps, freezeDays, version };
}
