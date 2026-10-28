export const PROFILE_AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export function profileAvatarError(file: Pick<File, "type" | "size">): string | undefined {
    if (file.type !== "image/png" && file.type !== "image/jpeg") return "请选择 PNG 或 JPEG 图片";
    if (!file.size) return "图片文件不能为空";
    if (file.size > PROFILE_AVATAR_MAX_BYTES) return "图片大小不能超过 5 MB";
}

export function profilePasswordError(password: string): string | undefined {
    if ([...password].length < 8) return "密码至少需要 8 个字符";
    if (new TextEncoder().encode(password).length > 72) return "密码不能超过 72 字节，请缩短密码";
}

export function profileSecondsRemaining(until: number, now: number): number {
    return Math.max(0, Math.ceil((until - now) / 1000));
}

export function profileReauthReady(until: string | undefined, now: number): boolean {
    return !!until && Date.parse(until) > now;
}

export type ProfilePasswordStrength = { level: 0 | 1 | 2 | 3; label: string };

/** 仅用于界面提示，不改变服务端的密码规则。 */
export function profilePasswordStrength(password: string): ProfilePasswordStrength {
    const length = [...password].length;
    if (!length) return { level: 0, label: "" };
    if (length < 8) return { level: 1, label: "太短" };
    const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
    if (length >= 12 && kinds >= 3) return { level: 3, label: "强" };
    if (kinds >= 2) return { level: 2, label: "中" };
    return { level: 1, label: "弱" };
}

/** 页面展示时隐藏邮箱中段，避免在截图或共享屏幕时泄露完整地址。 */
export function maskEmail(email: string): string {
    const at = email.lastIndexOf("@");
    if (at <= 0) return email;
    const name = email.slice(0, at);
    const domain = email.slice(at);
    if (name.length <= 2) return `${name[0]}*${domain}`;
    const keep = name.length <= 5 ? 1 : 3;
    return `${name.slice(0, keep)}${"*".repeat(Math.min(4, Math.max(2, name.length - keep * 2)))}${name.slice(-keep)}${domain}`;
}

/** 账户概览的加入时间：按浏览器本地日期展示，加入当天记为第 1 天。 */
export function profileJoinedLabel(createdAt: string | undefined, now: number): { date: string; days: string } {
    const created = createdAt ? new Date(createdAt) : null;
    if (!created || Number.isNaN(created.getTime())) return { date: "—", days: "" };
    const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const days = Math.max(1, Math.round((startOfDay(new Date(now)) - startOfDay(created)) / 86_400_000) + 1);
    return { date: `${created.getFullYear()}年${created.getMonth() + 1}月${created.getDate()}日`, days: `已加入 ${days.toLocaleString("zh-CN")} 天` };
}
