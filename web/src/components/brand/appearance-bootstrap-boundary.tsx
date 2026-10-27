import type { ReactNode } from "react";

import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { bootstrapAppearance } from "@/services/appearance-bootstrap";
import { useAppearanceStore } from "@/stores/use-appearance-store";

export function AppearanceBootstrapBoundary({ children }: { children: ReactNode }) {
    const resolved = useAppearanceStore((state) => state.resolved);
    const loadFailed = useAppearanceStore((state) => state.loadFailed);
    if (resolved) return children;
    return (
        <FullScreenLoader
            label={loadFailed ? "暂时无法加载站点配置" : "正在加载站点配置"}
            detail={loadFailed ? "请重试后继续" : "确认品牌与页面外观"}
            action={
                loadFailed ? (
                    <button type="button" className="rounded-md border border-border bg-background px-4 py-2 text-sm" onClick={() => void bootstrapAppearance().catch(() => undefined)}>
                        重试
                    </button>
                ) : undefined
            }
        />
    );
}
