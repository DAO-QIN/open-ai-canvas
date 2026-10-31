import { useState } from "react";
import { Bot, Camera, Cat, CircleUserRound, Clapperboard, Rabbit, Rocket, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSpiritAvatar, isLegacyUserAvatarID, type LegacyUserAvatarID } from "@/lib/default-user-avatars";
import { resolveUserAvatarURL } from "@/lib/user-avatar-url";
import { apiBaseURL } from "@/services/api/request";
import type { LocalUser } from "@/stores/use-user-store";

const defaultAvatarIcons: Record<LegacyUserAvatarID, LucideIcon> = {
    person: CircleUserRound,
    director: Clapperboard,
    camera: Camera,
    cat: Cat,
    rabbit: Rabbit,
    robot: Bot,
    rocket: Rocket,
    sparkles: Sparkles,
};

/** 头像图片地址：精灵预设图或上传头像；旧版图标预设没有图片，返回空字符串。 */
export function userAvatarImageURL(user: LocalUser) {
    const spirit = user.avatarMode === "default" ? getSpiritAvatar(user.avatarPreset) : undefined;
    return spirit?.src || (user.avatarMode === "default" ? "" : resolveUserAvatarURL(user.avatarUrl, apiBaseURL));
}

export function UserAvatar({ user, className, iconClassName, loading }: { user: LocalUser; className?: string; iconClassName?: string; loading?: "eager" | "lazy" }) {
    const [failedUrl, setFailedUrl] = useState("");
    const spirit = user.avatarMode === "default" ? getSpiritAvatar(user.avatarPreset) : undefined;
    const avatarUrl = userAvatarImageURL(user);
    const showImage = !!avatarUrl && avatarUrl !== failedUrl;
    const DefaultAvatarIcon = defaultAvatarIcons[isLegacyUserAvatarID(user.avatarPreset) ? user.avatarPreset : "person"];

    return (
        // 图片头像（上传或精灵预设）一律圆形，排在 className 之后以压过调用方的圆角类；
        // 图标兜底的外形仍由调用方决定：旧版图标铺满方框，整体裁圆会切掉边角。
        <span data-avatar-kind={spirit ? "spirit" : undefined} className={cn("grid shrink-0 place-items-center overflow-hidden", className, showImage && "rounded-full")}>
            {showImage ? (
                <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" decoding="async" loading={loading} onError={() => setFailedUrl(avatarUrl)} />
            ) : (
                <DefaultAvatarIcon className={cn("size-full", iconClassName)} aria-hidden />
            )}
        </span>
    );
}
