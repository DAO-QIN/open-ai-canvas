import { create } from "zustand";

// 启动阻塞阶段，顺序与 AuthSessionHydrator → applyUserSession → ClientRootInit 一致。
export const STARTUP_STEPS = [
    { id: "account", label: "账号" },
    { id: "workspace", label: "项目" },
    { id: "environment", label: "环境" },
] as const;

export type StartupStep = (typeof STARTUP_STEPS)[number]["id"];

type StartupProgressStore = {
    step: StartupStep | null;
    setStep: (step: StartupStep | null) => void;
};

export const useStartupProgressStore = create<StartupProgressStore>((set) => ({
    step: null,
    setStep: (step) => set({ step }),
}));
