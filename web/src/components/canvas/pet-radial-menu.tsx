import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Check, ChevronLeft, EyeOff, LockKeyhole, Palette, Scaling, Sparkles, UnlockKeyhole, X } from "lucide-react";
import type { PetAppearance, PetPreference } from "@/services/api/appearance";
import { petMenuPosition } from "@/lib/canvas/pet-menu";
import { PetThumbnail } from "./pet-thumbnail";
import "./pet-radial-menu.css";

export function PetRadialMenu({
    anchor,
    catalog,
    preference,
    onChange,
    onSelect,
    onClose,
    onPreviewScale,
    error,
    saving,
    onRetry,
    busy,
    loading,
    reducedMotion,
}: {
    anchor: DOMRect;
    catalog: PetAppearance[];
    preference: PetPreference;
    onChange: (patch: Partial<PetPreference>) => void;
    onSelect: (id: string) => void;
    onClose: () => void;
    onPreviewScale: (scale: number | null) => void;
    error: string;
    saving: boolean;
    onRetry: () => void;
    busy: boolean;
    loading: boolean;
    reducedMotion: boolean;
}) {
    const [panel, setPanel] = useState<"" | "look" | "size">("");
    const [more, setMore] = useState(false);
    const [scale, setScale] = useState(preference.scale);
    const host = useRef<HTMLDivElement>(null),
        close = useRef<HTMLButtonElement>(null),
        priorFocus = useRef(document.activeElement as HTMLElement | null),
        scaleRef = useRef(scale),
        changed = useRef(false);
    const placement = petMenuPosition(anchor, { width: window.innerWidth, height: window.innerHeight });
    useEffect(() => {
        setScale(preference.scale);
        scaleRef.current = preference.scale;
    }, [preference.scale]);
    useEffect(() => {
        close.current?.focus();
        const focus = priorFocus.current;
        return () => {
            onPreviewScale(null);
            if (focus?.isConnected) focus.focus();
        };
    }, [onPreviewScale]);
    useEffect(() => {
        const closeMenu = () => onClose();
        window.addEventListener("resize", closeMenu);
        return () => window.removeEventListener("resize", closeMenu);
    }, [onClose]);
    const commit = () => {
        if (changed.current) {
            changed.current = false;
            onChange({ scale: scaleRef.current });
        }
    };
    return createPortal(
        <motion.div
            className="pet-menu-layer app-user-overlays"
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.12 }}
            data-canvas-no-zoom
            data-canvas-wheel-scroll
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                    e.preventDefault();
                    commit();
                    onClose();
                    return;
                }
                if (e.key === "Tab") {
                    const nodes = Array.from(host.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled)") || []).filter((el) => el.getClientRects().length);
                    const first = nodes[0],
                        last = nodes.at(-1);
                    if (e.shiftKey && document.activeElement === first) {
                        e.preventDefault();
                        last?.focus();
                    } else if (!e.shiftKey && document.activeElement === last) {
                        e.preventDefault();
                        first?.focus();
                    }
                }
            }}
        >
            <div
                className="pet-menu-backdrop"
                onClick={() => {
                    commit();
                    onClose();
                }}
            />
            <motion.div
                ref={host}
                role="dialog"
                aria-modal="true"
                aria-label="宠物设置"
                className={`pet-radial-menu ${placement.right ? "is-right" : "is-left"} ${placement.bottom ? "is-bottom" : "is-top"} ${more ? "is-more" : ""}`}
                style={{ left: placement.left, top: placement.top, width: placement.width, height: placement.height, transformOrigin: `${placement.right ? "right" : "left"} ${placement.bottom ? "bottom" : "top"}` }}
                initial={reducedMotion ? false : { opacity: 0, scale: 0.96, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.98, y: reducedMotion ? 0 : 4 }}
                transition={{ duration: reducedMotion ? 0 : 0.18, ease: "easeOut" }}
            >
                <button
                    ref={close}
                    type="button"
                    className="pet-menu-close"
                    aria-label="关闭宠物设置"
                    onClick={() => {
                        commit();
                        onClose();
                    }}
                >
                    <X />
                </button>
                <div className="pet-menu-actions" aria-label="宠物快捷操作">
                    <button
                        type="button"
                        className="pet-menu-petal pet-menu-look"
                        aria-expanded={panel === "look"}
                        onClick={() => {
                            commit();
                            setMore(false);
                            setPanel(panel === "look" ? "" : "look");
                        }}
                    >
                        <Palette />
                        <span>换形象</span>
                    </button>
                    <button
                        type="button"
                        className="pet-menu-petal pet-menu-size"
                        aria-expanded={panel === "size"}
                        onClick={() => {
                            setMore(false);
                            setPanel(panel === "size" ? "" : "size");
                        }}
                    >
                        <Scaling />
                        <span>调大小</span>
                    </button>
                    <button type="button" className="pet-menu-petal pet-menu-lock" aria-pressed={preference.locked} disabled={loading} onClick={() => onChange({ locked: !preference.locked })}>
                        {preference.locked ? <UnlockKeyhole /> : <LockKeyhole />}
                        <span>{preference.locked ? "解锁位置" : "锁位置"}</span>
                    </button>
                    <button
                        type="button"
                        className="pet-menu-petal pet-menu-hide"
                        disabled={loading}
                        onClick={() => {
                            commit();
                            onChange({ hidden: true });
                            onClose();
                        }}
                    >
                        <EyeOff />
                        <span>暂时收起</span>
                    </button>
                </div>
                {panel === "look" ? (
                    <div className={`pet-menu-models ${more ? "is-grid" : ""}`} aria-label="选择宠物形象">
                        {more ? (
                            <button type="button" className="pet-menu-back" onClick={() => setMore(false)}>
                                <ChevronLeft />
                                返回
                            </button>
                        ) : null}
                        {[{ id: "system", name: "跟随系统", published: true } as PetAppearance, ...catalog.filter((p) => p.published)].slice(0, more ? 25 : 5).map((pet, index) => (
                            <button
                                key={pet.id}
                                type="button"
                                className="pet-model-choice"
                                style={{ "--pet-choice-index": index } as React.CSSProperties}
                                disabled={busy || loading}
                                aria-pressed={pet.id === preference.modelId}
                                onClick={() => onSelect(pet.id)}
                            >
                                {pet.id === "system" ? <Sparkles aria-hidden /> : <PetThumbnail pet={pet} />}
                                <span>{pet.name}</span>
                                {pet.id === preference.modelId ? <Check className="pet-choice-check" aria-hidden /> : null}
                            </button>
                        ))}
                        {!more && catalog.length + 1 > 5 ? (
                            <button type="button" className="pet-menu-more" onClick={() => setMore(true)}>
                                更多形象
                            </button>
                        ) : null}
                    </div>
                ) : null}
                {panel === "size" ? (
                    <div className="pet-menu-size-panel">
                        <label htmlFor="pet-personal-scale">
                            宠物大小 <output>{scale}%</output>
                        </label>
                        <input
                            id="pet-personal-scale"
                            type="range"
                            min={50}
                            max={150}
                            step={5}
                            value={scale}
                            disabled={loading}
                            aria-valuetext={`${scale}%`}
                            onChange={(e) => {
                                const next = Number(e.target.value);
                                setScale(next);
                                scaleRef.current = next;
                                changed.current = true;
                                onPreviewScale(next);
                            }}
                            onPointerUp={commit}
                            onKeyUp={commit}
                            onBlur={commit}
                            onPointerCancel={() => {
                                changed.current = false;
                                setScale(preference.scale);
                                scaleRef.current = preference.scale;
                                onPreviewScale(null);
                            }}
                        />
                        <div>
                            <span>小</span>
                            <button
                                type="button"
                                disabled={loading}
                                onClick={() => {
                                    setScale(100);
                                    scaleRef.current = 100;
                                    changed.current = false;
                                    onPreviewScale(100);
                                    onChange({ scale: 100 });
                                }}
                            >
                                恢复默认
                            </button>
                            <span>大</span>
                        </div>
                    </div>
                ) : null}
                <div className="pet-menu-feedback" role="status" aria-live="polite" hidden={!busy && !loading && !saving && !error}>
                    {busy ? (
                        "正在准备新形象…"
                    ) : loading ? (
                        "正在读取个人设置…"
                    ) : saving ? (
                        "正在保存…"
                    ) : error ? (
                        <>
                            <span>{error}</span>
                            <button type="button" onClick={onRetry}>
                                重试保存
                            </button>
                        </>
                    ) : null}
                </div>
            </motion.div>
        </motion.div>,
        document.body,
    );
}
