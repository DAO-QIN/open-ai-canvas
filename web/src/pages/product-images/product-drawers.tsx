import { useEffect, useRef, useState } from "react";
import { App, Button, Input } from "antd";
import { useBlocker } from "react-router";
import { AppDrawer } from "@/components/ui/product/app-drawer";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { Select } from "@/components/ui/base/select";
import { ProductQualityResult } from "./quality-result";
import { currentVersion, type ProductBranch, type ProductCommand, type ProductPlan, type ProductRefinement, type ProductSlot } from "@/lib/ecommerce/contracts";

export function useUnsavedDraft(dirty: boolean) {
    const { modal } = App.useApp();
    const openRef = useRef(false);
    const [confirming, setConfirming] = useState(false);
    const blocker = useBlocker(dirty);
    useEffect(() => {
        if (!dirty) return;
        const handler = (event: BeforeUnloadEvent) => {
            event.preventDefault();
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [dirty]);
    useEffect(() => {
        if (blocker.state !== "blocked" || openRef.current) return;
        openRef.current = true;
        setConfirming(true);
        modal.confirm({
            title: "还有未保存的修改",
            content: "离开会丢弃这次修改，已保存的作品会保留。",
            okText: "丢弃并离开",
            cancelText: "继续编辑",
            onOk: () => blocker.proceed(),
            onCancel: () => blocker.reset(),
            afterClose: () => {
                openRef.current = false;
                setConfirming(false);
            },
        });
    }, [blocker, modal]);
    return {
        confirming,
        close: (close: () => void) => {
            if (!dirty) {
                close();
                return;
            }
            if (openRef.current) return;
            openRef.current = true;
            setConfirming(true);
            modal.confirm({
                title: "丢弃未保存的修改？",
                okText: "丢弃修改",
                cancelText: "继续编辑",
                onOk: close,
                afterClose: () => {
                    openRef.current = false;
                    setConfirming(false);
                },
            });
        },
    };
}
export function PlanDrawer({
    branch,
    revision,
    busy,
    onCommand,
    onClose,
    readOnly: locked = false,
}: {
    branch: ProductBranch;
    revision: number;
    busy: boolean;
    readOnly?: boolean;
    onCommand: (command: ProductCommand) => Promise<void>;
    onClose: () => void;
}) {
    const [draft, setDraft] = useState<ProductPlan>(() => structuredClone(branch.plan!));
    const [base] = useState(() => ({ branchRevision: branch.revision, productRevision: revision, plan: JSON.stringify(branch.plan) }));
    const dirty = JSON.stringify(draft) !== base.plan;
    const { close, confirming } = useUnsavedDraft(dirty);
    const readOnly = locked || Boolean(branch.approvedAt);
    const updateScreen = (index: number, field: "title" | "copy" | "brief", value: string) =>
        setDraft((plan) => ({
            ...plan,
            screens: plan.screens.map((screen, at) => {
                if (at !== index) return screen;
                const next = { ...screen, [field]: value };
                if (field === "copy")
                    next.design = {
                        ...screen.design,
                        textBlocks: value
                            ? value
                                  .split("\n")
                                  .filter(Boolean)
                                  .map((text, i) => ({ role: screen.design.textBlocks[i]?.role || (i ? "support" : "headline"), placement: screen.design.textBlocks[i]?.placement || "按已确认版式安排", text }))
                            : [],
                    };
                return next;
            }),
        }));
    return (
        <AppDrawer
            focusable={{ trap: !confirming }}
            title={(branch.kind === "hero" ? "主图" : "详情图") + "方案"}
            open
            size={680}
            onClose={() => close(onClose)}
            footer={
                <div className="flex flex-wrap justify-end gap-2">
                    <Button disabled={busy} onClick={() => close(onClose)}>
                        关闭
                    </Button>
                    {!readOnly && (
                        <Button
                            type="primary"
                            loading={busy}
                            disabled={!dirty}
                            onClick={async () => {
                                await onCommand({ action: "save-plan", operationId: crypto.randomUUID(), revision: base.productRevision, branch: branch.kind, branchRevision: base.branchRevision, plan: draft })
                                    .then(onClose)
                                    .catch(() => undefined);
                            }}
                        >
                            保存方案
                        </Button>
                    )}
                </div>
            }
        >
            <div className="space-y-5">
                <p className="text-sm leading-6 text-foreground/60">{readOnly ? "这份方案已经确认，将用于对应图片的细化与生成。" : "检查用途、构图和准确文案，确认后才生成套图。"} 结构检查通过后，仍需检查成图是否符合商品事实。</p>
                <div className="rounded-xl bg-surface-hover p-4 text-sm">
                    <p className="font-medium">{draft.productAnalysis.identity}</p>
                    <p className="mt-2">已确认：{draft.productAnalysis.confirmedSellingPoints.join("；") || "未补充"}</p>
                    <p className="mt-2 text-foreground/60">待核实：{draft.productAnalysis.unknowns.join("；") || "无"}</p>
                </div>
                {draft.screens.map((screen, index) => (
                    <section key={screen.slotId} className="space-y-3 rounded-xl bg-surface-hover p-4">
                        <h3 className="text-sm font-semibold">
                            {index + 1}. {screen.title}
                        </h3>
                        <label className="block space-y-2 text-sm">
                            图片用途
                            <Input aria-label={"第" + (index + 1) + "张用途"} value={screen.title} maxLength={200} disabled={readOnly || busy} onChange={(event) => updateScreen(index, "title", event.target.value)} />
                        </label>
                        <label className="block space-y-2 text-sm">
                            构图与依据
                            <Input.TextArea
                                aria-label={"第" + (index + 1) + "张构图"}
                                autoSize={{ minRows: 2, maxRows: 8 }}
                                value={screen.brief}
                                maxLength={4000}
                                disabled={readOnly || busy}
                                onChange={(event) => updateScreen(index, "brief", event.target.value)}
                            />
                        </label>
                        {(branch.config?.[branch.kind].copyMode !== "none" || screen.copy) && (
                            <label className="block space-y-2 text-sm">
                                准确文案
                                <Input.TextArea
                                    aria-label={"第" + (index + 1) + "张准确文案"}
                                    autoSize={{ minRows: 2, maxRows: 8 }}
                                    value={screen.copy}
                                    maxLength={4000}
                                    disabled={readOnly || busy}
                                    onChange={(event) => updateScreen(index, "copy", event.target.value)}
                                />
                            </label>
                        )}
                        <p className="text-xs text-foreground/60">
                            {screen.design.evidence} · {screen.design.focus}
                        </p>
                    </section>
                ))}
                {!readOnly && branch.history.length > 0 && (
                    <Button
                        disabled={busy || dirty}
                        onClick={async () => {
                            await onCommand({ action: "restore-plan", operationId: crypto.randomUUID(), revision: base.productRevision, branch: branch.kind, branchRevision: base.branchRevision })
                                .then(onClose)
                                .catch(() => undefined);
                        }}
                    >
                        恢复上一个方案版本
                    </Button>
                )}
            </div>
        </AppDrawer>
    );
}
export function ImageDrawer({
    slot,
    revision,
    copyMode,
    busy,
    onCommand,
    onRegenerate,
    onClose,
    readOnly = false,
}: {
    slot: ProductSlot;
    revision: number;
    copyMode: "none" | "typeset";
    busy: boolean;
    onCommand: (command: ProductCommand) => Promise<void>;
    onRegenerate: () => void;
    onClose: () => void;
    readOnly?: boolean;
}) {
    const initial = slot.draft || slot.refinement;
    const [draft, setDraft] = useState<ProductRefinement>(() => structuredClone(initial ?? { slotId: slot.id, kind: slot.kind, title: slot.title, copy: slot.copy, visualPlan: {}, generationPrompt: "", prompt: "" }));
    const [base] = useState(() => ({ revision, slotRevision: slot.revision, text: JSON.stringify(initial) }));
    const [compare, setCompare] = useState(slot.versions[1]?.id ?? "");
    const dirty = initial !== undefined && JSON.stringify(draft) !== base.text;
    const { close, confirming } = useUnsavedDraft(dirty);
    const selected = currentVersion(slot);
    const other = slot.versions.find((version) => version.id === compare);
    const settling = slot.status === "submitted" || slot.status === "uncertain";
    return (
        <AppDrawer
            focusable={{ trap: !confirming }}
            title={(slot.kind === "hero" ? "主图" : "详情图") + " " + slot.index + " · 调整与版本"}
            open
            size={760}
            onClose={() => close(onClose)}
            footer={
                <div className="flex flex-wrap justify-end gap-2">
                    <Button disabled={busy} onClick={() => close(onClose)}>
                        关闭
                    </Button>
                    <Button
                        type="primary"
                        loading={busy}
                        disabled={readOnly || !dirty || settling}
                        onClick={async () => {
                            await onCommand({ action: "save-draft", operationId: crypto.randomUUID(), revision: base.revision, slotId: slot.id, slotRevision: base.slotRevision, draft })
                                .then(onClose)
                                .catch(() => undefined);
                        }}
                    >
                        保存调整
                    </Button>
                    <Button
                        disabled={readOnly || dirty || busy || settling || !initial}
                        onClick={() => {
                            onClose();
                            onRegenerate();
                        }}
                    >
                        重新报价并生成
                    </Button>
                </div>
            }
        >
            <div className="space-y-5">
                <p className="text-sm text-foreground/60">重做会保留旧图、其它图片和标题，继续以原商品图作为参考。</p>
                <div className="grid gap-4 sm:grid-cols-2">
                    {[selected, other].map((version, index) => (
                        <div key={index} className="overflow-hidden rounded-xl bg-surface-hover">
                            {version ? (
                                <CachedResourceImage storageKey={"resource:" + version.resourceId} alt={"商品图片版本 " + version.number} className="aspect-square w-full object-contain" />
                            ) : (
                                <div className="flex aspect-square items-center justify-center text-sm text-foreground/60">暂无可比较版本</div>
                            )}
                            <p className="p-3 text-sm">
                                {index ? "对比版本" : "当前版本"}
                                {version ? " · " + version.number : ""}
                            </p>
                            {version && (
                                <div className="px-3 pb-3">
                                    <ProductQualityResult slot={slot} versionId={version.id} detailed />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                {slot.versions.length > 1 && (
                    <div className="flex flex-wrap items-center gap-2">
                        <Select className="min-w-40" ariaLabel="比较图片版本" value={compare} options={slot.versions.map((v) => ({ value: v.id, label: "版本 " + v.number }))} onChange={setCompare} />
                        <Button
                            disabled={readOnly || !other || busy || dirty || other.id === slot.selectedVersionId}
                            onClick={async () => {
                                await onCommand({ action: "select-version", revision: base.revision, operationId: crypto.randomUUID(), slotId: slot.id, slotRevision: base.slotRevision, versionId: compare })
                                    .then(onClose)
                                    .catch(() => undefined);
                            }}
                        >
                            使用这个版本
                        </Button>
                    </div>
                )}
                {copyMode === "typeset" && (
                    <label className="block space-y-2 text-sm">
                        本图文案
                        <Input.TextArea
                            aria-label="本图调整文案"
                            autoSize={{ minRows: 2, maxRows: 6 }}
                            maxLength={4000}
                            value={draft.copy}
                            disabled={readOnly || busy || settling || !initial}
                            onChange={(event) => setDraft({ ...draft, copy: event.target.value, prompt: draft.copy ? draft.prompt.replace(draft.copy, event.target.value) : draft.prompt + "\n准确文案：" + event.target.value })}
                        />
                    </label>
                )}
                <details>
                    <summary className="cursor-pointer text-sm">专业提示词</summary>
                    <Input.TextArea
                        className="mt-3"
                        aria-label="单图生成提示词"
                        autoSize={{ minRows: 5, maxRows: 15 }}
                        maxLength={16000}
                        value={draft.prompt}
                        disabled={readOnly || busy || settling || !initial}
                        onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                    />
                </details>
                {draft.repairs?.length ? <p className="text-xs text-foreground/60">本图细化进行了有限本地修复，未额外调用模型。</p> : null}
            </div>
        </AppDrawer>
    );
}
