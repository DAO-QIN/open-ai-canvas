import { create } from "zustand";

import { DEFAULT_DRAWING_ENGINE, type CanvasDrawingEngineSetting } from "@/lib/canvas/canvas-drawing-engine";
import type { PublicUserGroup } from "@/services/api/user-groups";

export type LocalUser = {
    id: string;
    username: string;
    email?: string;
    phone?: string;
    emailVerifiedAt?: string;
    phoneVerifiedAt?: string;
    displayName: string;
    avatarUrl?: string;
    avatarMode?: "custom" | "default" | "";
    avatarPreset?: string;
    identityProvider?: string;
    identityId?: string;
    identityUsername?: string;
    role: "admin" | "user";
    status: "active" | "disabled";
    userGroup?: string;
    lastLoginAt?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type RuntimeLimits = {
    activeTaskLimit: number;
    resourceUploadMB: number;
    recycleBinRetentionDays?: number;
    conversationRetentionDays?: number;
};

export type FeatureAvailability = {
    promotionEnabled?: boolean;
    welcomeEnabled: boolean;
    shortDramaEnabled: boolean;
    taskCenterEnabled: boolean;
    creditsEnabled: boolean;
    customChannelsEnabled: boolean;
    frontendModelsEnabled: boolean;
    pluginCenterEnabled: boolean;
    systemPluginsVisibleToUsers: boolean;
    inspirationSourcesVisible: boolean;
    imageWorkbenchEnabled: boolean;
    videoWorkbenchEnabled: boolean;
    configured?: boolean;
    updatedBy?: string;
    updatedAt?: string;
};

export const defaultFeatureAvailability: FeatureAvailability = {
    promotionEnabled: false,
    welcomeEnabled: true,
    shortDramaEnabled: true,
    taskCenterEnabled: true,
    creditsEnabled: true,
    customChannelsEnabled: true,
    frontendModelsEnabled: false,
    pluginCenterEnabled: true,
    systemPluginsVisibleToUsers: true,
    inspirationSourcesVisible: true,
    imageWorkbenchEnabled: false,
    videoWorkbenchEnabled: false,
};

type UserStore = {
    hydrated: boolean;
    user: LocalUser | null;
    runtimeLimits: RuntimeLimits;
    drawingEngine: CanvasDrawingEngineSetting;
    features: FeatureAvailability;
    /** 当前账号分组的展示信息（徽章、折扣）；由会话接口下发。 */
    userGroup: PublicUserGroup | null;
    /** 平台已开启联网搜索（管理员配置完整）；创作页「偏好」与画布助手「Agent 设置」据此显示「联网搜索」开关。 */
    webSearchEnabled: boolean;
    /** 当前账号每次联网搜索实际扣的积分（微积分，已按分组折算）；null 表示免费、未开启或暂时算不出，不显示价格。 */
    webSearchPriceMicrocredits: number | null;
    setUser: (user: LocalUser | null) => void;
    setRuntimeLimits: (limits?: RuntimeLimits) => void;
    setDrawingEngine: (setting?: CanvasDrawingEngineSetting) => void;
    setFeatures: (features?: FeatureAvailability) => void;
    setUserGroup: (group?: PublicUserGroup | null) => void;
    setWebSearchEnabled: (enabled: boolean) => void;
    setWebSearchPriceMicrocredits: (price?: number | null) => void;
    setHydrated: (hydrated: boolean) => void;
    clearSession: () => void;
};

export const useUserStore = create<UserStore>()((set) => ({
    hydrated: false,
    user: null,
    runtimeLimits: { activeTaskLimit: 5, resourceUploadMB: 50, recycleBinRetentionDays: 30 },
    drawingEngine: { defaultEngine: DEFAULT_DRAWING_ENGINE },
    features: defaultFeatureAvailability,
    userGroup: null,
    webSearchEnabled: false,
    webSearchPriceMicrocredits: null,
    setUser: (user) => set({ user }),
    setRuntimeLimits: (runtimeLimits) => set({ runtimeLimits: runtimeLimits || { activeTaskLimit: 5, resourceUploadMB: 50, recycleBinRetentionDays: 30 } }),
    setDrawingEngine: (drawingEngine) => set({ drawingEngine: drawingEngine || { defaultEngine: DEFAULT_DRAWING_ENGINE } }),
    setFeatures: (features) => set({ features: features ? { ...defaultFeatureAvailability, ...features } : defaultFeatureAvailability }),
    setUserGroup: (userGroup) => set({ userGroup: userGroup || null }),
    setWebSearchEnabled: (webSearchEnabled) => set({ webSearchEnabled }),
    // 只接受服务端给出的正整数微积分；其他值一律不显示价格，避免把异常值展示成"免费"或错误金额。
    setWebSearchPriceMicrocredits: (price) => set({ webSearchPriceMicrocredits: typeof price === "number" && Number.isSafeInteger(price) && price > 0 ? price : null }),
    setHydrated: (hydrated) => set({ hydrated }),
    clearSession: () =>
        set({
            user: null,
            runtimeLimits: { activeTaskLimit: 5, resourceUploadMB: 50, recycleBinRetentionDays: 30 },
            drawingEngine: { defaultEngine: DEFAULT_DRAWING_ENGINE },
            features: defaultFeatureAvailability,
            userGroup: null,
            webSearchEnabled: false,
            webSearchPriceMicrocredits: null,
        }),
}));
