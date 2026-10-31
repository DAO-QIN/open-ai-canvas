// 输入框里的参考素材（参考即梦）：竖版小卡片斜放成一摞，放在提示词左边；鼠标移上去按顺序展开，最后是「+」。
// 展开后按住一张左右拖动换顺序，拖到提示词里的 @图片 上替换那一张；本机图片或对话里的生成结果拖到卡片上替换这一张。
// 触屏没有悬停：卡片平铺成一行横向滑动，不拖动排序。

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import { Dropdown, type MenuProps } from "antd";
import { AtSign, FileText, FolderOpen, Image as ImageIcon, LoaderCircle, Music2, Plus, Upload, X } from "lucide-react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { useMediaQuery } from "@/hooks/use-media-query";
import { toLayoutPx } from "@/lib/ui-scale";
import { resolveResourceUrl } from "@/services/api/resources";
import { creationAttachmentKind, type CreationAttachment } from "./creation-assets";
import { hasCreationReferenceDrag, readCreationReferenceDrop } from "./creation-reference-drag";
import type { CreationResultImageRef } from "./creation-workspace-messages";

import "./creation-reference-stack.css";

// 即梦的斜放角度：展开时按位置左右交替；收成一摞时每张更乱一些，像随手叠的照片。
const FANNED_TILT = [-8, 5, -8, 5, -8, 4, -8, 4, -8, 5, -8, 5];
const STACKED_TILT = [-8, 4, -22, 8, -8, 4, -7, 4, -8, 8, -22, 4];
// 卡片是 3:4 竖版；mini 是收成一摞时贴在右下角的「+」圆点。桌面端整体缩放 90%：60×80 在屏幕上约 54×72，
// 比即梦的 48×64 略大；对话里的输入框和首页共用一套尺寸，卡片、位置和「参考素材」字样也一样。
// 触屏不缩放，平铺一行沿用 48×64 / 36×48，不把手机上的输入框撑高。
const CARD_SIZE = {
    stack: { empty: { width: 60, height: 80, mini: 32, gap: 6 }, thread: { width: 60, height: 80, mini: 32, gap: 6 } },
    tiled: { empty: { width: 48, height: 64, mini: 28, gap: 4 }, thread: { width: 36, height: 48, mini: 22, gap: 4 } },
} as const;
const HOVER_DELAY_MS = 100;
const DRAG_THRESHOLD_PX = 4;
// 和 CSS 里卡片移动的过渡时长一致：放手后等卡片滑进位置再提交新顺序。
const SETTLE_MS = 300;

const ADD_MENU_ITEMS: MenuProps["items"] = [
    { key: "upload", icon: <Upload aria-hidden="true" />, label: "上传图片" },
    { key: "library", icon: <FolderOpen aria-hidden="true" />, label: "从素材库选择" },
];

type PromptImageTarget = { id: string; attachmentId?: string };

type DragState = {
    id: string;
    fromIndex: number;
    overIndex: number;
    dx: number;
    dy: number;
    phase: "dragging" | "settling";
    /** 指针停在提示词里的哪个 @图片 上（放手即替换那一张）。 */
    promptTarget: { referenceId: string; attachmentId: string } | null;
};

export type CreationReferenceStackProps = {
    variant: "empty" | "thread";
    /** stack：提示词左边的一摞（鼠标设备）；tiled：提示词上方平铺一行（触屏）。 */
    layout: "stack" | "tiled";
    attachments: CreationAttachment[];
    /** 卡片底部的叫法，与提示词里的 @图片1 一致。 */
    labels: ReadonlyMap<string, string>;
    /** 「参考图」或「参考素材」。 */
    noun: string;
    /** 读屏用的数量说明，例如「参考素材 3/9 个」。 */
    status: string;
    busy: boolean;
    uploading: boolean;
    showAdd: boolean;
    canAdd: boolean;
    addLabel: string;
    onBeforeUpload: () => boolean;
    onUploadFiles: (files: File[]) => void;
    onOpenLibrary: () => void;
    /** 拖到「+」上的本机图片或生成结果：加到最后。 */
    onDropAdd: (dataTransfer: DataTransfer) => void;
    onPreview: (type: "image" | "video", url: string) => void;
    onRemove: (id: string) => void;
    /** 卡片上的「@」：把这一张引用到提示词。不传则不显示。 */
    onMention?: (id: string) => void;
    onReorder: (attachments: CreationAttachment[]) => void;
    findPromptImageAt: (x: number, y: number) => PromptImageTarget | undefined;
    onPromptDropTargetChange: (referenceId: string | null) => void;
    onReplaceWithAttachment: (targetAttachmentId: string, item: CreationAttachment) => void;
    onReplaceWithFiles: (targetAttachmentId: string, files: File[]) => void;
    onDropResultImage: (image: CreationResultImageRef, targetAttachmentId?: string) => void;
};

export function CreationReferenceStack(props: CreationReferenceStackProps) {
    const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
    const size = CARD_SIZE[props.layout][props.variant];
    const stacked = props.layout === "stack";
    const count = props.attachments.length;
    const slots = count + (props.showAdd ? 1 : 0);
    const rootRef = useRef<HTMLDivElement>(null);
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [rowWidth, setRowWidth] = useState(0);
    const [drag, setDrag] = useState<DragState | null>(null);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [announcement, setAnnouncement] = useState("");
    const externalDrag = useExternalReferenceDrag();
    const entering = useEnteringIds(props.attachments);
    const dragRef = useRef<DragState | null>(null);
    const frameRef = useRef(0);
    const timersRef = useRef({ hover: 0, menu: 0, settle: 0, announce: 0 });
    const stopPointerRef = useRef<(() => void) | null>(null);
    const suppressClickRef = useRef(false);
    const refocusIdRef = useRef<string | null>(null);

    const dragging = drag !== null;
    const expanded = !stacked || count === 0 || hovered || focused || menuOpen || dragging || externalDrag;
    // 卡片多到一行放不下时收紧间距，像手里攥着的一把牌，不让最后几张被输入框裁掉。
    const naturalStep = size.width + size.gap;
    const fitStep = slots > 1 && rowWidth > 0 ? (rowWidth - size.width) / (slots - 1) : naturalStep;
    const step = Math.round(Math.max(size.width * 0.5, Math.min(naturalStep, fitStep)) * 10) / 10;
    const latest = useRef({ props, step });
    latest.current = { props, step };

    useLayoutEffect(() => {
        const row = rootRef.current?.parentElement;
        if (!stacked || !row) return;
        const update = () => setRowWidth(Math.max(0, toLayoutPx(row.getBoundingClientRect().width) - 16));
        update();
        const observer = new ResizeObserver(update);
        observer.observe(row);
        return () => observer.disconnect();
    }, [stacked]);

    // 拖到页面别处放下或拖出窗口时没有 dragleave：拖动一结束就取消高亮。
    useEffect(() => {
        if (!externalDrag) setDropTarget(null);
    }, [externalDrag]);

    useEffect(() => {
        const timers = timersRef.current;
        return () => {
            stopPointerRef.current?.();
            window.cancelAnimationFrame(frameRef.current);
            Object.values(timers).forEach((timer) => window.clearTimeout(timer));
        };
    }, []);

    // 键盘换顺序后焦点回到同一张卡片（React 移动节点时焦点会丢）。
    useLayoutEffect(() => {
        const id = refocusIdRef.current;
        if (!id) return;
        refocusIdRef.current = null;
        rootRef.current?.querySelector<HTMLElement>(`[data-reference-id="${CSS.escape(id)}"] .creation-reference-card-preview`)?.focus();
    }, [props.attachments]);

    const announce = (text: string) => {
        window.clearTimeout(timersRef.current.announce);
        setAnnouncement(text);
        timersRef.current.announce = window.setTimeout(() => setAnnouncement(""), 2000);
    };

    const commitMove = (id: string, toIndex: number) => {
        const { props: current } = latest.current;
        const next = moveAttachment(current.attachments, id, toIndex);
        if (next === current.attachments) return false;
        current.onReorder(next);
        // 编号跟着顺序变，读屏报素材名字和新位置。
        const name = next.find((item) => item.id === id)?.name || "这一张";
        announce(`${name} 已移到第 ${next.findIndex((item) => item.id === id) + 1} 位`);
        return true;
    };

    const settle = (state: DragState, toIndex: number, commit: boolean) => {
        const next: DragState = { ...state, overIndex: toIndex, dx: 0, dy: 0, phase: "settling", promptTarget: null };
        dragRef.current = next;
        setDrag(next);
        window.clearTimeout(timersRef.current.settle);
        timersRef.current.settle = window.setTimeout(
            () => {
                dragRef.current = null;
                setDrag(null);
                if (commit) commitMove(state.id, toIndex);
            },
            reducedMotion ? 0 : SETTLE_MS,
        );
    };

    const beginPointer = (event: PointerEvent<HTMLLIElement>, item: CreationAttachment, index: number) => {
        if (!stacked || !expanded || event.button !== 0 || props.busy || dragRef.current || count < 2) return;
        if ((event.target as HTMLElement).closest(".creation-reference-card-action")) return;
        const pointerId = event.pointerId;
        const startX = event.clientX;
        const startY = event.clientY;
        let state: DragState | null = null;
        const render = () => {
            if (frameRef.current) return;
            frameRef.current = window.requestAnimationFrame(() => {
                frameRef.current = 0;
                setDrag(dragRef.current);
            });
        };
        const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", cancel);
            window.removeEventListener("keydown", escape);
            window.removeEventListener("blur", cancel);
            document.documentElement.classList.remove("creation-reference-grabbing");
            stopPointerRef.current = null;
        };
        const move = (moveEvent: globalThis.PointerEvent) => {
            if (moveEvent.pointerId !== pointerId) return;
            const screenX = moveEvent.clientX - startX;
            const screenY = moveEvent.clientY - startY;
            if (!state) {
                if (Math.hypot(screenX, screenY) <= DRAG_THRESHOLD_PX) return;
                state = { id: item.id, fromIndex: index, overIndex: index, dx: 0, dy: 0, phase: "dragging", promptTarget: null };
                suppressClickRef.current = true;
                window.getSelection()?.removeAllRanges();
                document.documentElement.classList.add("creation-reference-grabbing");
            }
            const { props: current, step: currentStep } = latest.current;
            const dx = toLayoutPx(screenX);
            const dy = toLayoutPx(screenY);
            // 只有图片能替换提示词里的 @图片；停在别的 @ 上或拖离这一行太远时，其余卡片回到原位。
            const target = creationAttachmentKind(item) === "image" ? current.findPromptImageAt(moveEvent.clientX, moveEvent.clientY) : undefined;
            const promptTarget = target?.attachmentId && target.attachmentId !== item.id ? { referenceId: target.id, attachmentId: target.attachmentId } : null;
            const nearRow = Math.abs(dy) <= size.height;
            const overIndex = nearRow && !promptTarget ? clamp(Math.round(index + dx / currentStep), 0, current.attachments.length - 1) : index;
            if (state.promptTarget?.referenceId !== promptTarget?.referenceId) current.onPromptDropTargetChange(promptTarget?.referenceId || null);
            state = { ...state, dx, dy, overIndex, promptTarget };
            dragRef.current = state;
            render();
        };
        const finish = (cancelled: boolean) => {
            stop();
            if (!state) return;
            const finished = state;
            const { props: current } = latest.current;
            // click 在 pointerup 之后才派发：这一拍里不打开预览。
            window.setTimeout(() => {
                suppressClickRef.current = false;
            }, 0);
            current.onPromptDropTargetChange(null);
            if (!cancelled && finished.promptTarget) {
                window.cancelAnimationFrame(frameRef.current);
                frameRef.current = 0;
                dragRef.current = null;
                setDrag(null);
                current.onReplaceWithAttachment(finished.promptTarget.attachmentId, item);
                return;
            }
            settle(finished, cancelled ? finished.fromIndex : finished.overIndex, !cancelled && finished.overIndex !== finished.fromIndex);
        };
        const up = (upEvent: globalThis.PointerEvent) => {
            if (upEvent.pointerId === pointerId) finish(false);
        };
        const cancel = () => finish(true);
        const escape = (keyEvent: globalThis.KeyboardEvent) => {
            if (keyEvent.key !== "Escape" || !state) return;
            keyEvent.preventDefault();
            finish(true);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", cancel);
        window.addEventListener("keydown", escape);
        window.addEventListener("blur", cancel);
        stopPointerRef.current = stop;
    };

    // 键盘：聚焦卡片后按 Alt + ←/→ 换顺序。
    const moveWithKeyboard = (event: KeyboardEvent<HTMLLIElement>, item: CreationAttachment, index: number) => {
        if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight") || props.busy || dragRef.current) return;
        event.preventDefault();
        refocusIdRef.current = item.id;
        if (!commitMove(item.id, index + (event.key === "ArrowLeft" ? -1 : 1))) refocusIdRef.current = null;
    };

    const preview = (type: "image" | "video", url: string) => {
        if (!suppressClickRef.current && !dragRef.current) props.onPreview(type, url);
    };

    const openMenu = (next: boolean) => {
        window.clearTimeout(timersRef.current.menu);
        if (!next) {
            setMenuOpen(false);
            return;
        }
        // 「+」还是一摞右下角的小圆点时先展开，等它滑到末尾再弹菜单，菜单才对得上位置。
        if (!expanded) {
            setHovered(true);
            timersRef.current.menu = window.setTimeout(() => setMenuOpen(true), reducedMotion ? 0 : SETTLE_MS);
            return;
        }
        setMenuOpen(true);
    };

    const chooseSource = (key: string) => {
        setMenuOpen(false);
        if (key === "library") {
            props.onOpenLibrary();
            return;
        }
        // 文件选择必须在这次点击里同步打开，浏览器才允许弹出。
        if (props.onBeforeUpload()) uploadInputRef.current?.click();
    };

    // 拖进来的本机图片、生成结果：图片卡片上放下即替换这一张；「+」上放下加到最后；其余位置交给输入框（同样加到最后）。
    const acceptDrop = (event: DragEvent<HTMLElement>, target: string, enabled: boolean) => {
        if (!hasCreationReferenceDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = enabled ? "copy" : "none";
        if (enabled && dropTarget !== target) setDropTarget(target);
    };
    const leaveDrop = (event: DragEvent<HTMLElement>, target: string) => {
        if (dropTarget !== target) return;
        const related = event.relatedTarget as Node | null;
        if (related && event.currentTarget.contains(related)) return;
        // Chrome、Safari 的 dragleave 不带 relatedTarget，从图片移到编号或按钮上也会触发：指针还在这张卡片里就不算离开。
        const rect = event.currentTarget.getBoundingClientRect();
        if (!related && event.clientX > rect.left && event.clientX < rect.right && event.clientY > rect.top && event.clientY < rect.bottom) return;
        setDropTarget(null);
    };
    const dropOnCard = (event: DragEvent<HTMLElement>, item: CreationAttachment) => {
        if (!hasCreationReferenceDrag(event.dataTransfer)) return;
        event.preventDefault();
        setDropTarget(null);
        if (props.busy) return;
        const { resultImage, files } = readCreationReferenceDrop(event.dataTransfer);
        if (resultImage) props.onDropResultImage(resultImage, item.id);
        else if (files.length) props.onReplaceWithFiles(item.id, files);
    };
    const dropOnAdd = (event: DragEvent<HTMLElement>) => {
        if (!hasCreationReferenceDrag(event.dataTransfer)) return;
        event.preventDefault();
        setDropTarget(null);
        if (props.canAdd) props.onDropAdd(event.dataTransfer);
    };

    const rootStyle = {
        "--ref-card-w": `${size.width}px`,
        "--ref-card-h": `${size.height}px`,
        "--ref-mini": `${size.mini}px`,
        "--ref-step": `${step}px`,
        "--ref-count": count,
        "--add-tilt": `${FANNED_TILT[count % FANNED_TILT.length]}deg`,
    } as CSSProperties;
    const rootClassName = [
        "creation-reference-stack",
        `is-${props.layout}`,
        `is-${props.variant}`,
        expanded ? "is-expanded" : "is-collapsed",
        dragging ? "is-dragging" : "",
        externalDrag ? "is-receiving" : "",
        slots > 1 ? "has-fan" : "",
        stacked && count > 1 && !props.busy ? "can-reorder" : "",
    ]
        .filter(Boolean)
        .join(" ");
    const addMini = stacked && !expanded && count > 0;
    const addCard = props.showAdd ? (
        <Dropdown
            open={menuOpen}
            onOpenChange={openMenu}
            trigger={["click"]}
            disabled={!props.canAdd}
            menu={{ items: ADD_MENU_ITEMS, onClick: ({ key }) => chooseSource(String(key)), "aria-label": `添加${props.noun}` }}
            placement={props.variant === "thread" ? "topLeft" : "bottomLeft"}
            autoAdjustOverflow
            arrow={false}
            classNames={{ root: "creation-mode-menu creation-reference-add-menu" }}
            getPopupContainer={() => document.body}
        >
            <button
                type="button"
                className={["creation-reference-add-button", addMini ? "is-mini" : "", dropTarget === "add" ? "is-drop-target" : externalDrag && props.canAdd ? "is-drop-ready" : ""].filter(Boolean).join(" ")}
                disabled={!props.canAdd}
                aria-label={props.addLabel}
                title={props.addLabel}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onDragOver={(event) => acceptDrop(event, "add", props.canAdd)}
                onDragLeave={(event) => leaveDrop(event, "add")}
                onDrop={dropOnAdd}
            >
                {props.uploading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
                {/* 「+」下面写清楚加的是什么（同即梦的上传卡片）；缩成小圆点时隐藏。 */}
                <span className="creation-reference-add-caption" aria-hidden="true">
                    {props.noun}
                </span>
            </button>
        </Dropdown>
    ) : null;

    return (
        <div
            ref={rootRef}
            className={rootClassName}
            style={rootStyle}
            role="group"
            aria-label={props.noun}
            aria-busy={props.busy || props.uploading}
            onMouseEnter={() => {
                if (!stacked) return;
                window.clearTimeout(timersRef.current.hover);
                timersRef.current.hover = window.setTimeout(() => setHovered(true), HOVER_DELAY_MS);
            }}
            onMouseLeave={() => {
                window.clearTimeout(timersRef.current.hover);
                setHovered(false);
            }}
            // 只有键盘聚焦才展开：鼠标点过的按钮会一直留着焦点，不能让卡片因此一直摊开。
            onFocus={(event) => {
                if (event.target.matches(":focus-visible")) setFocused(true);
            }}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
            }}
        >
            {stacked ? <div className="creation-reference-stack-backdrop" aria-hidden="true" /> : null}
            {stacked ? null : addCard}
            {count ? (
                <ul className="creation-reference-stack-list" aria-label={`已添加的${props.noun}`}>
                    {props.attachments.map((item, index) => {
                        const isDragged = drag?.id === item.id;
                        const slot = expanded ? projectedSlot(index, drag) : 0;
                        const tilt = expanded ? FANNED_TILT[slot % FANNED_TILT.length] : STACKED_TILT[index % STACKED_TILT.length];
                        const style = { "--slot": slot, "--tilt": `${tilt}deg`, "--z": expanded ? slot + 1 : count - index + 1 } as CSSProperties;
                        // 拖动中这一张跟着指针走，保持悬停时的上浮、摆正、略放大；放手后去掉这些覆盖，靠过渡滑回自己的位置。
                        if (isDragged && drag?.phase === "dragging") Object.assign(style, { translate: `${drag.fromIndex * step + drag.dx}px calc(${drag.dy}px + var(--ref-lift))`, rotate: "0deg", scale: "1.08", transition: "none" });
                        const image = creationAttachmentKind(item) === "image";
                        return (
                            <li
                                key={item.id}
                                data-reference-id={item.id}
                                className={["creation-reference-stack-item", entering.has(item.id) ? "is-entering" : "", isDragged ? "is-dragged" : "", dropTarget === item.id ? "is-drop-target" : ""].filter(Boolean).join(" ")}
                                style={style}
                                onPointerDown={(event) => beginPointer(event, item, index)}
                                onKeyDown={(event) => moveWithKeyboard(event, item, index)}
                                // 卡片自己做拖动排序，不让浏览器把里面的图片当文件拖出去。
                                onDragStart={(event) => event.preventDefault()}
                                onDragOver={image ? (event) => acceptDrop(event, item.id, !props.busy) : undefined}
                                onDragLeave={image ? (event) => leaveDrop(event, item.id) : undefined}
                                onDrop={image ? (event) => dropOnCard(event, item) : undefined}
                            >
                                <CreationReferenceCard item={item} label={props.labels.get(item.id)} onPreview={preview} onRemove={props.onRemove} onMention={props.onMention} />
                            </li>
                        );
                    })}
                </ul>
            ) : null}
            {stacked ? addCard : null}
            <input
                ref={uploadInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                    const files = Array.from(event.currentTarget.files || []);
                    event.currentTarget.value = "";
                    if (files.length) props.onUploadFiles(files);
                }}
            />
            <p className="sr-only" aria-live="polite">
                {announcement || props.status}
            </p>
        </div>
    );
}

/** 一张参考素材卡片：点开放大预览；悬停时右上角移除、左下角「@」引用到提示词。 */
function CreationReferenceCard({ item, label, onPreview, onRemove, onMention }: { item: CreationAttachment; label?: string; onPreview: (type: "image" | "video", url: string) => void; onRemove: (id: string) => void; onMention?: (id: string) => void }) {
    const kind = creationAttachmentKind(item);
    const previewable = kind === "image" || kind === "video";
    const url = (kind === "video" ? item.url : item.previewUrl) || "";
    const imageUrl = kind === "image" ? resolveResourceUrl(item.storageKey, item.previewUrl) : "";
    const previewUrl = kind === "image" ? imageUrl : url;
    const title = label ? `${label} · ${item.name}` : item.name;
    const content =
        kind === "video" ? (
            <video src={item.url} poster={item.previewUrl !== item.url ? item.previewUrl : undefined} muted playsInline preload="metadata" aria-label={item.name} />
        ) : kind === "image" ? (
            <CachedResourceImage
                storageKey={item.storageKey}
                src={imageUrl}
                alt={item.name}
                loading="lazy"
                decoding="async"
                draggable={false}
                fallback={
                    <span className="creation-chat-file-icon">
                        <ImageIcon />
                    </span>
                }
            />
        ) : (
            <span className="creation-chat-file-icon">
                {kind === "audio" ? <Music2 /> : <FileText />}
                <em>{item.name}</em>
            </span>
        );
    return (
        <div className="creation-reference-card">
            <div className="creation-reference-card-media">
                {previewable ? (
                    <button
                        type="button"
                        className="creation-reference-card-preview"
                        onClick={() => onPreview(kind === "video" ? "video" : "image", previewUrl)}
                        aria-label={`放大预览${label ? ` ${label}` : ""} ${item.name}`}
                        title={title}
                        disabled={!previewUrl}
                    >
                        {content}
                    </button>
                ) : (
                    <div className="creation-reference-card-preview is-file" aria-label={title} title={title}>
                        {content}
                    </div>
                )}
            </div>
            {label ? (
                <span className="creation-reference-card-label" aria-hidden="true">
                    {label}
                </span>
            ) : null}
            <button
                type="button"
                className="creation-reference-card-action is-remove"
                onPointerDownCapture={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation();
                    onRemove(item.id);
                }}
                aria-label={`移除 ${item.name}`}
                title="移除"
            >
                <X aria-hidden="true" />
            </button>
            {onMention ? (
                <button
                    type="button"
                    className="creation-reference-card-action is-mention"
                    onPointerDownCapture={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        onMention(item.id);
                    }}
                    aria-label={`在提示词里引用${label || item.name}`}
                    title="引用到提示词"
                >
                    <AtSign aria-hidden="true" />
                </button>
            ) : null}
        </div>
    );
}

/** 拖动时其余卡片让出位置：被拖的那张占目标位，中间的依次挪一格。 */
function projectedSlot(index: number, drag: DragState | null) {
    if (!drag) return index;
    const { fromIndex, overIndex } = drag;
    if (index === fromIndex) return overIndex;
    if (fromIndex < overIndex && index > fromIndex && index <= overIndex) return index - 1;
    if (fromIndex > overIndex && index >= overIndex && index < fromIndex) return index + 1;
    return index;
}

function moveAttachment(attachments: CreationAttachment[], id: string, toIndex: number) {
    const from = attachments.findIndex((item) => item.id === id);
    const target = clamp(toIndex, 0, attachments.length - 1);
    if (from < 0 || target === from) return attachments;
    const next = [...attachments];
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved);
    return next;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

/** 新加入的卡片播一次弹出；只标记新增的那几张，避免换顺序时被移动的节点重播动画。 */
function useEnteringIds(attachments: CreationAttachment[]) {
    const [entering, setEntering] = useState<ReadonlySet<string>>(() => new Set());
    const knownRef = useRef<Set<string> | null>(null);
    const timersRef = useRef<number[]>([]);
    const ids = attachments.map((item) => item.id).join("\n");
    useLayoutEffect(() => {
        const current = ids ? ids.split("\n") : [];
        const known = knownRef.current;
        knownRef.current = new Set(current);
        if (!known) return;
        const added = current.filter((id) => !known.has(id));
        if (!added.length) return;
        setEntering((value) => new Set([...value, ...added]));
        timersRef.current.push(
            window.setTimeout(() => {
                setEntering((value) => new Set([...value].filter((id) => !added.includes(id))));
            }, SETTLE_MS + 60),
        );
    }, [ids]);
    useEffect(() => {
        const timers = timersRef.current;
        return () => timers.forEach((timer) => window.clearTimeout(timer));
    }, []);
    return entering;
}

/** 页面上正在拖本机图片或生成结果（还没放下）：参考素材先展开，方便对准某一张替换。 */
function useExternalReferenceDrag() {
    const [active, setActive] = useState(false);
    useEffect(() => {
        let depth = 0;
        let leaveTimer = 0;
        const enter = (event: globalThis.DragEvent) => {
            if (!hasCreationReferenceDrag(event.dataTransfer)) return;
            window.clearTimeout(leaveTimer);
            depth += 1;
            setActive(true);
        };
        const leave = (event: globalThis.DragEvent) => {
            if (!hasCreationReferenceDrag(event.dataTransfer)) return;
            depth = Math.max(0, depth - 1);
            if (depth === 0) leaveTimer = window.setTimeout(() => setActive(false), 50);
        };
        const end = () => {
            window.clearTimeout(leaveTimer);
            depth = 0;
            setActive(false);
        };
        document.addEventListener("dragenter", enter, true);
        document.addEventListener("dragleave", leave, true);
        document.addEventListener("drop", end, true);
        document.addEventListener("dragend", end, true);
        return () => {
            window.clearTimeout(leaveTimer);
            document.removeEventListener("dragenter", enter, true);
            document.removeEventListener("dragleave", leave, true);
            document.removeEventListener("drop", end, true);
            document.removeEventListener("dragend", end, true);
        };
    }, []);
    return active;
}
