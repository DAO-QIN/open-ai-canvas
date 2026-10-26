// 首页「创作工具」入口：参考站的工具栏布局，入口全部接到本站已有功能，不新增生成能力。

import { AudioLines, Clapperboard, FileText, Film, FolderOpen, Image as ImageIcon, LoaderCircle, SlidersHorizontal, Sparkles, type LucideIcon } from "lucide-react";
import { useNavigate } from "react-router";

import { preloadWorkspaceRoute, loadCanvasProjectPage } from "@/lib/workspace-route-modules";
import { useUserStore, type FeatureAvailability } from "@/stores/use-user-store";
import { useCreateBlankCanvas, type CanvasStartNode } from "@/pages/create/use-create-blank-canvas";

export type HomeToolEntry = {
    id: string;
    label: string;
    hint: string;
    icon: LucideIcon;
    /** 打开站内页面；页面本身仍由路由做登录与功能开关校验。 */
    to?: string;
    /** 新建画布并放好第一个节点。 */
    start?: CanvasStartNode;
};

/**
 * 根据后台功能开关决定每个入口去向：
 * - 生图 / 视频工作台关闭时退回到「新画布 + 对应节点」，入口不消失；
 * - 短剧项目关闭时隐藏「短剧 Agent」，避免点进去才提示不可用。
 */
export function buildHomeToolEntries(features: Pick<FeatureAvailability, "shortDramaEnabled" | "imageWorkbenchEnabled" | "videoWorkbenchEnabled">): HomeToolEntry[] {
    const entries: Array<HomeToolEntry | false> = [
        features.shortDramaEnabled && { id: "short-drama", label: "短剧 Agent", hint: "从剧本到分镜的短剧项目", icon: Clapperboard, to: "/projects" },
        features.videoWorkbenchEnabled ? { id: "video", label: "视频生成", hint: "文生视频、图生视频", icon: Film, to: "/toolbox/video" } : { id: "video", label: "视频生成", hint: "新建画布并放好视频节点", icon: Film, start: "video" },
        features.imageWorkbenchEnabled ? { id: "image", label: "图片生成", hint: "文生图、参考图生图", icon: ImageIcon, to: "/toolbox/image" } : { id: "image", label: "图片生成", hint: "新建画布并放好图片节点", icon: ImageIcon, start: "image" },
        { id: "audio", label: "音频创作", hint: "新建画布并放好音频节点", icon: AudioLines, start: "audio" },
        { id: "script", label: "剧本生成", hint: "新建画布并放好剧本节点", icon: FileText, start: "script" },
        { id: "assets", label: "素材管理", hint: "上传和整理图片、视频、音频", icon: FolderOpen, to: "/assets" },
        { id: "skills", label: "提示词技能", hint: "常用提示词与创作技能", icon: Sparkles, to: "/skills" },
        { id: "models", label: "模型设置", hint: "按图片、视频、文本选默认模型", icon: SlidersHorizontal, to: "/settings?section=models" },
    ];
    return entries.filter((entry): entry is HomeToolEntry => Boolean(entry));
}

export function HomeToolEntries({ onRequireLogin }: { onRequireLogin: () => void }) {
    const navigate = useNavigate();
    const features = useUserStore((state) => state.features);
    const { createCanvas, creating, ready, signedIn } = useCreateBlankCanvas(onRequireLogin);
    const entries = buildHomeToolEntries(features);

    const open = (entry: HomeToolEntry) => {
        // 所有入口都需要登录；游客统一在首页弹出登录框，而不是跳到登录页后丢失首页位置。
        if (!signedIn) {
            onRequireLogin();
            return;
        }
        if (entry.start) void createCanvas(entry.start);
        else if (entry.to) navigate(entry.to);
    };
    const preload = (entry: HomeToolEntry) => {
        if (entry.start) void loadCanvasProjectPage();
        else if (entry.to) preloadWorkspaceRoute(entry.to.split("?")[0]);
    };

    return (
        <nav className="home-tool-entries" aria-label="创作工具">
            <ul>
                {entries.map((entry) => {
                    const Icon = entry.icon;
                    const busy = Boolean(entry.start && creating === entry.start);
                    return (
                        <li key={entry.id}>
                            <button
                                type="button"
                                className="home-tool-entry"
                                title={entry.hint}
                                aria-busy={busy}
                                disabled={Boolean(entry.start) && (!ready || creating !== null)}
                                onClick={() => open(entry)}
                                onPointerEnter={() => preload(entry)}
                                onFocus={() => preload(entry)}
                            >
                                <span className="home-tool-entry-icon" aria-hidden="true">
                                    {busy ? <LoaderCircle className="animate-spin" /> : <Icon strokeWidth={1.6} />}
                                </span>
                                <span className="home-tool-entry-label">{busy ? "正在创建…" : entry.label}</span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
