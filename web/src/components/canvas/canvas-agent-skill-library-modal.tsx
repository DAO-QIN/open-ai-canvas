import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Input } from "antd";
import { Check, CircleAlert, LoaderCircle, Plus, Search, Users, Blocks } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import type { Skill, SkillCategory, SkillLibraryCategory } from "@/services/api/skills";
import { curationIcon, matchesCuration, effectiveCurationRoot, type useSkillCuration } from "@/components/skills/skill-curation-browser";
import { AGENT_PINNED_SKILL_LIMIT } from "./canvas-cloud-agent-settings";

type SkillLibraryTab = "enabled" | "installed" | "market";

/** canvas 是画布助手：技能固定到对话。creation 是首页创作：技能标签插进提示词。 */
export type SkillLibrarySurface = "canvas" | "creation";

/** 已加入、但当前入口不能选的技能：按钮置灰，label 写在按钮上，reason 放进按钮提示。 */
export type SkillSelectionBlock = { label: string; reason: string };

type SurfaceCopy = {
    selectedCount: string;
    select: string;
    selected: string;
    selectTitle: string;
    selectedTitle: string;
    coverSelected: string;
    limitTitle: (limit: number) => string;
    countAria: (count: number, limit: number) => string;
    emptySelected: string;
    emptySelectedFiltered: string;
    footerSelected: (count: number) => string;
    footerInstalled: (count: number) => string;
    footerLimit: (limit: number) => string;
};

const SURFACE_COPY: Record<SkillLibrarySurface, SurfaceCopy> = {
    canvas: {
        selectedCount: "已固定",
        select: "固定",
        selected: "已固定",
        selectTitle: "固定后本对话优先使用；不固定 Agent 也会按任务自动查找",
        selectedTitle: "固定后本对话优先使用；不固定 Agent 也会按任务自动查找",
        coverSelected: "本对话已固定",
        limitTitle: (limit) => `每个对话最多固定 ${limit} 个 Skills`,
        countAria: (count, limit) => `查看本对话已固定的 ${count} 个技能，最多 ${limit} 个`,
        emptySelected: "还没有固定技能。已安装的技能 Agent 会按任务自动查找，需要指定时再在“我的技能”里固定",
        emptySelectedFiltered: "没有匹配的已固定技能",
        footerSelected: (count) => `${count} 个技能在本对话优先使用`,
        footerInstalled: (count) => `${count} 个已加入技能，Agent 会按任务自动查找`,
        footerLimit: (limit) => `最多固定 ${limit} 个`,
    },
    creation: {
        selectedCount: "已选",
        select: "使用",
        selected: "已选",
        selectTitle: "插到提示词末尾，发送时本轮使用",
        selectedTitle: "已在提示词里，再点一次取消",
        coverSelected: "已选",
        limitTitle: (limit) => `最多同时使用 ${limit} 个技能`,
        countAria: (count, limit) => `查看已选的 ${count} 个技能，最多 ${limit} 个`,
        emptySelected: "还没有选技能。在“我的技能”里点“使用”，技能会插到提示词末尾",
        emptySelectedFiltered: "没有匹配的已选技能",
        footerSelected: (count) => `${count} 个已选技能，发送时本轮使用`,
        footerInstalled: (count) => `${count} 个已加入技能，点“使用”插到提示词末尾`,
        footerLimit: (limit) => `最多同时使用 ${limit} 个`,
    },
};

type CanvasAgentSkillLibraryModalProps = {
    curationState: ReturnType<typeof useSkillCuration>;
    platformCategory: string;
    onPlatformCategoryChange: (value: string) => void;
    open: boolean;
    theme: CanvasTheme;
    installedSkills: Skill[];
    marketSkills: Skill[];
    selectedSkillIds: string[];
    categories: SkillCategory[];
    libraryCategories: SkillLibraryCategory[];
    category: string;
    search: string;
    loading: boolean;
    hasMore: boolean;
    /** 默认 canvas；creation 换成首页创作的文案（点「使用」插进提示词）。 */
    surface?: SkillLibrarySurface;
    /** 最多能选几个，默认是画布对话的固定上限。 */
    selectionLimit?: number;
    /** 已加入、但当前入口不能选的技能；返回值决定置灰按钮的文字和提示。 */
    getSelectionBlock?: (skill: Skill) => SkillSelectionBlock | undefined;
    /** 公开技能读取失败：列表为空时显示错误和「重试」，已有列表时写在底部；出错期间不自动加载下一页。 */
    error?: string;
    onRetry?: () => void;
    onClose: () => void;
    onCategoryChange: (value: string) => void;
    onSearch: (value: string) => void;
    onToggle: (skillId: string) => void;
    onInstall: (skill: Skill) => Promise<void>;
    onLoadMore: () => Promise<void>;
};

export function CanvasAgentSkillLibraryModal({
    curationState, platformCategory, onPlatformCategoryChange,
    open,
    theme,
    installedSkills,
    marketSkills,
    selectedSkillIds,
    categories,
    libraryCategories,
    category,
    search,
    loading,
    hasMore,
    surface = "canvas",
    selectionLimit = AGENT_PINNED_SKILL_LIMIT,
    getSelectionBlock,
    error,
    onRetry,
    onClose,
    onCategoryChange,
    onSearch,
    onToggle,
    onInstall,
    onLoadMore,
}: CanvasAgentSkillLibraryModalProps) {
    const copy = SURFACE_COPY[surface];
    const [tab, setTab] = useState<SkillLibraryTab>("market");
    const [libraryCategoryId, setLibraryCategoryId] = useState("all");
    const listRef = useRef<HTMLDivElement>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const wasOpenRef = useRef(false);
    const selectedCount = selectedSkillIds.length;

    useEffect(() => {
        if (open && !wasOpenRef.current) {
            setTab("market");
            setLibraryCategoryId("all");
            onCategoryChange("all");
        }
        wasOpenRef.current = open;
    }, [onCategoryChange, open]);

    useEffect(() => {
        listRef.current?.scrollTo({ top: 0 });
    }, [category, libraryCategoryId, search, tab]);

    useEffect(() => {
        const data = curationState.curation;
        const valid = platformCategory.startsWith("root:")
            ? data?.roots?.some((root) => root.id === platformCategory.slice(5))
            : data?.categories.some((item) => item.id === platformCategory);
        if ((!data?.enabled || (platformCategory && platformCategory !== "__uncategorized__" && !valid)) && platformCategory) onPlatformCategoryChange("");
    }, [curationState.curation, onPlatformCategoryChange, platformCategory]);

    const librarySource = useMemo(() => tab === "enabled"
        ? installedSkills.filter((skill) => selectedSkillIds.includes(skill.skillId))
        : installedSkills, [installedSkills, selectedSkillIds, tab]);

    const libraryCategoryCounts = useMemo(() => {
        const counts = new Map<string, number>();
        librarySource.forEach((skill) => {
            const categoryId = skill.libraryCategoryId || "__uncategorized__";
            counts.set(categoryId, (counts.get(categoryId) || 0) + 1);
        });
        return counts;
    }, [librarySource]);

    const visibleSkills = useMemo(() => {
        const keyword = search.trim().toLocaleLowerCase("zh-CN");
        const source = tab === "market" ? marketSkills : librarySource;
        return source.filter((skill) => {
            if (!matchesCuration(skill, curationState.curation, platformCategory)) return false;
            if (tab === "market" && category !== "all" && skill.tag !== category) return false;
            if (tab !== "market") {
                if (libraryCategoryId === "__uncategorized__" && skill.libraryCategoryId) return false;
                if (libraryCategoryId !== "all" && libraryCategoryId !== "__uncategorized__" && skill.libraryCategoryId !== libraryCategoryId) return false;
            }
            if (!keyword) return true;
            return `${skill.skillName} ${skill.description || ""} ${skill.instruction || ""} ${skill.extraInfo || ""} ${skill.effectiveUser?.name || ""} ${categories.find((item) => item.value === skill.tag)?.label || ""}`
                .toLocaleLowerCase("zh-CN")
                .includes(keyword);
        });
    }, [categories, category, libraryCategoryId, librarySource, marketSkills, search, tab, curationState.curation, platformCategory]);

    useEffect(() => {
        const target = loadMoreRef.current;
        if (tab !== "market" || !target || !hasMore || loading || error || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) void onLoadMore();
        }, { root: listRef.current, rootMargin: "180px 0px" });
        observer.observe(target);
        return () => observer.disconnect();
    }, [error, hasMore, loading, onLoadMore, tab, visibleSkills.length]);

    const categoryItems = useMemo(() => {
        const unique = new Map<string, SkillCategory>();
        categories.forEach((item) => {
            if (item.value && item.value !== "all" && item.label) unique.set(item.value, item);
        });
        return [...unique.values()];
    }, [categories]);

    // 技能广场的分类目前不带数量；都没有数量时「全部技能」也不写数字，免得显示成 0。
    const marketplaceCategoryTotal = useMemo(
        () => (categoryItems.some((item) => typeof item.count === "number") ? categoryItems.reduce((total, item) => total + (item.count || 0), 0) : undefined),
        [categoryItems],
    );

    const emptyText = tab === "enabled"
        ? selectedCount === 0 ? copy.emptySelected : copy.emptySelectedFiltered
        : tab === "installed"
            ? "还没有匹配的已加入技能，可以在“全部技能”里加入"
            : "没有匹配的公开技能，换个关键词或分类试试";
    const marketError = tab === "market" && error ? error : "";

    const changeTab = (value: SkillLibraryTab) => {
        setTab(value);
        setLibraryCategoryId("all");
        onCategoryChange("all");
        onPlatformCategoryChange("");
    };

    const selectMarketplaceCategory = (value: string) => {
        setTab("market");
        setLibraryCategoryId("all");
        onCategoryChange(value);
    };

    const selectLibraryCategory = (value: string) => {
        setTab((current) => current === "enabled" ? "enabled" : "installed");
        setLibraryCategoryId(value);
        onCategoryChange("all");
    };

    return (
        <AppModal
            rootClassName="canvas-agent-skill-library-modal"
            open={open}
            title={null}
            footer={null}
            centered
            width="min(1180px, 66vw)"
            closable={false}
            modalRender={(modal) => (
                <div className="canvas-agent-skill-library-frame">
                    <button type="button" className="canvas-agent-skill-library-close" aria-label="关闭技能商店" onClick={onClose}>
                        <kbd>ESC</kbd><span>关闭</span>
                    </button>
                    {modal}
                </div>
            )}
            onCancel={onClose}
            flush
        >
            <section
                className="canvas-agent-skill-library-shell"
                style={{ color: theme.node.text, background: theme.node.panel }}
                data-canvas-no-zoom
                data-canvas-wheel-scroll
                aria-label="Agent Skills 技能库"
            >
                <aside className="canvas-agent-skill-library-sidebar">
                    <Input
                        allowClear
                        prefix={<Search className="size-4" style={{ color: theme.node.muted }} aria-hidden="true" />}
                        value={search}
                        onChange={(event) => onSearch(event.target.value)}
                        placeholder="搜索技能"
                        aria-label="搜索技能名称、说明或作者"
                        className="canvas-agent-skill-library-search"
                    />
                    <nav className="canvas-agent-skill-library-categories thin-scrollbar" aria-label="技能视图与分类">
                        {curationState.error ? <Alert type="warning" title={curationState.error} action={<Button onClick={curationState.retry}>重试</Button>} /> : null}
                        {curationState.curation?.enabled ? (
                            <div className="canvas-agent-skill-library-category-group" role="group" aria-label="平台分类">
                                <div className="canvas-agent-skill-library-category-heading">平台分类</div>
                                <SkillTab active={!platformCategory} label="全部分类" onClick={() => onPlatformCategoryChange("")} />
                                <SkillTab active={platformCategory === "__uncategorized__"} label="未细分" onClick={() => onPlatformCategoryChange("__uncategorized__")} />
                                {(curationState.curation.roots || []).map((root) => {
                                    const Icon = curationIcon(root.iconKey);
                                    const children = curationState.curation?.categories.filter((item) => item.rootTag === root.id) || [];
                                    return (
                                        <div key={root.id} className="canvas-agent-skill-library-platform-branch">
                                            <SkillTab active={platformCategory === `root:${root.id}`} icon={<Icon className="size-4" aria-hidden="true" />} label={root.name} onClick={() => onPlatformCategoryChange(`root:${root.id}`)} />
                                            {children.map((item) => (
                                                <SkillTab key={item.id} active={platformCategory === item.id} label={item.name} onClick={() => onPlatformCategoryChange(item.id)} />
                                            ))}
                                        </div>
                                    );
                                })}
                                {(curationState.curation.categories || []).filter((item) => !(curationState.curation?.roots || []).some((root) => root.id === item.rootTag)).map((item) => (
                                    <SkillTab key={item.id} active={platformCategory === item.id} label={item.name} onClick={() => onPlatformCategoryChange(item.id)} />
                                ))}
                            </div>
                        ) : null}
                        <div className="canvas-agent-skill-library-category-group">
                            <div className="canvas-agent-skill-library-category-heading">我的技能分类</div>
                            <SkillTab active={tab !== "market" && libraryCategoryId === "all"} label="全部分类" count={librarySource.length} onClick={() => selectLibraryCategory("all")} />
                            <SkillTab active={tab !== "market" && libraryCategoryId === "__uncategorized__"} label="未分类" count={libraryCategoryCounts.get("__uncategorized__") || 0} onClick={() => selectLibraryCategory("__uncategorized__")} />
                            {libraryCategories.map((item) => (
                                <SkillTab
                                    key={item.id}
                                    active={tab !== "market" && libraryCategoryId === item.id}
                                    label={item.name}
                                    count={libraryCategoryCounts.get(item.id) || 0}
                                    onClick={() => selectLibraryCategory(item.id)}
                                />
                            ))}
                        </div>

                        <div className="canvas-agent-skill-library-category-group">
                            <div className="canvas-agent-skill-library-category-heading">技能广场分类</div>
                            <SkillTab active={tab === "market" && category === "all"} label="全部技能" count={marketplaceCategoryTotal} onClick={() => changeTab("market")} />
                            {!curationState.curation?.enabled && categoryItems.map((item) => (
                                <SkillTab
                                    key={item.value}
                                    active={tab === "market" && category === item.value}
                                    label={item.label}
                                    count={item.count}
                                    onClick={() => selectMarketplaceCategory(item.value)}
                                />
                            ))}
                        </div>
                    </nav>
                </aside>

                <div className="canvas-agent-skill-library-content">
                    <header className="canvas-agent-skill-library-header">
                        <h2>技能商店</h2>
                        <button type="button" className="canvas-agent-skill-library-count" onClick={() => changeTab("enabled")} aria-label={copy.countAria(selectedCount, selectionLimit)}>
                            {copy.selectedCount} <strong>{selectedCount}</strong><span> / {selectionLimit}</span>
                        </button>
                    </header>

                    <div ref={listRef} className="canvas-agent-skill-library-list thin-scrollbar" aria-label="技能列表" aria-busy={loading}>
                        {visibleSkills.map((skill) => {
                            const selected = selectedSkillIds.includes(skill.skillId);
                            return (
                                <SkillLibraryCard
                                    key={skill.skillId}
                                    skill={skill}
                                    rootLabel={curationState.curation?.enabled ? curationState.curation.roots?.find((root) => root.id === effectiveCurationRoot(skill, curationState.curation!))?.name : undefined}
                                    theme={theme}
                                    categories={categories}
                                    copy={copy}
                                    selectionLimit={selectionLimit}
                                    block={skill.isAdded ? getSelectionBlock?.(skill) : undefined}
                                    selected={selected}
                                    canSelect={selectedCount < selectionLimit || selected}
                                    onToggle={() => onToggle(skill.skillId)}
                                    onInstall={() => onInstall(skill)}
                                />
                            );
                        })}
                        {loading && visibleSkills.length === 0 ? (
                            <div className="canvas-agent-skill-library-state" style={{ color: theme.node.muted }}>
                                <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                正在读取技能库…
                            </div>
                        ) : null}
                        {!loading && visibleSkills.length === 0 ? (
                            marketError ? (
                                <div className="canvas-agent-skill-library-state" role="alert" style={{ color: theme.node.muted }}>
                                    <CircleAlert className="size-6" aria-hidden="true" />
                                    <span>{marketError}</span>
                                    {onRetry ? <Button size="small" onClick={onRetry}>重试</Button> : null}
                                </div>
                            ) : (
                                <div className="canvas-agent-skill-library-state" style={{ color: theme.node.muted }}>
                                    <Blocks className="size-6" aria-hidden="true" />
                                    <span>{emptyText}</span>
                                    {tab !== "market" ? <Button size="small" onClick={() => changeTab("market")}>浏览公开技能</Button> : null}
                                </div>
                            )
                        ) : null}
                        {tab === "market" && hasMore ? <div ref={loadMoreRef} className="col-span-full h-px" aria-hidden="true" /> : null}
                    </div>

                    <footer className="canvas-agent-skill-library-footer" style={{ color: theme.node.muted, borderColor: theme.node.stroke }}>
                        {marketError && marketSkills.length ? (
                            <span className="canvas-agent-skill-library-footer-error" role="alert">{marketError}</span>
                        ) : (
                            <span>{tab === "enabled" ? copy.footerSelected(visibleSkills.length) : tab === "installed" ? copy.footerInstalled(visibleSkills.length) : `已加载 ${marketSkills.length} 个公开技能`}</span>
                        )}
                        {tab === "market" && hasMore ? (
                            <Button size="small" disabled={loading} loading={loading} onClick={() => void onLoadMore()}>{loading ? "加载中" : "加载更多"}</Button>
                        ) : <span>{tab !== "market" ? copy.footerLimit(selectionLimit) : marketError ? null : "已加载全部"}</span>}
                    </footer>
                </div>
            </section>
        </AppModal>
    );
}

function SkillTab({ active, icon, label, count, onClick }: { active: boolean; icon?: ReactNode; label: string; count?: number; onClick: () => void }) {
    return (
        <button type="button" aria-pressed={active} className={`canvas-agent-skill-library-tab${icon ? " has-icon" : ""}${active ? " is-active" : ""}`} onClick={onClick}>
            {icon}
            {label}
            {typeof count === "number" ? <span>{count}</span> : null}
        </button>
    );
}

function SkillLibraryCard({ skill, rootLabel, theme, categories, copy, selectionLimit, block, selected, canSelect, onToggle, onInstall }: {
    skill: Skill;
    rootLabel?: string;
    theme: CanvasTheme;
    categories: SkillCategory[];
    copy: SurfaceCopy;
    selectionLimit: number;
    block?: SkillSelectionBlock;
    selected: boolean;
    canSelect: boolean;
    onToggle: () => void;
    onInstall: () => Promise<void>;
}) {
    const [installing, setInstalling] = useState(false);
    const [coverFailed, setCoverFailed] = useState(false);
    const cover = skill.showcaseMedia?.find((item) => item.type === "image" && item.showcaseUrl)
        || skill.showcaseMedia?.find((item) => item.showcaseUrl);
    const coverUrl = cover?.showcaseUrl;
    const hasCover = Boolean(coverUrl && !coverFailed);
    const categoryLabel = rootLabel || categories.find((item) => item.value === skill.tag)?.label || "其他";
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const author = skill.effectiveUser?.name || `${brandName}创作者`;
    // 已安装列表来自 /skills/added 的轻量引用，不带加入人数；没有人数时不写 0。
    const addedCount = skill.addedCount ? formatSkillCount(skill.addedCount) : "";

    useEffect(() => setCoverFailed(false), [coverUrl]);

    const install = async () => {
        if (installing) return;
        setInstalling(true);
        try {
            await onInstall();
        } finally {
            setInstalling(false);
        }
    };

    return (
        <article className={`canvas-agent-skill-card ${hasCover ? "" : "is-text-only"} ${selected ? "is-selected" : ""}`}>
            {hasCover ? (
                <div className="canvas-agent-skill-card-cover">
                    {/* 封面不可拖动：首页创作里弹窗在 React 树上挂在输入框下面，拖动封面松手时，输入框的放下处理会把它当成参考图。 */}
                    {cover?.type === "video" ? (
                        <video src={coverUrl} muted playsInline preload="metadata" draggable={false} onError={() => setCoverFailed(true)} />
                    ) : (
                        <img src={coverUrl} alt="" loading="lazy" draggable={false} onError={() => setCoverFailed(true)} />
                    )}
                    <span className="canvas-agent-skill-card-category">{categoryLabel}</span>
                    {selected ? <span className="canvas-agent-skill-card-selected" aria-label={copy.coverSelected}><Check className="size-4" aria-hidden="true" /></span> : null}
                </div>
            ) : null}
            <div className={`canvas-agent-skill-card-body ${hasCover ? "" : "is-text-only"}`}>
                {!hasCover ? <span className="canvas-agent-skill-card-category is-inline">{categoryLabel}</span> : null}
                <div className="canvas-agent-skill-card-title-row">
                    <h3 title={skill.skillName}>{skill.skillName}</h3>
                    <div className="canvas-agent-skill-card-action">
                        {skill.isAdded ? (
                            <Button
                                size="small"
                                type="default"
                                className={selected ? "is-selected" : ""}
                                disabled={Boolean(block) || !canSelect}
                                aria-pressed={block ? undefined : selected}
                                title={block ? block.reason : !canSelect ? copy.limitTitle(selectionLimit) : selected ? copy.selectedTitle : copy.selectTitle}
                                onClick={onToggle}
                            >
                                {block ? block.label : selected ? copy.selected : copy.select}
                            </Button>
                        ) : (
                            <Button size="small" icon={<Plus className="size-3.5" />} loading={installing} disabled={installing} onClick={() => void install()}>
                                加入
                            </Button>
                        )}
                    </div>
                </div>
                <div className="canvas-agent-skill-card-meta" style={{ color: theme.node.muted }}>
                    <span className="min-w-0 truncate">{author}</span>
                    {skill.version ? <><span aria-hidden="true">·</span><span className="canvas-agent-skill-card-version">v{skill.version}</span></> : null}
                    {addedCount ? <span className="inline-flex shrink-0 items-center gap-1" title={`${skill.addedCount} 人加入`}><Users className="size-3.5" aria-hidden="true" />{addedCount}</span> : null}
                </div>
                <p title={skill.description || "暂无技能说明"}>{skill.description || "暂无技能说明"}</p>
            </div>
        </article>
    );
}

function formatSkillCount(value: number) {
    return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
