import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
};

const VALID_THEMES: ThemeName[] = ["light", "dark"];

/** 工作台默认深色。 */
export const DEFAULT_THEME: ThemeName = "dark";

/**
 * 持久化版本：v0 时代默认是浅色，存下来的 "light" 绝大多数只是默认值，
 * 升到 v1 时统一切到深色一次；之后用户再手动选浅色会按 v1 保存并保留。
 * index.html 的首屏脚本按同一规则判断，避免先闪一下浅色。
 */
export const THEME_STORE_VERSION = 1;

export function migrateThemeStore(persisted: unknown, version: number): Partial<ThemeStore> {
    const stored = (persisted || {}) as Partial<ThemeStore>;
    return { ...stored, theme: version < THEME_STORE_VERSION ? DEFAULT_THEME : stored.theme };
}

/** 持久化值校验：旧版本/坏 session 写入的非法值回退到默认深色，避免 canvasThemes[非法值] = undefined 触发 "reading 'node'" 崩溃。 */
export function restoreThemeName(theme: unknown): ThemeName {
    return VALID_THEMES.includes(theme as ThemeName) ? (theme as ThemeName) : DEFAULT_THEME;
}

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: DEFAULT_THEME,
            // 写入前校验：非法 theme 直接忽略，防止 syncRemoteUserData 等路径绕过 merge 写入坏值
            setTheme: (next) => set((state) => (VALID_THEMES.includes(next) ? { theme: next } : state)),
        }),
        {
            name: "yingce:theme_store",
            version: THEME_STORE_VERSION,
            migrate: (persisted, version) => migrateThemeStore(persisted, version) as ThemeStore,
            merge: (persisted, current) => ({ ...current, theme: restoreThemeName((persisted as Partial<ThemeStore> | null)?.theme) }),
        },
    ),
);
