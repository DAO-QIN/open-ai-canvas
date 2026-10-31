import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { removeCreationAttachment } from "../src/pages/create/creation-assets";
import { moduleGroupSource } from "./helpers/module-group-source";

function compactSource(source: string) {
    return source.replace(/\s+/g, " ").trim();
}

function readCreateSource() {
    return readFileSync(resolve(import.meta.dir, "../src/pages/create/index.tsx"), "utf8");
}

function readCreateWorkspaceSource() {
    return moduleGroupSource("pages/create/creation-workspace.tsx");
}

describe("creation library button", () => {
    test("keeps library selection in the reference area instead of the bottom dock", () => {
        const source = readCreateWorkspaceSource();
        const dockStart = source.indexOf('<footer className="creation-chat-dock">');
        const dockEnd = source.indexOf("</footer>", dockStart);

        expect(dockStart).toBeGreaterThanOrEqual(0);
        expect(dockEnd).toBeGreaterThan(dockStart);
        const dockSource = compactSource(source.slice(dockStart, dockEnd));
        const modePickerIndex = dockSource.indexOf("<CreationModePicker value={activeModeKey}");

        expect(modePickerIndex).toBeGreaterThanOrEqual(0);
        expect(source).not.toContain("creation-composer-mode-row");
        expect(dockSource).not.toContain('aria-label="打开素材库选择参考内容"');
        expect(dockSource).not.toContain('aria-label="从本机上传附件"');
        expect(dockSource).not.toContain("creation-reference-add-button");
        expect(source).toContain("props.onOpenLibrary();");
        expect(source).toContain("creation-reference-add-button");
        expect(compactSource(source)).toContain('showSelectedPrice={false} showOptionPrices variant="creation"');
        expect(source).toContain("creation-submit-cost");
    });

    test("uploads from the library without adding a reference before confirmation", () => {
        const source = readCreateSource();
        const pickerSource = readFileSync(resolve(import.meta.dir, "../src/components/assets/asset-library-picker-modal.tsx"), "utf8");
        const uploadStart = source.indexOf("const uploadLibraryAssets = async");
        const uploadEnd = source.indexOf("const handleLibrarySelect", uploadStart);

        expect(uploadStart).toBeGreaterThanOrEqual(0);
        expect(uploadEnd).toBeGreaterThan(uploadStart);
        expect(source.slice(uploadStart, uploadEnd)).not.toContain("setAttachments");
        expect(source).toContain("onUpload: uploadLibraryAssets");
        expect(source).not.toContain("onUpload={() => fileInputRef.current?.click()}");
        expect(source).toContain("上传后保存到素材库");
        expect(pickerSource).toContain("保存完成后会自动选中");
        expect(source).toContain("个素材已上传到素材库并自动选中");
    });

    test("视频创作使用同名模型组的全部参考能力开放素材入口", () => {
        const source = readCreateSource();
        const workspace = readCreateWorkspaceSource();

        expect(source).toContain('modelGroupReferenceLimits(config, preferredModel || selectedModel, "video")');
        expect(source).toContain("reconcileCreationAttachmentLimits(requestAttachments, mentionReferences, videoReferenceLimits)");
        expect(workspace).toContain('props.mode !== "video" || props.maxReferences > 0');
        expect(workspace).not.toContain('props.videoProfile.operations.includes("image_to_video")');
    });

    test("previews prompt reference images without removing them", () => {
        const createSource = readCreateWorkspaceSource();
        const canvasSource = moduleGroupSource("components/canvas/canvas-node-prompt-panel.tsx");

        expect(createSource).toContain('className="creation-user-message-attachments"');
        expect(createSource).toContain('setPreviewType(kind === "video" ? "video" : "image")');
        expect(createSource).toContain("<CreationMediaPreviewModal url={previewUrl} type={previewType}");
        expect(canvasSource).toContain("canPreview ? setImagePreview(reference) : onInsert(reference)");
        expect(canvasSource).toContain("<AntImage");
        expect(canvasSource).toContain("onClick={() => onInsert(reference)}");
    });

    test("参考素材是提示词左边一摞斜放的卡片（参考即梦）：悬停展开、拖动排序、拖入替换，「+」选上传或素材库", () => {
        const workspace = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-workspace.tsx"), "utf8");
        const stack = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-reference-stack.tsx"), "utf8");
        const drag = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-reference-drag.ts"), "utf8");
        const styles = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-reference-stack.css"), "utf8");
        const globals = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

        // 卡片堆和提示词同一行、在它前面；鼠标设备叠成一摞，触屏平铺在提示词上方。
        expect(workspace.indexOf("<CreationReferenceStack")).toBeGreaterThan(0);
        expect(workspace.indexOf("<CreationReferenceStack")).toBeLessThan(workspace.indexOf("<CanvasResourceMentionTextarea"));
        expect(workspace).toContain('useMediaQuery("(hover: hover) and (pointer: fine)") ? "stack" : "tiled"');
        expect(workspace).toContain('" has-reference-stack" : " has-reference-row"');
        // 「+」是一个菜单：上传图片走本机选择，素材库沿用原来的选择弹窗；游客在弹出文件选择前先登录。
        expect(stack).toContain('{ key: "upload", icon: <Upload aria-hidden="true" />, label: "上传图片" }');
        expect(stack).toContain('{ key: "library", icon: <FolderOpen aria-hidden="true" />, label: "从素材库选择" }');
        expect(stack).toContain("if (props.onBeforeUpload()) uploadInputRef.current?.click();");
        expect(stack).toContain("props.onUploadFiles(files)");
        expect(workspace).toContain("canAdd={!interactionBusy && canAddMoreReferences}");
        // 即梦的斜放角度：展开时左右交替，收成一摞时更乱；收起时「+」缩成右下角的小圆点。
        expect(stack).toContain("const FANNED_TILT = [-8, 5, -8, 5, -8, 4, -8, 4, -8, 5, -8, 5];");
        expect(stack).toContain("const STACKED_TILT = [-8, 4, -22, 8, -8, 4, -7, 4, -8, 8, -22, 4];");
        expect(stack).toContain('addMini ? "is-mini" : ""');
        // 拖动排序：指针跟着走（换算桌面端整体缩放），其余卡片让位，放手后滑进位置再提交；Esc 取消；Alt + ←/→ 用键盘换顺序。
        expect(stack).toContain('window.addEventListener("pointermove", move)');
        expect(stack).toContain("const dx = toLayoutPx(screenX);");
        expect(stack).toContain("function projectedSlot(index: number, drag: DragState | null)");
        expect(stack).toContain("current.onReorder(next);");
        expect(stack).toContain('keyEvent.key !== "Escape"');
        expect(stack).toContain("event.altKey");
        // 拖到提示词里的 @图片 上替换那一张。
        expect(stack).toContain("current.findPromptImageAt(moveEvent.clientX, moveEvent.clientY)");
        expect(stack).toContain("current.onReplaceWithAttachment(finished.promptTarget.attachmentId, item);");
        expect(workspace).toContain("onReplaceWithAttachment={props.onReplaceAttachment}");
        expect(workspace).toContain("onReferenceFilesDrop=");
        // 本机图片、生成结果拖到卡片上替换这一张，拖到「+」或输入框其余位置加到最后。
        expect(stack).toContain("props.onReplaceWithFiles(item.id, files)");
        expect(stack).toContain("props.onDropResultImage(resultImage, item.id)");
        expect(workspace).toContain("if (resultImage) props.onDropResultImage(resultImage);");
        expect(workspace).toContain("else if (files.length && props.onBeforeUpload()) props.onUploadFiles(files);");
        expect(drag).toContain('export const CREATION_RESULT_IMAGE_DRAG_TYPE = "application/x-yingce-creation-result-image";');
        // 卡片底部写提示词里的叫法；悬停时右上角移除、左下角「@」引用到提示词。
        expect(stack).toContain("label={props.labels.get(item.id)}");
        expect(stack).toContain('className="creation-reference-card-label"');
        expect(stack).toContain('className="creation-reference-card-action is-remove"');
        expect(stack).toContain('className="creation-reference-card-action is-mention"');
        expect(workspace).toContain("onMention={interactionBusy ? undefined : mentionAttachment}");
        expect(workspace).toContain("canvasResourceMentionToken(reference)");
        // 旧的一行缩略图、motion Reorder、滚动按钮和数量说明行都去掉了，样式也不再写在 globals.css。
        for (const removed of ["<Reorder.", "creation-reference-track", "creation-reference-summary", "creation-reference-panel", "CreationAttachmentThumbnail"]) expect(workspace).not.toContain(removed);
        for (const removed of [".creation-reference-panel", ".creation-reference-track", ".creation-reference-stack-card", ".creation-reference-card-remove", "--creation-reference-size"]) expect(globals).not.toContain(removed);
        expect(workspace).toContain("CanvasPromptOptimizerDrawer");
        expect(workspace).toContain("provider={props.promptOptimizerProvider}");
        expect(styles).toContain(".creation-home .creation-reference-stack.is-expanded.has-fan .creation-reference-stack-backdrop");
        expect(styles).toContain(".creation-home .creation-reference-add-button.is-mini");
        // 卡片比即梦略大（桌面端整体缩放后约 54×72）；「+」下面写清楚加什么，悬停时「+」和收起时最上面那张都会浮起。
        expect(stack).toContain("stack: { empty: { width: 60, height: 80, mini: 32, gap: 6 }");
        expect(stack).toContain('<span className="creation-reference-add-caption" aria-hidden="true">');
        expect(styles).toMatch(/\.creation-reference-add-button:not\(\.is-mini\):not\(:disabled\):hover,[^{]*\{[^}]*--add-y: var\(--ref-lift\);[^}]*scale: var\(--ref-lift-scale\);/);
        expect(styles).toMatch(/\.is-collapsed \.creation-reference-stack-item:first-child:hover\s*\{[^}]*--lift: var\(--ref-lift\);/);
        expect(styles).toContain("box-shadow: inset 0 0 0 1.5px var(--ref-frame);");
        expect(styles).toMatch(/\.is-tiled \.creation-reference-card-action\.is-remove\s*\{[^}]*opacity:\s*1;/);
        expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    });

    test("resolves remote asset images from their stable resource key", () => {
        const assets = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-assets.ts"), "utf8");
        const createSource = readCreateWorkspaceSource();

        expect(assets).toContain("resolveResourceUrl(asset.data.storageKey");
        expect(createSource.replace(/\s+/g, " ")).toContain("<CachedResourceImage storageKey={item.storageKey}");
        expect(createSource).toContain("resolveResourceUrl(item.storageKey, item.previewUrl)");
    });

    test("首个、中间和末尾参考内容都按稳定 id 独立删除并保留顺序", () => {
        const attachments = [
            { id: "first", name: "首个" },
            { id: "middle", name: "中间" },
            { id: "last", name: "末尾" },
        ];

        expect(removeCreationAttachment(attachments, "first").map((item) => item.id)).toEqual(["middle", "last"]);
        expect(removeCreationAttachment(attachments, "middle").map((item) => item.id)).toEqual(["first", "last"]);
        expect(removeCreationAttachment(attachments, "last").map((item) => item.id)).toEqual(["first", "middle"]);
    });

    test("删除按钮在指针按下阶段隔离拖拽，素材库入口职责独立", () => {
        const source = compactSource(readCreateWorkspaceSource());

        expect(source).toContain("onPointerDownCapture={(event) => event.stopPropagation()}");
        expect(source).toContain("onRemove(item.id)");
        expect(source).toContain("props.onOpenLibrary();");
        expect(source).not.toContain("onClick={() => props.fileInputRef.current?.click()}");
    });
});

describe("creation homepage default mode", () => {
    test("opens a fresh homepage in Agent mode rather than restoring a manual media mode", () => {
        const source = readCreateSource();
        expect(compactSource(source)).toContain("creationModelCapability, defaultCreationMode, modeLabels,");
        expect(source).toContain("useState<CreationMode>(defaultCreationMode)");
        expect(source).toContain("const nextMode = defaultCreationMode");
        expect(source).not.toContain('mode || "video"');
    });
});

describe("creation thread chrome", () => {
    test("docks the conversation toolbar into the workspace top bar", () => {
        const workspace = readCreateWorkspaceSource();
        const topBar = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-top-bar.tsx"), "utf8");

        expect(workspace).toContain("useWorkspaceTopBarMount");
        expect(workspace).toContain("createPortal(toolbar, mount)");
        expect(topBar).toContain("WorkspaceTopBarExtensionSlot");
    });

    test("parameter popovers use the user surface without a hairline stroke", () => {
        const css = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-product.css"), "utf8");

        expect(css).toContain(".creation-control-popover .ant-popover-inner");
        expect(css).toContain("background: var(--user-surface-raised) !important");
        expect(css).toContain("border: 0 !important");
        expect(css).toContain("--border: transparent");
        expect(css).toContain(".creation-choice-grid button.is-selected");
        expect(css).toContain("background: var(--user-control-pressed) !important");
    });
});
