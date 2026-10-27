// 首页：参考 leyi.my 的启动页布局——新建画布、工具入口、精选画布、精选灵感。
// Agent 对话创作移到 /create；这里的入口只接已有功能，不自动生成。

import { LoaderCircle, Plus } from "lucide-react";
import type { PointerEvent } from "react";

import { loadCanvasProjectPage } from "@/lib/workspace-route-modules";
import { useCreateBlankCanvas } from "@/pages/create/use-create-blank-canvas";
import { openLoginModal } from "@/stores/use-login-modal-store";

import { HomeFeaturedCanvases } from "./home-featured-canvases";
import { HomeFeaturedInspirations } from "./home-featured-inspirations";
import { HomeToolEntries } from "./home-tool-entries";
import "./home.css";
import { toLayoutPx } from "@/lib/ui-scale";

const requireLogin = () => openLoginModal({ description: "登录后即可新建画布，作品会保存在你的空间" });

export default function HomePage() {
    return (
        <main className="home-page app-workspace-scroll">
            <div className="home-page-inner">
                <HomeNewCanvas />
                <HomeToolEntries onRequireLogin={requireLogin} />
                <HomeFeaturedCanvases />
                <HomeFeaturedInspirations />
            </div>
        </main>
    );
}

function HomeNewCanvas() {
    const { createCanvas, creating, ready } = useCreateBlankCanvas(requireLogin);
    const busy = creating !== null;
    const preload = () => void loadCanvasProjectPage();
    // 光点跟随鼠标：只写 CSS 变量，不触发 React 重新渲染。
    const trackPointer = (event: PointerEvent<HTMLButtonElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        // 指针和 rect 是屏幕像素，写回样式前换成缩放后的 CSS 像素，光斑才贴着鼠标。
        event.currentTarget.style.setProperty("--home-pointer-x", `${toLayoutPx(event.clientX - rect.left)}px`);
        event.currentTarget.style.setProperty("--home-pointer-y", `${toLayoutPx(event.clientY - rect.top)}px`);
    };
    return (
        <button type="button" className="home-new-canvas" onClick={() => void createCanvas()} disabled={!ready || busy} aria-busy={busy} onPointerEnter={preload} onPointerMove={trackPointer} onFocus={preload}>
            <span className="home-new-canvas-glow" aria-hidden="true">
                <span className="home-new-canvas-ripple" />
                <span className="home-new-canvas-ripple is-delayed" />
                <span className="home-new-canvas-spotlight" />
                <span className="home-new-canvas-halo" />
            </span>
            <span className="home-new-canvas-icon" aria-hidden="true">
                {busy ? <LoaderCircle className="animate-spin" /> : <Plus />}
            </span>
            <span className="home-new-canvas-label">{busy ? "正在创建画布…" : "新建画布创作"}</span>
        </button>
    );
}
