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

export function UserAvatar({ user, className, iconClassName, loading }: { user: LocalUser; className?: string; iconClassName?: string; loading?: "eager" | "lazy" }) {
    const [failedUrl, setFailedUrl] = useState("");
    const spirit = user.avatarMode === "default" ? getSpiritAvatar(user.avatarPreset) : undefined;
    const avatarUrl = spirit?.src || (user.avatarMode === "default" ? "" : resolveUserAvatarURL(user.avatarUrl, apiBaseURL));
    const DefaultAvatarIcon = defaultAvatarIcons[isLegacyUserAvatarID(user.avatarPreset) ? user.avatarPreset : "person"];

    return (
        <span data-avatar-kind={spirit ? "spirit" : undefined} className={cn("grid shrink-0 place-items-center overflow-hidden", className, spirit && "rounded-full")}>
            {avatarUrl && avatarUrl !== failedUrl ? (
                <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" decoding="async" loading={loading} onError={() => setFailedUrl(avatarUrl)} />
            ) : (
                <DefaultAvatarIcon className={cn("size-full", iconClassName)} aria-hidden />
            )}
        </span>
    );
}
