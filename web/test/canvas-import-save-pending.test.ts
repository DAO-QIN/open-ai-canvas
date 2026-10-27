import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CanvasSyncPendingError } from "../src/lib/canvas/sync-recovery";
import { canvasSaveErrorResult } from "../src/pages/canvas/use-canvas-project-lifecycle";
import { ApiError } from "../src/services/api/request";

function source(path: string) {
    return readFileSync(resolve(import.meta.dir, path), "utf8");
}

describe("画布保存结果分类", () => {
    test("超过等待上限、限流、5xx、断网都只是「还在保存」，同步层会继续保存", () => {
        expect(canvasSaveErrorResult(new CanvasSyncPendingError())).toBe("pending");
        expect(canvasSaveErrorResult(new ApiError("too many", { status: 429, retryable: true }))).toBe("pending");
        expect(canvasSaveErrorResult(new ApiError("bad gateway", { status: 502, retryable: true }))).toBe("pending");
        expect(canvasSaveErrorResult(new ApiError("network", {}))).toBe("pending");
    });

    test("明确拒绝或本地异常仍算失败", () => {
        expect(canvasSaveErrorResult(new ApiError("forbidden", { status: 403, retryable: false }))).toBe("failed");
        expect(canvasSaveErrorResult(new ApiError("gone", { status: 404, retryable: false }))).toBe("failed");
        expect(canvasSaveErrorResult(new Error("云端同步会话尚未建立"))).toBe("failed");
    });
});

describe("LibTV / TapNow 导入不会因为云端保存慢而被撤销", () => {
    test("只有 failed 才撤销导入，pending 保留节点并交给后台同步", () => {
        const page = source("../src/pages/canvas/project.tsx");
        for (const kind of ["LibTV", "TapNow"]) {
            const start = page.indexOf(`const apply${kind}Import = useCallback(`);
            const body = page.slice(start, page.indexOf("    );", start));
            expect(body).toContain("await saveCanvasProjectResult({ requireRemote: false, silent: true })");
            expect(body).toContain('if (saved === "failed") {');
            expect(body).toContain(`throw new Error("画布保存失败，已撤销本次 ${kind} 导入")`);
            expect(body).toContain("return saved;");
            expect(body).not.toContain("if (!saved)");
        }
        const dialogApply = page.slice(page.indexOf("const applyLibTVDialogImport"), page.indexOf("const applyLibTVDialogImport") + 500);
        expect(dialogApply).toContain("const saved = await applyLibTVImport(");
        expect(dialogApply).toContain("return saved;");
    });

    test("导入弹窗区分「已保存到云端」与「正在后台保存」", () => {
        for (const dialog of ["../src/pages/canvas/components/libtv-import-dialog.tsx", "../src/pages/canvas/components/tapnow-import-dialog.tsx"]) {
            const text = source(dialog);
            expect(text).toContain("Promise<CanvasSaveResult | void>");
            expect(text).toContain('if (saved === "pending") message.info(`${summary}，正在后台保存到云端，可以继续编辑`);');
            expect(text).toContain("message.success(`${summary}，已保存到云端`);");
        }
    });

    test("Ctrl+S 等其他保存入口仍只在云端确认后算成功", () => {
        const lifecycle = source("../src/pages/canvas/use-canvas-project-lifecycle.ts");
        expect(lifecycle).toContain('const saveCanvasProject = useCallback(async (options: { requireRemote?: boolean } = {}) => (await saveCanvasProjectResult(options)) === "saved", [saveCanvasProjectResult]);');
        // 本地先落盘，再等云端。
        const body = lifecycle.slice(lifecycle.indexOf("const saveCanvasProjectResult"), lifecycle.indexOf("const saveCanvasProject = useCallback"));
        expect(body.indexOf("await persistLocalEdits()")).toBeLessThan(body.indexOf("await saveRemoteUserDataNow(projectId)"));
    });
});
