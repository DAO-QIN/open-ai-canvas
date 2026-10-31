// 「技能」菜单底部的「管理技能」：在当前页打开和画布助手同一个技能商店弹窗，草稿留在输入框里。
// 弹窗只管展示；这里读技能广场（分页、分类、搜索）和我的技能分类，处理加入和选用。
// 点「使用」和在菜单里点技能一样，在提示词末尾插入技能标签；弹窗还开着，焦点不挪回输入框。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";

import { CanvasAgentSkillLibraryModal, type SkillSelectionBlock } from "@/components/canvas/canvas-agent-skill-library-modal";
import { curationQuery, useSkillCuration } from "@/components/skills/skill-curation-browser";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { canvasThemes } from "@/lib/canvas-theme";
import { addSkill, listSkillLibraryCategories, listSkills, type ListSkillsInput, type Skill, type SkillCategory, type SkillLibraryCategory } from "@/services/api/skills";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";

const PAGE_SIZE = 20;
const FIRST_PAGE_ERROR = "技能广场没加载出来，检查网络后重试";
const NEXT_PAGE_ERROR = "更多技能没加载出来，点“加载更多”重试";

type CreationSkillStoreProps = {
    open: boolean;
    /** 能在首页创作里用的已安装技能，和「技能」菜单同一份。 */
    skills: Skill[];
    /** 技能库里全部已安装的技能（含只给画布用的），「我的技能」按它列出。 */
    library: Skill[];
    selectedIds: string[];
    max: number;
    onClose: () => void;
    onToggle: (skill: Skill) => void;
    /** 重新读取技能库。加入技能后等它读完，按钮再从「加入」变成「使用」。 */
    onRefresh: () => Promise<void>;
};

export function CreationSkillStore({ open, skills, library, selectedIds, max, onClose, onToggle, onRefresh }: CreationSkillStoreProps) {
    const { message } = App.useApp();
    const theme = canvasThemes[useActiveTheme()];
    const userId = useUserStore((state) => state.user?.id) || "";
    const curationState = useSkillCuration(open);
    const curation = curationState.curation;
    const [search, setSearch] = useState("");
    const debouncedSearch = useDebouncedValue(search.trim(), 250);
    const [tag, setTag] = useState("all");
    const [platformCategory, setPlatformCategory] = useState("");
    const [marketSkills, setMarketSkills] = useState<Skill[]>([]);
    const [categories, setCategories] = useState<SkillCategory[]>([]);
    const [libraryCategories, setLibraryCategories] = useState<SkillLibraryCategory[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [page, setPage] = useState(1);
    const [error, setError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const pageRequestRef = useRef(false);

    // 换账号后丢掉上一个账号读到的公开技能（带着它的「已加入」状态）和分类。
    const [dataOwner, setDataOwner] = useState(userId);
    if (dataOwner !== userId) {
        setDataOwner(userId);
        setMarketSkills([]);
        setLibraryCategories([]);
        setHasMore(false);
        setPage(1);
        setError("");
    }

    // 平台策展打开后，技能广场按平台分类筛选，不再用广场分类。
    useEffect(() => {
        if (curation?.enabled) setTag("all");
    }, [curation?.enabled]);

    // 只在查询条件真的变了时重读。策展数据在窗口获得焦点、技能库变化时会重新拉取，每次都是新对象，
    // 按对象比较会把已经翻到的页清回第一页。
    const platformQueryKey = JSON.stringify(curationQuery(curation, platformCategory));
    const browseQuery = useMemo<ListSkillsInput>(
        () => ({ scope: "public", sort: "popular", pageSize: PAGE_SIZE, search: debouncedSearch || undefined, tag: tag !== "all" ? tag : undefined, ...(JSON.parse(platformQueryKey) as ListSkillsInput) }),
        [debouncedSearch, platformQueryKey, tag],
    );
    const browseKey = JSON.stringify([userId, reloadKey, browseQuery]);
    const browseKeyRef = useRef(browseKey);
    browseKeyRef.current = browseKey;

    useEffect(() => {
        if (!open) return;
        let active = true;
        setLoading(true);
        listSkills({ ...browseQuery, page: 1 })
            .then((result) => {
                if (!active) return;
                setMarketSkills(result.skills);
                setCategories(result.categories);
                setHasMore(result.hasMore);
                setPage(result.page);
                setError("");
            })
            .catch(() => {
                if (!active) return;
                setMarketSkills([]);
                setHasMore(false);
                setError(FIRST_PAGE_ERROR);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [browseQuery, open, reloadKey, userId]);

    // 下一页失败时写进 error：弹窗出错期间不再自动翻页，免得断网时一直重试，点「加载更多」再试。
    const loadMore = useCallback(async () => {
        if (loading || pageRequestRef.current || !hasMore || search.trim() !== debouncedSearch) return;
        const requestKey = browseKeyRef.current;
        pageRequestRef.current = true;
        setLoading(true);
        try {
            const result = await listSkills({ ...browseQuery, page: page + 1 });
            if (requestKey !== browseKeyRef.current) return;
            setMarketSkills((current) => {
                const loaded = new Set(current.map((item) => item.skillId));
                return [...current, ...result.skills.filter((skill) => !loaded.has(skill.skillId))];
            });
            setCategories(result.categories);
            setHasMore(result.hasMore);
            setPage(result.page);
            setError("");
        } catch {
            if (requestKey === browseKeyRef.current) setError(NEXT_PAGE_ERROR);
        } finally {
            pageRequestRef.current = false;
            if (requestKey === browseKeyRef.current) setLoading(false);
        }
    }, [browseQuery, debouncedSearch, hasMore, loading, page, search]);

    useEffect(() => {
        if (!open) return;
        let active = true;
        listSkillLibraryCategories("mine")
            .then((result) => {
                if (active) setLibraryCategories(result.categories);
            })
            .catch(() => {
                // 分类读不到时只剩「全部分类」「未分类」，技能照常列出。
                if (active) setLibraryCategories([]);
            });
        return () => {
            active = false;
        };
    }, [open, userId]);

    const usable = useMemo(() => new Map(skills.map((skill) => [skill.skillId, skill])), [skills]);
    const installed = useMemo(() => library.filter((skill) => skill.isAdded), [library]);
    const installedById = useMemo(() => new Map(installed.map((skill) => [skill.skillId, skill])), [installed]);
    const getSelectionBlock = useCallback(
        (skill: Skill): SkillSelectionBlock | undefined => {
            if (usable.has(skill.skillId)) return undefined;
            const known = installedById.get(skill.skillId);
            // 技能广场说已加入、技能库里还没有（读取失败或还没读完）：不知道入口，先不让选。
            if (!known) return { label: "使用", reason: "技能列表还没更新，关掉弹窗再打开就能选" };
            if (known.agentSurfaces?.includes("canvas")) return { label: "仅画布", reason: "作者设定这个技能只在画布助手里使用" };
            return { label: "不可用", reason: "这个技能暂时不能在首页创作里使用" };
        },
        [installedById, usable],
    );

    const toggle = useCallback(
        (skillId: string) => {
            const skill = usable.get(skillId);
            if (!skill) return;
            if (!selectedIds.includes(skillId) && selectedIds.length >= max) return;
            onToggle(skill);
        },
        [max, onToggle, selectedIds, usable],
    );

    const install = useCallback(
        async (skill: Skill) => {
            if (skill.isAdded) return;
            let added: Skill;
            try {
                added = (await addSkill(skill.skillId)).skill;
            } catch (cause) {
                void message.error(cause instanceof Error && cause.message ? cause.message : "加入技能失败，请重试");
                return;
            }
            // 等技能库读完再把卡片标成已加入：那时已经知道它能不能在首页用，按钮直接变成「使用」或「仅画布」。
            await onRefresh().catch(() => undefined);
            setMarketSkills((current) => current.map((item) => (item.skillId === skill.skillId ? added : item)));
        },
        [message, onRefresh],
    );

    const changePlatformCategory = useCallback((value: string) => {
        setPlatformCategory(value);
        setTag("all");
    }, []);
    const retry = useCallback(() => setReloadKey((value) => value + 1), []);

    return (
        <CanvasAgentSkillLibraryModal
            surface="creation"
            selectionLimit={max}
            getSelectionBlock={getSelectionBlock}
            curationState={curationState}
            platformCategory={platformCategory}
            onPlatformCategoryChange={changePlatformCategory}
            open={open}
            theme={theme}
            installedSkills={installed}
            marketSkills={marketSkills}
            selectedSkillIds={selectedIds}
            categories={categories}
            libraryCategories={libraryCategories}
            category={tag}
            search={search}
            loading={loading}
            hasMore={hasMore}
            error={error}
            onRetry={retry}
            onClose={onClose}
            onCategoryChange={setTag}
            onSearch={setSearch}
            onToggle={toggle}
            onInstall={install}
            onLoadMore={loadMore}
        />
    );
}
