export const ECOMMERCE_PLUGIN_ID = "ecommerce-studio";
export const PRODUCT_IMAGES_ROUTE = "/create/product-images";
export type ModelSelection = { logicalModelId?: string; channelId?: string; channelModelKey?: string };
export type ProductOutput = { count: number; size: string; quality?: string; copyMode: "none" | "typeset" };
export type ProductConfig = {
    planner: ModelSelection;
    imageModel: ModelSelection;
    reviewModel?: ModelSelection;
    qualityCheck?: boolean;
    hero: ProductOutput;
    detail: ProductOutput;
    titleCount: number;
    titleMaxLength: number;
    style: string;
    platform: string;
    market: string;
    language: string;
    planningInstructions?: string;
    refinementInstructions?: string;
    generationInstructions?: string;
};
export type EcommerceSettings = {
    revision: number;
    defaults: ProductConfig;
    reviewAvailable: boolean;
    reviewModel: ModelSelection;
    batchLimit: number;
    productConcurrency: number;
    textConcurrency: number;
    imageConcurrency: number;
    productImageConcurrency: number;
};
export type ProductQualityReport = { verdict: "pass" | "attention" | "undetermined"; summary: string; issues: { category: "product" | "text" | "claims" | "plan" | "uncertainty"; evidence: string; suggestion: string }[] };
export type ProductQualityCheck = { stepId: string; versionId: string; status: string; report?: ProductQualityReport };
export type ProductAnalysis = { identity: string; visibleFeatures: string[]; confirmedSellingPoints: string[]; unknowns: string[] };
export type ProductDesign = { evidence: string; viewpoint: string; framing: string; pose: string; layout: string; focus: string; crop: string; textBlocks: { role: string; text: string; placement: string }[] };
export type ProductScreen = { slotId: string; kind: "hero" | "detail"; title: string; copy: string; brief: string; design: ProductDesign };
export type ProductPlan = { productAnalysis: ProductAnalysis; visualSystem: { artDirection: string; palette: string; lighting: string; typography: string }; screens: ProductScreen[]; designVersion: number };
export type ProductRefinement = { slotId: string; kind: string; title: string; copy: string; visualPlan: Record<string, string>; generationPrompt: string; prompt: string; repairs?: string[] };
export type ProductImageVersion = { id: string; runId: string; slotId: string; number: number; taskId: string; resourceId: string; prompt: string; copy: string; createdAt: string };
export type ProductSlot = {
    id: string;
    runId: string;
    kind: "hero" | "detail";
    index: number;
    revision: number;
    status: string;
    title: string;
    copy: string;
    selectedVersionId?: string;
    generation: number;
    refinement?: ProductRefinement;
    draft?: ProductRefinement;
    versions: ProductImageVersion[];
    qualityChecks?: ProductQualityCheck[];
};
export type ProductBranch = {
    id: string;
    runId: string;
    kind: "hero" | "detail";
    revision: number;
    status: string;
    acceptedRevision: number;
    approvedAt?: string;
    plan?: ProductPlan;
    acceptedPlan?: ProductPlan;
    history: ProductPlan[];
    config?: ProductConfig;
};
export type ProductStep = {
    id: string;
    productId: string;
    runId: string;
    stageKey: string;
    kind: string;
    branchKind?: string;
    slotId?: string;
    generation: number;
    status: string;
    taskId?: string;
    authorizationId?: string;
    errorCode?: string;
    error?: string;
    reservedMicrocredits: number;
    actualMicrocredits: number;
    billingStatus?: string;
};
export type ProductRunRecord = { id: string; productId: string; number: number; revision: number; status: string; pauseReason?: string; mode: "review" | "auto"; titleRevision: number; createdAt: string; updatedAt: string };
export type ProductRun = ProductRunRecord & {
    config: ProductConfig;
    titles: string[];
    titleHistory: string[][];
    branches: ProductBranch[];
    slots: ProductSlot[];
    steps: ProductStep[];
    budgetMicrocredits: number;
    occupiedMicrocredits: number;
    actualMicrocredits: number;
};
export type Product = {
    id: string;
    batchId: string;
    sourceResourceId: string;
    name: string;
    sellingPoints: string;
    currentRunId?: string;
    revision: number;
    archived: boolean;
    createdAt: string;
    updatedAt: string;
    config: ProductConfig;
    run?: ProductRun;
    runs: ProductRunRecord[];
};
export type ProductPage = { items: Product[]; total: number; page: number; pageSize: number };
export type ProductBatch = { id: string; name: string; createdAt: string; updatedAt: string; products: Product[] };
export type ProductPreset = { id: string; name: string; revision: number; config: ProductConfig };
export type ProductAction = "planning" | "auto" | "redo-review" | "redo-auto" | "generate" | "continue" | "apply-config" | "redo-image" | "redo-titles" | "retry-step" | "append";
export type QuoteScope = { action: ProductAction; branches?: string[]; slotId?: string; stepId?: string; additionalHero?: number; additionalDetail?: number; config?: ProductConfig };
export type ProductQuote = {
    id: string;
    productId: string;
    runId?: string;
    productRevision: number;
    runRevision: number;
    hash: string;
    estimatedMicrocredits: number;
    budgetMicrocredits: number;
    textCalls: number;
    imageCalls: number;
    expiresAt: string;
    scope: QuoteScope;
    prices: { key: string; signature: string; estimatedMicrocredits: number; capMicrocredits: number; calls: number; estimated: boolean; reviewModel?: ModelSelection }[];
};
export type ProductCommand = {
    revision: number;
    operationId: string;
    action: ProductAction | "pause" | "save-plan" | "restore-plan" | "save-draft" | "select-version";
    quoteId?: string;
    budgetMicrocredits?: number;
    branch?: string;
    branchRevision?: number;
    plan?: ProductPlan;
    slotId?: string;
    slotRevision?: number;
    draft?: ProductRefinement;
    versionId?: string;
};
export type ProductBatchResult = { productId: string; status: "success" | "skipped" | "failed"; reason?: string; product?: Product };
export function productStatus(status?: string) {
    return (
        (
            {
                queued: "排队中",
                planning: "策划中",
                generating: "生成中",
                checking: "智能质检中",
                settling: "结算中",
                review: "待确认方案",
                completed: "已完成",
                completed_with_warnings: "已完成，部分内容需处理",
                paused: "已暂停",
                blocked: "等待重新确认",
                uncertain: "结果待核对",
                failed: "部分步骤失败",
                pending: "等待开始",
                ready: "待生图",
                succeeded: "已完成",
                submitted: "执行中",
                approved: "已确认",
                superseded: "已替换",
            } as Record<string, string>
        )[status ?? ""] ?? "草稿"
    );
}
export function credits(amount: number) {
    return (amount / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
}
export function completedImages(product: Product) {
    return product.run?.slots.filter((slot) => Boolean(slot.selectedVersionId)).length ?? 0;
}
export function currentVersion(slot: ProductSlot) {
    return slot.versions.find((version) => version.id === slot.selectedVersionId);
}
export function versionQualityCheck(slot: ProductSlot, versionId?: string) {
    return slot.qualityChecks?.find((check) => check.versionId === versionId && check.status !== "superseded");
}
export function shouldPoll(status?: string) {
    return Boolean(status && !["completed", "completed_with_warnings", "archived"].includes(status));
}
