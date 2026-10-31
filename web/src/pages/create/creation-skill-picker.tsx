// 输入框工具栏的「技能」（参考即梦）：列出能在首页创作里用的已安装技能，点一个就在提示词末尾插入技能标签，
// 再点一次取消。搜索只在已安装的技能里找；「管理技能」在当前页打开技能商店弹窗（和画布助手同一个），
// 可以浏览技能广场、加入和选用技能，草稿留在输入框里。

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Popover } from "antd";
import { Search, SlidersHorizontal } from "lucide-react";

import { useMediaQuery } from "@/hooks/use-media-query";
import type { Skill } from "@/services/api/skills";
import { CreationIcon } from "./creation-icons";
import { CreationSkillStore } from "./creation-skill-store";

import "./creation-skill-picker.css";

export type CreationSkillsStatus = "idle" | "loading" | "ready" | "error";

type CreationSkillPickerProps = {
    variant: "empty" | "thread";
    /** 能在首页创作里用的已安装技能（已按技能声明的入口过滤）。 */
    skills: Skill[];
    /** 技能库里全部已安装的技能（含只给画布用的），技能商店的「我的技能」按它列出。 */
    library: Skill[];
    status: CreationSkillsStatus;
    /** 提示词里已经引用的技能。 */
    selectedIds: string[];
    max: number;
    signInRequired: boolean;
    disabled: boolean;
    disabledReason?: string;
    /** 读取技能库：打开菜单、重试、打开技能商店和加入技能后都会调（listAddedSkills 15 秒内复用缓存，加入技能后缓存作废）。 */
    onRefresh: () => Promise<void>;
    /** focusPrompt 为 false 时不把焦点挪回输入框：在技能商店里选技能时弹窗还开着。 */
    onToggle: (skill: Skill, options?: { focusPrompt?: boolean }) => void;
    onSignIn: () => void;
};

export function CreationSkillPicker(props: CreationSkillPickerProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [storeOpen, setStoreOpen] = useState(false);
    // 技能商店第一次打开时才挂载，之后留着，关上再打开时保留搜索词。
    const [storeMounted, setStoreMounted] = useState(false);
    // 生成中或 Agent 运行中按钮会禁用，已经打开的菜单和技能商店跟着收起；退出登录时技能商店也收起。
    if (open && props.disabled) {
        setOpen(false);
        setQuery("");
    }
    if (storeOpen && (props.disabled || props.signInRequired)) setStoreOpen(false);
    // 触屏打开菜单时不自动聚焦搜索框，免得键盘弹起来盖住列表。
    const finePointer = useMediaQuery("(hover: hover) and (pointer: fine)");
    const triggerRef = useRef<HTMLButtonElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const selected = useMemo(() => new Set(props.selectedIds), [props.selectedIds]);
    const full = selected.size >= props.max;
    const term = query.trim().toLocaleLowerCase();
    const filtered = useMemo(() => (term ? props.skills.filter((skill) => `${skill.skillName} ${skill.description}`.toLocaleLowerCase().includes(term)) : props.skills), [props.skills, term]);
    const hasSkills = props.skills.length > 0;
    const changeOpen = (next: boolean) => {
        if (next && props.disabled) return;
        setOpen(next);
        if (!next) setQuery("");
        if (next && !props.signInRequired) void props.onRefresh();
    };
    useEffect(() => {
        if (!open || !finePointer || !hasSkills) return;
        const frame = window.requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
        return () => window.cancelAnimationFrame(frame);
    }, [finePointer, hasSkills, open]);

    const openStore = () => {
        changeOpen(false);
        // 焦点先回到「技能」按钮：弹窗关上后 AntD 把焦点还给打开前的元素，那时菜单里的按钮已经收起了。
        triggerRef.current?.focus({ preventScroll: true });
        setStoreMounted(true);
        setStoreOpen(true);
        void props.onRefresh();
    };
    const pick = (skill: Skill) => {
        const adding = !selected.has(skill.skillId);
        if (adding && full) return;
        props.onToggle(skill);
        // 选中后回到输入框接着写；取消选择时留在列表里，方便换一个。
        if (adding) changeOpen(false);
    };
    const options = () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-skill-option]") || []);
    const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            options()[0]?.focus();
        } else if (event.key === "Enter" && !event.nativeEvent.isComposing && filtered[0]) {
            event.preventDefault();
            pick(filtered[0]);
        }
    };
    const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const items = options();
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const next = index + (event.key === "ArrowDown" ? 1 : -1);
        if (next < 0) searchRef.current?.focus();
        else items[Math.min(next, items.length - 1)]?.focus();
    };
    const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        changeOpen(false);
        triggerRef.current?.focus();
    };

    const body = props.signInRequired ? (
        <div className="creation-skill-picker-state">
            <p>登录后可以使用技能</p>
            <button
                type="button"
                className="creation-skill-picker-action"
                onClick={() => {
                    changeOpen(false);
                    props.onSignIn();
                }}
            >
                去登录
            </button>
        </div>
    ) : !hasSkills ? (
        props.status === "error" ? (
            <div className="creation-skill-picker-state" role="alert">
                <p>技能列表没加载出来</p>
                <button type="button" className="creation-skill-picker-action" onClick={() => void props.onRefresh()}>
                    重试
                </button>
            </div>
        ) : props.status === "ready" ? (
            <div className="creation-skill-picker-state">
                <p>还没有能在这里用的技能</p>
                <button type="button" className="creation-skill-picker-action" aria-haspopup="dialog" onClick={openStore}>
                    去技能商店看看
                </button>
            </div>
        ) : (
            <div className="creation-skill-picker-state" role="status">
                <p>正在读取技能…</p>
            </div>
        )
    ) : (
        <>
            <label className="creation-skill-picker-search">
                <Search aria-hidden="true" />
                <input ref={searchRef} type="search" value={query} placeholder="搜索技能" aria-label="搜索技能" autoComplete="off" onChange={(event) => setQuery(event.target.value)} onKeyDown={handleSearchKeyDown} />
            </label>
            <div ref={listRef} className="creation-skill-picker-list creation-scrollbar" role="group" aria-label="已安装的技能" onKeyDown={handleListKeyDown}>
                {filtered.length ? (
                    filtered.map((skill) => {
                        const active = selected.has(skill.skillId);
                        const blocked = !active && full;
                        return (
                            <button
                                key={skill.skillId}
                                type="button"
                                data-skill-option
                                className="creation-skill-picker-option"
                                aria-pressed={active}
                                aria-disabled={blocked || undefined}
                                title={blocked ? `最多同时使用 ${props.max} 个技能` : undefined}
                                onClick={() => pick(skill)}
                            >
                                <span className="creation-skill-picker-icon" aria-hidden="true">
                                    <CreationIcon name="skill" size={18} />
                                </span>
                                <span className="creation-skill-picker-copy">
                                    <strong>{skill.skillName}</strong>
                                    {skill.description ? <span>{skill.description}</span> : null}
                                </span>
                                {active ? <CreationIcon name="check" className="creation-skill-picker-check" /> : null}
                            </button>
                        );
                    })
                ) : (
                    <p className="creation-skill-picker-state">没有找到和「{query.trim()}」相关的技能</p>
                )}
            </div>
        </>
    );
    return (
        <>
            <Popover
                open={open}
                onOpenChange={changeOpen}
                trigger="click"
                placement={props.variant === "thread" ? "topLeft" : "bottomLeft"}
                arrow={false}
                classNames={{ root: "creation-control-popover creation-skill-picker-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }}
                content={
                    <div className="creation-skill-picker" role="dialog" aria-label="选择技能" onKeyDown={handlePanelKeyDown}>
                        {body}
                        {props.signInRequired ? null : (
                            <footer className="creation-skill-picker-footer">
                                <button type="button" className="creation-skill-picker-manage" aria-haspopup="dialog" onClick={openStore}>
                                    <SlidersHorizontal aria-hidden="true" />
                                    管理技能
                                </button>
                                {selected.size ? (
                                    <small>
                                        已选 {selected.size}/{props.max}
                                    </small>
                                ) : null}
                            </footer>
                        )}
                    </div>
                }
            >
                <button
                    ref={triggerRef}
                    type="button"
                    className="creation-chat-control creation-skill-trigger"
                    aria-label={selected.size ? `技能，已选 ${selected.size} 个` : "选择技能"}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    title={props.disabled ? props.disabledReason : undefined}
                    disabled={props.disabled}
                >
                    <CreationIcon name="skill" />
                    <span>技能</span>
                    {selected.size ? (
                        <em className="creation-skill-trigger-count" aria-hidden="true">
                            {selected.size}
                        </em>
                    ) : null}
                </button>
            </Popover>
            {storeMounted ? (
                <CreationSkillStore
                    open={storeOpen}
                    skills={props.skills}
                    library={props.library}
                    selectedIds={props.selectedIds}
                    max={props.max}
                    onClose={() => setStoreOpen(false)}
                    onToggle={(skill) => props.onToggle(skill, { focusPrompt: false })}
                    onRefresh={props.onRefresh}
                />
            ) : null}
        </>
    );
}
