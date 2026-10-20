export const LEGACY_USER_AVATARS = [
    { id: "person", label: "默认人像" },
    { id: "director", label: "导演" },
    { id: "camera", label: "摄影师" },
    { id: "cat", label: "小猫" },
    { id: "rabbit", label: "小兔" },
    { id: "robot", label: "机器人" },
    { id: "rocket", label: "探索者" },
    { id: "sparkles", label: "灵感" },
] as const;

export type LegacyUserAvatarID = (typeof LEGACY_USER_AVATARS)[number]["id"];

export const DEFAULT_USER_AVATARS = Array.from({ length: 48 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return { id: `spirit-v1-${number}`, label: `灵感伙伴 ${number}`, src: `/avatars/spirit-v1/spirit-v1-${number}.svg` };
});

export type DefaultUserAvatarID = LegacyUserAvatarID | `spirit-v1-${string}`;

export function getSpiritAvatar(value: unknown) {
    return DEFAULT_USER_AVATARS.find((avatar) => avatar.id === value);
}

export function isLegacyUserAvatarID(value: unknown): value is LegacyUserAvatarID {
    return LEGACY_USER_AVATARS.some((avatar) => avatar.id === value);
}

export function isDefaultUserAvatarID(value: unknown): value is DefaultUserAvatarID {
    return isLegacyUserAvatarID(value) || !!getSpiritAvatar(value);
}
