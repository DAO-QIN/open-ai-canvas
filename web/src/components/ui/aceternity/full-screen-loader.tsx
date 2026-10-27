import { useEffect, useState, type ReactNode } from "react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { DotRippleField } from "@/components/ui/aceternity/dot-ripple-field";
import { cn } from "@/lib/utils";

type FullScreenLoaderProps = {
    label?: string;
    detail?: string;
    className?: string;
    action?: ReactNode;
};

export function FullScreenLoader({ label = "正在恢复工作区", detail = "同步账号、模型和项目数据", className, action }: FullScreenLoaderProps) {
    return (
        <div data-full-screen-loader role="status" aria-live="polite" aria-label={`${label}，${detail}`} className={cn("full-screen-loader", className)}>
            <DotRippleField className="full-screen-loader-field" originSelector=".full-screen-loader-mark" quietSelector=".full-screen-loader-copy" />
            <div className="full-screen-loader-content">
                <span className="full-screen-loader-mark" aria-hidden="true">
                    <BrandLogo className="full-screen-loader-logo-image" alt="" fallback={<span className="full-screen-loader-logo-fallback" />} />
                </span>
                <div className="full-screen-loader-copy">
                    <strong>{label}</strong>
                    <span>{detail}</span>
                </div>
                {action ? <div className="full-screen-loader-action">{action}</div> : null}
            </div>
        </div>
    );
}

/** 内容区路由加载：与全屏点阵涟漪同一节奏的点线圆环，短于 140ms 的加载不显示。 */
export function WorkspaceRouteLoader({ label = "正在打开页面" }: { label?: string }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => setVisible(true), 140);
        return () => window.clearTimeout(timer);
    }, []);

    return (
        <section data-workspace-route-loader className={cn("workspace-route-loader", visible && "is-visible")} role="status" aria-live="polite" aria-label={label}>
            <div className="workspace-route-loader-content">
                <span className="workspace-route-loader-mark" aria-hidden="true">
                    <i />
                    <i />
                    <BrandLogo className="workspace-route-loader-logo" alt="" fallback={<span className="full-screen-loader-logo-fallback" />} />
                </span>
                <span>{label}</span>
            </div>
        </section>
    );
}
