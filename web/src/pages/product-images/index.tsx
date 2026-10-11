import { useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { App, Alert, Button, Checkbox, Input, InputNumber, Skeleton } from "antd";
import { flushSync } from "react-dom";
import { EmptyState } from "@/components/ui/product/empty-state";
import { ArrowLeft, Copy, Download, ImagePlus, LayoutGrid, Pause, RefreshCw, Settings2, Sparkles, Trash2, Upload } from "lucide-react";
import { saveAs } from "file-saver";
import { WorkspacePage, PageHeader, PaginationBar } from "@/components/layout/workspace-page";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { AppDrawer } from "@/components/ui/product/app-drawer";
import { Select } from "@/components/ui/base/select";
import { useUserStore } from "@/stores/use-user-store";
import { uploadResourceFile, resourceIdFromStorageKey } from "@/services/api/resources";
import { batchCommandProducts, commandProduct, exportProducts, fetchProduct, importProducts, quoteProduct, saveProductPreset, updateProduct, deleteProductDraft, setProductImagesEnabled } from "@/services/api/ecommerce";
import type { EcommerceOptions } from "@/services/api/ecommerce";
import { exportProductRun, recoverProductStep } from "@/services/api/ecommerce";
import { sendProductToCanvas } from "@/services/ecommerce-canvas";
import { completedImages, credits, currentVersion, productStatus, ECOMMERCE_PLUGIN_ID, PRODUCT_IMAGES_ROUTE, type Product, type ProductBranch, type ProductCommand, type ProductConfig, type ProductSlot, type QuoteScope } from "@/lib/ecommerce/contracts";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useProduct, useProductOptions, useProducts, useProductRun } from "./use-products";
import { ProductSettings } from "./product-settings";
import { ProductQuoteModal, type QuotedProduct } from "./quote-modal";
import { ImageDrawer, PlanDrawer, useUnsavedDraft } from "./product-drawers";

export default function ProductImagesPage() {
    const userID = useUserStore((state) => state.user?.id);
    return userID ? <ProductImagesWorkspace key={userID} userID={userID} /> : null;
}
function ProductImagesWorkspace({ userID }: { userID: string }) {
    const { productId } = useParams();
    const [params, setParams] = useSearchParams();
    const tab = params.get("tab") === "history" || Boolean(productId) ? "history" : "start";
    const { message } = App.useApp();
    const navigate = useNavigate();
    const client = useQueryClient();
    const options = useProductOptions();
    const [page, setPage] = useState(1);
    const [archived, setArchived] = useState(false);
    const products = useProducts(page, archived);
    const product = useProduct(productId);
    const [selected, setSelected] = useState<string[]>([]);
    const [quotes, setQuotes] = useState<QuotedProduct[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [quoteError, setQuoteError] = useState("");
    const [resultNote, setResultNote] = useState("");
    const [activationBusy, setActivationBusy] = useState(false);
    const current = () => useUserStore.getState().user?.id === userID;
    const refresh = () => client.invalidateQueries({ queryKey: ["ecommerce", userID] });
    const enabled = options.data?.state.effectiveEnabled === true;
    const setEnabled = async (nextEnabled: boolean) => {
        if (activationBusy || busy) return;
        setActivationBusy(true);
        try {
            const state = await setProductImagesEnabled(nextEnabled);
            if (!current()) return;
            if (state.pluginId !== ECOMMERCE_PLUGIN_ID || state.userEnabled !== nextEnabled) throw new Error("启用状态尚未确认，请刷新核对");
            usePluginStore.getState().setPluginStates({ ...usePluginStore.getState().pluginStates, [state.pluginId]: state });
            message.success(nextEnabled ? "商品套图已启用" : "已暂停你的商品创作，历史作品仍可查看");
        } catch (error) {
            if (current()) message.error(error instanceof Error ? error.message : "状态保存未确认，请刷新核对");
        } finally {
            if (current()) {
                await refresh();
                setActivationBusy(false);
            }
        }
    };
    const prepare = async (items: Product[], scope: (product: Product) => QuoteScope) => {
        if (!enabled || busy || !items.length) return;
        setBusy(true);
        setQuoteError("");
        setResultNote("");
        try {
            const quoted: QuotedProduct[] = [];
            for (const item of items) {
                if (!current()) return;
                try {
                    const fresh = await fetchProduct(item.id);
                    const quote = await quoteProduct(fresh.id, fresh.revision, scope(fresh));
                    quoted.push({ product: fresh, quote });
                } catch (error) {
                    quoted.push({ product: item, error: error instanceof Error ? error.message : "报价失败" });
                }
            }
            if (current()) setQuotes(quoted);
        } finally {
            if (current()) setBusy(false);
        }
    };
    const confirm = async () => {
        if (!quotes || busy) return;
        setBusy(true);
        setQuoteError("");
        try {
            const items = quotes
                .filter((item) => item.quote)
                .map((item) => ({
                    productId: item.product.id,
                    command: { action: item.quote!.scope.action, revision: item.quote!.productRevision, operationId: "ecommerce:" + item.quote!.id, quoteId: item.quote!.id, budgetMicrocredits: item.quote!.budgetMicrocredits } satisfies ProductCommand,
                }));
            const results = await batchCommandProducts(items);
            if (!current()) return;
            const failed = results.filter((item) => item.status !== "success");
            setResultNote(results.filter((item) => item.status === "success").length + " 个商品已提交" + (failed.length ? "；" + failed.map((item) => item.reason).join("；") : ""));
            setQuotes(null);
            await refresh();
        } catch (error) {
            if (!current()) return;
            setQuoteError((error instanceof Error ? error.message : "提交响应未确认") + "。请刷新核对商品状态；重复确认同一报价会返回原操作。");
            await refresh();
        } finally {
            if (current()) setBusy(false);
        }
    };
    const download = async (ids: string[]) => {
        if (busy || !ids.length) return;
        setBusy(true);
        try {
            const blob = await exportProducts(ids);
            if (current()) saveAs(blob, "商品套图.zip");
        } catch (error) {
            if (current()) message.error(error instanceof Error ? error.message : "下载失败，成品仍然保留");
        } finally {
            if (current()) setBusy(false);
        }
    };
    const selectedProducts = products.data?.items.filter((item) => selected.includes(item.id)) ?? [];
    const command = async (item: Product, request: ProductCommand) => {
        if (busy) return;
        setBusy(true);
        try {
            await commandProduct(item.id, request);
            if (current()) await refresh();
        } catch (error) {
            if (current()) {
                message.error(error instanceof Error ? error.message : "操作失败，请刷新核对");
                await refresh();
            }
            throw error;
        } finally {
            if (current()) setBusy(false);
        }
    };
    return (
        <WorkspacePage>
            <div className="mx-auto max-w-7xl space-y-5 pb-8">
                <PageHeader
                    title="商品套图"
                    description="上传商品原图，确认方案，生成统一风格的主图、详情图和标题。"
                    actions={
                        <Button icon={<RefreshCw className="size-4" />} loading={options.isFetching || products.isFetching || product.isFetching} onClick={() => void refresh()}>
                            刷新状态
                        </Button>
                    }
                />
                <nav className="flex gap-2" aria-label="商品套图工作区">
                    <Button
                        type={tab === "start" ? "primary" : "text"}
                        onClick={() => {
                            navigate(PRODUCT_IMAGES_ROUTE);
                            setParams({});
                        }}
                    >
                        开始创作
                    </Button>
                    <Button type={tab === "history" ? "primary" : "text"} onClick={() => navigate(PRODUCT_IMAGES_ROUTE + "?tab=history")}>
                        我的商品
                    </Button>
                </nav>
                {options.isError && <Alert type="error" showIcon title="创作选项读取失败" description={options.error.message} action={<Button onClick={() => void options.refetch()}>重试</Button>} />}
                {options.data && !enabled && (
                    <Alert
                        type="info"
                        showIcon
                        title={options.data.state.blockedReason || "商品套图暂未开放"}
                        description="已提交任务继续收尾；历史作品可以查看和下载。开放后请手动继续未完成的步骤。"
                        action={
                            !options.data.state.userEnabled && options.data.state.platformAvailable ? (
                                <Button loading={activationBusy} disabled={busy} onClick={() => void setEnabled(true)}>
                                    启用商品套图
                                </Button>
                            ) : undefined
                        }
                    />
                )}
                {resultNote && <Alert type="info" showIcon title={resultNote} closable onClose={() => setResultNote("")} />}
                {options.isPending ? (
                    <Skeleton active />
                ) : tab === "start" && options.data ? (
                    <ProductImport
                        options={options.data}
                        disabled={!enabled || busy || activationBusy}
                        onDisable={() => void setEnabled(false)}
                        onImported={async (items, auto) => {
                            if (!current()) return;
                            setSelected(items.map((item) => item.id));
                            navigate(PRODUCT_IMAGES_ROUTE + "?tab=history");
                            await refresh();
                            await prepare(items, () => ({ action: auto ? "auto" : "planning" }));
                        }}
                    />
                ) : productId ? (
                    <>
                        <Link className="inline-flex items-center gap-2 text-sm text-foreground/60" to={PRODUCT_IMAGES_ROUTE + "?tab=history"}>
                            <ArrowLeft className="size-4" />
                            返回我的商品
                        </Link>
                        {product.isPending ? (
                            <Skeleton active />
                        ) : product.isError ? (
                            <Alert type="error" showIcon title={product.error.message} />
                        ) : product.data && options.data ? (
                            <ProductDetail
                                key={product.data.id}
                                product={product.data}
                                options={options.data}
                                enabled={enabled}
                                busy={busy}
                                onCommand={(request) => command(product.data!, request)}
                                onQuote={(scope) => void prepare([product.data!], () => scope)}
                                onDownload={() => void download([product.data!.id])}
                                onChanged={() => void refresh()}
                            />
                        ) : null}
                    </>
                ) : (
                    <section className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <Checkbox
                                checked={selectedProducts.length > 0 && selectedProducts.length === products.data?.items.length}
                                indeterminate={selectedProducts.length > 0 && selectedProducts.length !== products.data?.items.length}
                                onChange={(event) => setSelected(event.target.checked ? (products.data?.items.map((item) => item.id) ?? []) : [])}
                            >
                                选择本页商品
                            </Checkbox>
                            <Checkbox
                                checked={archived}
                                onChange={(event) => {
                                    setArchived(event.target.checked);
                                    setSelected([]);
                                    setPage(1);
                                }}
                            >
                                查看已归档
                            </Checkbox>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface p-4">
                            <p className="mr-auto text-sm">
                                已选 {selectedProducts.length} 个商品 · {selectedProducts.reduce((sum, item) => sum + item.config.hero.count + item.config.detail.count, 0)} 张套图
                            </p>
                            <Button
                                type="primary"
                                icon={<Sparkles className="size-4" />}
                                disabled={!enabled || busy || !selectedProducts.some((item) => !item.run && !item.archived)}
                                onClick={() =>
                                    void prepare(
                                        selectedProducts.filter((item) => !item.run && !item.archived),
                                        () => ({ action: "planning" }),
                                    )
                                }
                            >
                                生成方案与标题
                            </Button>
                            <Button
                                disabled={!enabled || busy || !selectedProducts.some((item) => item.run?.branches.some((branch) => branch.status === "review"))}
                                onClick={() =>
                                    void prepare(
                                        selectedProducts.filter((item) => item.run?.branches.some((branch) => branch.status === "review")),
                                        (item) => ({ action: "generate", branches: item.run!.branches.filter((branch) => branch.status === "review").map((branch) => branch.kind) }),
                                    )
                                }
                            >
                                确认所选套图
                            </Button>
                            <Button icon={<Download className="size-4" />} disabled={busy || !selectedProducts.length} onClick={() => void download(selectedProducts.map((item) => item.id))}>
                                批量打包
                            </Button>
                        </div>
                        {products.isError && <Alert type="error" title={products.error.message} />}
                        {products.isPending ? (
                            <Skeleton active />
                        ) : !products.data?.items.length ? (
                            <EmptyState title={archived ? "暂无归档商品" : "上传原图，开始你的第一套商品图"} />
                        ) : (
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {products.data.items.map((item) => (
                                    <article key={item.id} className="overflow-hidden rounded-2xl bg-surface">
                                        <Link to={PRODUCT_IMAGES_ROUTE + "/" + item.id} aria-label={"查看" + item.name}>
                                            <CachedResourceImage
                                                storageKey={"resource:" + item.sourceResourceId}
                                                alt={item.name}
                                                className="aspect-square w-full object-contain"
                                                fallback={<div className="flex aspect-square items-center justify-center text-sm text-foreground/60">图片暂不可用</div>}
                                            />
                                        </Link>
                                        <div className="space-y-2 p-4">
                                            <div className="flex items-center gap-2">
                                                <Checkbox aria-label={"选择" + item.name} checked={selected.includes(item.id)} onChange={(event) => setSelected((ids) => (event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id)))} />
                                                <Link className="truncate font-medium" to={PRODUCT_IMAGES_ROUTE + "/" + item.id}>
                                                    {item.name}
                                                </Link>
                                            </div>
                                            <p className="text-xs text-foreground/60">
                                                {productStatus(item.run?.status)} · {completedImages(item)}/{item.config.hero.count + item.config.detail.count} 张
                                            </p>
                                            {item.run && <p className="text-xs text-foreground/60">实际 {credits(item.run.actualMicrocredits)} 积分</p>}
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}
                        <PaginationBar
                            current={page}
                            pageSize={20}
                            total={products.data?.total ?? 0}
                            pageSizeOptions={[20]}
                            itemLabel="个商品"
                            onChange={(next) => {
                                setPage(next);
                                setSelected([]);
                            }}
                        />
                    </section>
                )}
            </div>
            <ProductQuoteModal
                items={quotes}
                busy={busy}
                error={quoteError}
                onClose={() => {
                    if (!busy) setQuotes(null);
                }}
                onConfirm={() => void confirm()}
            />
        </WorkspacePage>
    );
}

type UploadItem = { id: string; resourceId: string; name: string; sellingPoints: string };
function ProductImport({ options, disabled, onImported, onDisable }: { options: EcommerceOptions; disabled: boolean; onImported: (items: Product[], auto: boolean) => Promise<void>; onDisable: () => void }) {
    const { message } = App.useApp();
    const userID = useUserStore((state) => state.user?.id);
    const inputRef = useRef<HTMLInputElement>(null);
    const importOperation = useRef(crypto.randomUUID());
    const [config, setConfig] = useState(() => options.presets.find((item) => item.name === "default")?.config ?? options.defaults);
    const [items, setItems] = useState<UploadItem[]>([]);
    const [auto, setAuto] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [picker, setPicker] = useState(false);
    const [presetName, setPresetName] = useState("");
    const [error, setError] = useState("");
    const [saved, setSaved] = useState(false);
    useUnsavedDraft(items.length > 0 && !saved);
    const current = () => useUserStore.getState().user?.id === userID;
    const add = (next: UploadItem[]) => {
        if (items.length + next.length > options.batchLimit) throw new Error("单批最多 " + options.batchLimit + " 个商品");
        setItems((previous) => [...previous, ...next]);
        importOperation.current = crypto.randomUUID();
    };
    const upload = async (files: FileList) => {
        if (disabled || uploading) return;
        if (files.length + items.length > options.batchLimit) {
            message.error("单批最多 " + options.batchLimit + " 个商品");
            return;
        }
        setUploading(true);
        setError("");
        const added: UploadItem[] = [];
        try {
            for (const file of Array.from(files)) {
                if (!file.type.startsWith("image/")) throw new Error("仅支持商品图片");
                const resource = await uploadResourceFile(file, "image", { fileName: file.name, idempotencyKey: crypto.randomUUID() });
                if (!current()) return;
                added.push({ id: crypto.randomUUID(), resourceId: resource.id, name: file.name.replace(/\.[^.]+$/, ""), sellingPoints: "" });
            }
        } catch (error) {
            if (current()) setError(error instanceof Error ? error.message : "上传失败");
        } finally {
            if (current()) {
                if (added.length) add(added);
                setUploading(false);
                if (inputRef.current) inputRef.current.value = "";
            }
        }
    };
    const pick = (_ids: string[], picked?: AssetLibraryPickerItem[]) => {
        try {
            const next = (picked ?? []).map((item) => {
                const resourceId = resourceIdFromStorageKey(item.imageStorageKey);
                if (!resourceId) throw new Error("该素材尚未保存为云端资源，请先在素材库完成同步");
                return { id: crypto.randomUUID(), resourceId, name: item.title, sellingPoints: "" };
            });
            add(next);
            setPicker(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材读取失败");
        }
    };
    const submit = async () => {
        setSubmitting(true);
        setError("");
        try {
            const result = await importProducts({ operationId: importOperation.current, items: items.map(({ resourceId, name, sellingPoints }) => ({ resourceId, name, sellingPoints })), config });
            if (!current()) return;
            flushSync(() => setSaved(true));
            await onImported(result.products, auto);
        } catch (error) {
            if (current()) setError((error instanceof Error ? error.message : "商品导入响应未确认") + "。重复提交同一批会返回原记录。");
        } finally {
            if (current()) setSubmitting(false);
        }
    };
    return (
        <div className="space-y-5 rounded-2xl bg-surface p-5 sm:p-6">
            <div>
                <h2 className="text-lg font-semibold">一张原图，一个商品</h2>
                <p className="mt-2 text-sm leading-6 text-foreground/60">默认 3 张主图、5 张详情图、3 个标题。先查看方案，再决定是否生成图片。</p>
            </div>
            <div className="flex flex-wrap gap-3">
                <input
                    ref={inputRef}
                    type="file"
                    className="sr-only"
                    accept="image/*"
                    multiple
                    aria-label="上传商品原图"
                    onChange={(event) => {
                        if (event.target.files) void upload(event.target.files);
                    }}
                />
                <Button type="primary" icon={<Upload className="size-4" />} loading={uploading} disabled={disabled || submitting} onClick={() => inputRef.current?.click()}>
                    上传商品图片
                </Button>
                <Button icon={<ImagePlus className="size-4" />} disabled={disabled || submitting || uploading} onClick={() => setPicker(true)}>
                    从素材库选择
                </Button>
                <span className="self-center text-xs text-foreground/60">
                    {items.length}/{options.batchLimit} 个商品
                </span>
            </div>
            {error && <Alert type="error" showIcon title={error} />}
            {items.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                    {items.map((item) => (
                        <section key={item.id} className="flex gap-3 rounded-xl bg-surface-hover p-3">
                            <CachedResourceImage storageKey={"resource:" + item.resourceId} alt={item.name} className="size-24 shrink-0 rounded-lg object-contain" />
                            <div className="min-w-0 flex-1 space-y-2">
                                <Input
                                    aria-label="商品名称"
                                    value={item.name}
                                    maxLength={200}
                                    disabled={submitting}
                                    onChange={(event) => {
                                        setItems((previous) => previous.map((v) => (v.id === item.id ? { ...v, name: event.target.value } : v)));
                                        importOperation.current = crypto.randomUUID();
                                    }}
                                />
                                <Input.TextArea
                                    aria-label={"真实卖点 " + item.name}
                                    placeholder="填写已确认的用途、材质或特点；未知信息可留空"
                                    autoSize={{ minRows: 2, maxRows: 4 }}
                                    value={item.sellingPoints}
                                    maxLength={8000}
                                    disabled={submitting}
                                    onChange={(event) => {
                                        setItems((previous) => previous.map((v) => (v.id === item.id ? { ...v, sellingPoints: event.target.value } : v)));
                                        importOperation.current = crypto.randomUUID();
                                    }}
                                />
                            </div>
                            <Button
                                type="text"
                                aria-label={"移除" + item.name}
                                icon={<Trash2 className="size-4" />}
                                disabled={submitting}
                                onClick={() => {
                                    setItems((previous) => previous.filter((v) => v.id !== item.id));
                                    importOperation.current = crypto.randomUUID();
                                }}
                            />
                        </section>
                    ))}
                </div>
            )}
            <ProductSettings
                value={config}
                catalog={options.catalog}
                disabled={disabled || submitting}
                onChange={(next) => {
                    setConfig(next);
                    importOperation.current = crypto.randomUUID();
                }}
            />
            <details className="text-sm">
                <summary className="cursor-pointer">全自动与个人预设</summary>
                <div className="mt-3 space-y-3">
                    <Checkbox checked={auto} disabled={disabled || submitting} onChange={(event) => setAuto(event.target.checked)}>
                        全自动：提前确认整套预算，方案校验后自动生成
                    </Checkbox>
                    <div className="flex flex-wrap gap-2">
                        <Input className="!w-48" aria-label="个人预设名称" placeholder="预设名称" value={presetName} onChange={(event) => setPresetName(event.target.value)} />
                        <Button
                            disabled={!presetName.trim() || submitting}
                            onClick={() => {
                                const previous = options.presets.find((preset) => preset.name === presetName);
                                void saveProductPreset(presetName.trim(), config, previous?.revision)
                                    .then(() => message.success("已保存，后续商品可使用此预设"))
                                    .catch((error: Error) => message.error(error.message));
                            }}
                        >
                            保存预设
                        </Button>
                        <Select
                            className="min-w-48"
                            ariaLabel="使用个人预设"
                            placeholder="使用个人预设"
                            options={options.presets.map((preset) => ({ value: preset.id, label: preset.name === "default" ? "我的默认预设" : preset.name }))}
                            onChange={(id) => {
                                const preset = options.presets.find((item) => item.id === id);
                                if (preset) setConfig(preset.config);
                            }}
                        />
                        <Button
                            disabled={submitting}
                            onClick={() =>
                                void saveProductPreset("default", config, options.presets.find((preset) => preset.name === "default")?.revision)
                                    .then(() => message.success("已设为后续商品的默认设置"))
                                    .catch((error: Error) => message.error(error.message))
                            }
                        >
                            设为我的默认
                        </Button>
                    </div>
                    {options.state.effectiveEnabled && (
                        <div className="flex flex-wrap items-center gap-2 text-foreground/60">
                            <Button type="text" disabled={disabled || submitting || uploading} onClick={onDisable}>
                                停用我的商品创作
                            </Button>
                            <span>只影响你的后续创作，历史作品保留。</span>
                        </div>
                    )}
                </div>
            </details>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-foreground/60">
                    {items.length} 个商品 · {items.length * (config.hero.count + config.detail.count)} 张图片 · {items.length * config.titleCount} 个标题
                </p>
                <Button type="primary" icon={<Sparkles className="size-4" />} loading={submitting} disabled={disabled || uploading || !items.length || items.some((item) => !item.name.trim())} onClick={() => void submit()}>
                    保存商品并查看{auto ? "整套" : "策划"}费用
                </Button>
            </div>
            <AssetLibraryPickerModal
                open={picker}
                remoteLibrary
                remoteKind="image"
                acceptRemoteItems
                mediaKinds={["image"]}
                items={[]}
                categoryLabels={{ all: "图片" }}
                multiple
                title="选择商品原图"
                confirmLabel={(count) => "导入 " + count + " 个商品"}
                onClose={() => setPicker(false)}
                onConfirm={pick}
            />
        </div>
    );
}

function ProductDetail({
    product,
    options,
    enabled,
    busy,
    onQuote,
    onCommand,
    onDownload,
    onChanged,
}: {
    product: Product;
    options: EcommerceOptions;
    enabled: boolean;
    busy: boolean;
    onQuote: (scope: QuoteScope) => void;
    onCommand: (request: ProductCommand) => Promise<void>;
    onDownload: () => void;
    onChanged: () => void;
}) {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const [branch, setBranch] = useState<ProductBranch | null>(null);
    const [slot, setSlot] = useState<ProductSlot | null>(null);
    const [info, setInfo] = useState(false);
    const [append, setAppend] = useState(false);
    const [additionalHero, setAdditionalHero] = useState(1);
    const [additionalDetail, setAdditionalDetail] = useState(0);
    const [openingCanvas, setOpeningCanvas] = useState(false);
    const [historyID, setHistoryID] = useState("");
    const historicalRun = useProductRun(product.id, historyID);
    const historical = Boolean(historyID && historyID !== product.currentRunId);
    const run = historical ? historicalRun.data : product.run;
    const canCreate = enabled && !historical && !product.archived;
    const imageCount = run?.slots.filter((item) => Boolean(item.selectedVersionId)).length ?? 0;
    const ready = run?.branches.filter((item) => item.status === "review").map((item) => item.kind) ?? [];
    const issueSteps = run?.steps.filter((step) => ["failed", "uncertain"].includes(step.status)) ?? [];
    return (
        <div className="space-y-5">
            <section className="flex flex-wrap gap-4 rounded-2xl bg-surface p-5">
                <CachedResourceImage storageKey={"resource:" + product.sourceResourceId} alt="商品原图" className="size-28 rounded-xl object-contain" />
                <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold">{product.name}</h2>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/60">{product.sellingPoints || "未补充卖点，策划将以图片中可见的信息为依据。"}</p>
                    <p className="mt-3 text-sm">
                        {productStatus(run?.status)}
                        {run ? " · 第 " + run.number + " 轮" : ""} · {imageCount}/{run?.slots.length ?? product.config.hero.count + product.config.detail.count} 张图片 · {run?.titles.length ?? 0}/{run?.config.titleCount ?? product.config.titleCount}{" "}
                        个标题
                    </p>
                </div>
                <Button icon={<Settings2 className="size-4" />} onClick={() => setInfo(true)}>
                    商品资料与设置
                </Button>
            </section>
            {product.runs.length > 1 && (
                <div className="flex flex-wrap items-center gap-3">
                    <Select
                        className="min-w-56"
                        ariaLabel="查看商品轮次"
                        value={historyID || product.currentRunId}
                        options={product.runs.map((record) => ({ value: record.id, label: "第 " + record.number + " 轮 · " + productStatus(record.status) }))}
                        onChange={(id) => {
                            setHistoryID(id === product.currentRunId ? "" : id);
                            setBranch(null);
                            setSlot(null);
                        }}
                    />
                    {historical && <p className="text-sm text-foreground/60">历史轮次可查看、下载及送入画布。</p>}
                </div>
            )}
            {historical && historicalRun.isPending && <Skeleton active />}
            {historical && historicalRun.isError && <Alert type="error" title={historicalRun.error.message} />}
            {run?.pauseReason && <Alert type="warning" showIcon title={run.pauseReason} />}
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface p-4">
                <div className="mr-auto space-y-1 text-sm">
                    <p>
                        已完成 {imageCount} 张 · 实际 {credits(run?.actualMicrocredits ?? 0)} 积分
                    </p>
                    {run && (
                        <p className="text-xs text-foreground/60">
                            授权预算 {credits(run.budgetMicrocredits)} · 已占用 {credits(run.occupiedMicrocredits)} 积分
                        </p>
                    )}
                </div>
                {!run && !historical ? (
                    <Button type="primary" disabled={!enabled || busy || product.archived} onClick={() => onQuote({ action: "planning" })}>
                        生成方案与标题
                    </Button>
                ) : run && !historical ? (
                    <div className="contents">
                        {ready.length > 0 && (
                            <Button type="primary" disabled={!enabled || busy || product.archived} onClick={() => onQuote({ action: "generate", branches: ready })}>
                                确认整套方案
                            </Button>
                        )}
                        {["paused", "blocked", "failed", "uncertain"].includes(run.status) && (
                            <Button disabled={!enabled || busy || product.archived} onClick={() => onQuote({ action: "continue" })}>
                                重新确认并继续
                            </Button>
                        )}
                        {["queued", "generating", "planning", "review"].includes(run.status) && (
                            <Button icon={<Pause className="size-4" />} disabled={busy} onClick={() => void onCommand({ action: "pause", revision: product.revision, operationId: crypto.randomUUID() }).catch(() => undefined)}>
                                暂停后续步骤
                            </Button>
                        )}
                        <Button icon={<RefreshCw className="size-4" />} disabled={!enabled || busy || product.archived} onClick={() => onQuote({ action: "redo-review", config: product.config })}>
                            整套重做
                        </Button>
                    </div>
                ) : null}
                <Button
                    icon={<Download className="size-4" />}
                    disabled={busy || (historical && !run)}
                    onClick={() => {
                        if (!historical) {
                            onDownload();
                            return;
                        }
                        void exportProductRun(product.id, historyID)
                            .then((blob) => saveAs(blob, "商品套图-第" + run!.number + "轮.zip"))
                            .catch((error: Error) => message.error(error.message));
                    }}
                >
                    下载商品套图
                </Button>
                <Button
                    icon={<LayoutGrid className="size-4" />}
                    loading={openingCanvas}
                    disabled={!imageCount}
                    onClick={async () => {
                        setOpeningCanvas(true);
                        try {
                            const id = await sendProductToCanvas({ ...product, run });
                            navigate("/canvas/" + id);
                        } catch (error) {
                            message.error(error instanceof Error ? error.message : "画布交接失败");
                        } finally {
                            setOpeningCanvas(false);
                        }
                    }}
                >
                    送入画布
                </Button>
            </div>
            {run && (
                <div className="grid gap-4 sm:grid-cols-2">
                    {run.branches.map((item) => (
                        <section key={item.id} className="space-y-3 rounded-xl bg-surface p-4">
                            <div className="flex justify-between gap-2">
                                <h3 className="font-semibold">{item.kind === "hero" ? "主图" : "详情图"}方案</h3>
                                <span className="text-xs text-foreground/60">{productStatus(item.status)}</span>
                            </div>
                            <p className="text-sm text-foreground/60">{item.plan?.visualSystem.artDirection || "根据原图策划用途、构图与准确文案。"}</p>
                            <div className="flex flex-wrap gap-2">
                                <Button disabled={!item.plan} onClick={() => setBranch(item)}>
                                    查看{item.approvedAt ? "" : "与修改"}方案
                                </Button>
                                {item.status === "review" && !historical && (
                                    <Button disabled={!canCreate || busy} onClick={() => onQuote({ action: "generate", branches: [item.kind] })}>
                                        只确认{item.kind === "hero" ? "主图" : "详情"}
                                    </Button>
                                )}
                            </div>
                        </section>
                    ))}
                </div>
            )}
            {run && (
                <section className="space-y-3 rounded-xl bg-surface p-4">
                    <div className="flex flex-wrap justify-between gap-2">
                        <h3 className="font-semibold">商品标题</h3>
                        <Button type="text" disabled={!canCreate || busy} onClick={() => onQuote({ action: "redo-titles" })}>
                            重新生成标题
                        </Button>
                    </div>
                    {run.titles.length ? (
                        run.titles.map((title, index) => (
                            <div key={index} className="flex items-center gap-3 rounded-lg bg-surface-hover p-3">
                                <p className="flex-1 text-sm">{title}</p>
                                <Button
                                    type="text"
                                    aria-label={"复制标题" + (index + 1)}
                                    icon={<Copy className="size-4" />}
                                    onClick={() =>
                                        void navigator.clipboard
                                            .writeText(title)
                                            .then(() => message.success("标题已复制"))
                                            .catch(() => message.error("复制失败，请选择文字复制"))
                                    }
                                />
                            </div>
                        ))
                    ) : (
                        <p className="text-sm text-foreground/60">标题尚未完成，图片结果会独立保留。</p>
                    )}
                </section>
            )}
            {run &&
                (["hero", "detail"] as const).map((kind) => (
                    <section key={kind} className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="font-semibold">
                                {kind === "hero" ? "主图" : "详情图"} · {run.slots.filter((item) => item.kind === kind && item.selectedVersionId).length}/{run.slots.filter((item) => item.kind === kind).length}
                            </h3>
                            <span className="text-xs text-foreground/60">{run.config[kind].size}</span>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {run.slots
                                .filter((item) => item.kind === kind)
                                .map((item) => (
                                    <article key={item.id} className="overflow-hidden rounded-xl bg-surface">
                                        <button type="button" className="block w-full focus-visible:outline focus-visible:outline-2" aria-label={"查看" + (item.title || "图片" + item.index)} onClick={() => setSlot(item)}>
                                            {currentVersion(item) ? (
                                                <CachedResourceImage storageKey={"resource:" + currentVersion(item)!.resourceId} alt={item.title} className="aspect-square w-full object-contain" />
                                            ) : (
                                                <div className="flex aspect-square flex-col items-center justify-center gap-2 text-sm text-foreground/60">
                                                    <ImagePlus className="size-6" />
                                                    <span>{productStatus(item.status)}</span>
                                                </div>
                                            )}
                                        </button>
                                        <div className="space-y-2 p-3">
                                            <h4 className="text-sm font-medium">
                                                {item.index}. {item.title || "等待策划"}
                                            </h4>
                                            <p className="text-xs text-foreground/60">
                                                {productStatus(item.status)}
                                                {item.versions.length ? " · " + item.versions.length + " 个版本" : ""}
                                            </p>
                                            <Button size="small" disabled={!item.refinement && !item.versions.length} onClick={() => setSlot(item)}>
                                                调整与版本
                                            </Button>
                                        </div>
                                    </article>
                                ))}
                        </div>
                    </section>
                ))}
            {issueSteps.length > 0 && (
                <section className="space-y-3 rounded-xl bg-surface p-4">
                    <h3 className="font-semibold">待处理步骤</h3>
                    {issueSteps.map((step) => (
                        <div key={step.id} className="flex flex-wrap items-center gap-3">
                            <p className="min-w-0 flex-1 text-sm text-foreground/60">{step.error || productStatus(step.status)}</p>
                            {step.status === "failed" ? (
                                <Button disabled={!canCreate || busy} onClick={() => onQuote({ action: "retry-step", stepId: step.id })}>
                                    重新报价并重试
                                </Button>
                            ) : step.taskId ? (
                                <Button
                                    disabled={busy}
                                    onClick={() =>
                                        void recoverProductStep(product.id, step.id)
                                            .then(() => {
                                                message.success("已核对原任务状态");
                                                onChanged();
                                            })
                                            .catch((error: Error) => message.error(error.message))
                                    }
                                >
                                    恢复原任务
                                </Button>
                            ) : null}
                        </div>
                    ))}
                </section>
            )}
            {run && run.titleHistory.length > 0 && (
                <details className="rounded-xl bg-surface p-4">
                    <summary className="cursor-pointer text-sm">标题历史版本</summary>
                    <div className="mt-3 space-y-3">
                        {run.titleHistory.map((titles, index) => (
                            <div key={index} className="space-y-2 rounded-lg bg-surface-hover p-3">
                                <p className="text-xs text-foreground/60">版本 {index + 1}</p>
                                {titles.map((title, i) => (
                                    <p key={i} className="select-text text-sm">
                                        {title}
                                    </p>
                                ))}
                            </div>
                        ))}
                    </div>
                </details>
            )}
            {run && (
                <details className="rounded-xl bg-surface p-4">
                    <summary className="cursor-pointer text-sm">更多操作与历史轮次</summary>
                    <div className="mt-4 space-y-3">
                        <div className="flex flex-wrap gap-2">
                            <Button disabled={!canCreate || busy} onClick={() => setAppend(!append)}>
                                追加图片
                            </Button>
                            <Button disabled={!canCreate || busy} onClick={() => onQuote({ action: "redo-auto", config: product.config })}>
                                全自动整套重做
                            </Button>
                        </div>
                        {append && (
                            <div className="flex flex-wrap items-center gap-3">
                                <label className="text-sm">
                                    新增主图 <InputNumber aria-label="新增主图数量" min={0} max={20 - product.config.hero.count} value={additionalHero} onChange={(v) => setAdditionalHero(v ?? 0)} />
                                </label>
                                <label className="text-sm">
                                    新增详情 <InputNumber aria-label="新增详情数量" min={0} max={20 - product.config.detail.count} value={additionalDetail} onChange={(v) => setAdditionalDetail(v ?? 0)} />
                                </label>
                                <Button disabled={!canCreate || busy || additionalHero + additionalDetail < 1} onClick={() => onQuote({ action: "append", additionalHero, additionalDetail })}>
                                    补充策划并报价
                                </Button>
                            </div>
                        )}
                        <p className="text-xs text-foreground/60">保留原图与成品，补充方案确认后再生成新增图片。</p>
                        {product.runs.map((record) => (
                            <p key={record.id} className="text-sm">
                                第 {record.number} 轮 · {productStatus(record.status)} · {new Date(record.createdAt).toLocaleString()}
                            </p>
                        ))}
                    </div>
                </details>
            )}
            <div className="flex justify-end gap-2">
                <Button
                    disabled={busy}
                    onClick={() => {
                        void updateProduct(product.id, { revision: product.revision, operationId: crypto.randomUUID(), archived: !product.archived })
                            .then(onChanged)
                            .catch((error: Error) => message.error(error.message));
                    }}
                >
                    {product.archived ? "取消归档" : "归档商品"}
                </Button>
                {!run && (
                    <Button
                        danger
                        icon={<Trash2 className="size-4" />}
                        onClick={() =>
                            modal.confirm({
                                title: "移除这个商品草稿？",
                                content: "上传图片按素材库规则保留。",
                                onOk: async () => {
                                    await deleteProductDraft(product.id, { revision: product.revision, operationId: crypto.randomUUID() });
                                    navigate(PRODUCT_IMAGES_ROUTE + "?tab=history");
                                    onChanged();
                                },
                            })
                        }
                    >
                        移除草稿
                    </Button>
                )}
            </div>
            {branch && <PlanDrawer key={branch.id} branch={branch} revision={product.revision} readOnly={historical} busy={busy} onCommand={onCommand} onClose={() => setBranch(null)} />}
            {slot && (
                <ImageDrawer
                    key={slot.id}
                    slot={slot}
                    readOnly={historical || !enabled}
                    revision={product.revision}
                    copyMode={run!.config[slot.kind].copyMode}
                    busy={busy}
                    onCommand={onCommand}
                    onRegenerate={() => onQuote({ action: "redo-image", slotId: slot.id })}
                    onClose={() => setSlot(null)}
                />
            )}
            {info && (
                <ProductInfo
                    key={product.id}
                    product={product}
                    options={options}
                    onClose={() => setInfo(false)}
                    onSaved={onChanged}
                    onApply={(config) => {
                        setInfo(false);
                        onQuote({ action: "apply-config", config });
                    }}
                />
            )}
        </div>
    );
}
function ProductInfo({ product, options, onClose, onSaved, onApply }: { product: Product; options: EcommerceOptions; onClose: () => void; onSaved: () => void; onApply: (config: ProductConfig) => void }) {
    const { message } = App.useApp();
    const [name, setName] = useState(product.name);
    const [points, setPoints] = useState(product.sellingPoints);
    const [config, setConfig] = useState(product.config);
    const [busy, setBusy] = useState(false);
    const dirty = name !== product.name || points !== product.sellingPoints || JSON.stringify(config) !== JSON.stringify(product.config);
    const { close, confirming } = useUnsavedDraft(dirty);
    return (
        <AppDrawer
            focusable={{ trap: !confirming }}
            title="商品资料与高级设置"
            open
            size={720}
            onClose={() => close(onClose)}
            footer={
                <div className="flex flex-wrap justify-end gap-2">
                    <Button disabled={busy} onClick={() => close(onClose)}>
                        关闭
                    </Button>
                    {product.run && (
                        <Button disabled={busy} onClick={() => onApply(config)}>
                            只应用模型和规格，重新报价
                        </Button>
                    )}
                    <Button
                        type="primary"
                        loading={busy}
                        disabled={!dirty}
                        onClick={async () => {
                            setBusy(true);
                            try {
                                await updateProduct(product.id, { revision: product.revision, operationId: crypto.randomUUID(), name, sellingPoints: points, config });
                                onSaved();
                                onClose();
                            } catch (error) {
                                message.error(error instanceof Error ? error.message : "保存失败");
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        保存资料
                    </Button>
                </div>
            }
        >
            <div className="space-y-5">
                <p className="text-sm text-foreground/60">资料与风格修改用于后续轮次。当前已提交的请求与已确认方案保留原快照。</p>
                <label className="block space-y-2 text-sm">
                    商品名称
                    <Input aria-label="商品名称" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="block space-y-2 text-sm">
                    真实卖点
                    <Input.TextArea aria-label="商品真实卖点" maxLength={8000} autoSize={{ minRows: 3, maxRows: 8 }} value={points} onChange={(e) => setPoints(e.target.value)} />
                </label>
                <ProductSettings value={config} catalog={options.catalog} onChange={setConfig} disabled={busy} />
            </div>
        </AppDrawer>
    );
}
