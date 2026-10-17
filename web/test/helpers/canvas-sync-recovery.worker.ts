import localforage from "localforage";
import axios from "axios";

function storageHarness() {
    const app = new Map<string, unknown>();
    const stores = new Map<string, Map<string, unknown>>();
    const preferences = new Map<string, string>([["yingce:active-user-scope", "test-user"]]);
    const instance = (values: Map<string, unknown>) => ({
        getItem: async (key: string) => values.get(key) ?? null,
        setItem: async (key: string, value: unknown) => {
            values.set(key, value);
            return value;
        },
        removeItem: async (key: string) => {
            values.delete(key);
        },
        keys: async () => [...values.keys()],
        iterate: async (fn: (value: unknown, key: string, index: number) => unknown) => {
            let i = 0;
            for (const [key, value] of values) {
                const result = fn(value, key, ++i);
                if (result !== undefined) return result;
            }
        },
    });
    Object.assign(localforage, instance(app));
    localforage.createInstance = ((options: { storeName?: string }) => {
        const name = options.storeName || "default";
        if (!stores.has(name)) stores.set(name, new Map());
        return instance(stores.get(name)!);
    }) as never;
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: { getItem: (key: string) => preferences.get(key) ?? null, setItem: (key: string, value: string) => preferences.set(key, value), removeItem: (key: string) => preferences.delete(key) },
            setTimeout: () => 1,
            clearTimeout: () => undefined,
            addEventListener: () => undefined,
        },
    });
    return { app, stores };
}

const canvas = (id = "old") => ({
    id,
    revision: 1,
    title: id,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    nodes: [{ id: "node", type: "image", title: "original", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { taskId: "task", taskStatus: "queued", status: "idle", content: "" } }],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "dots",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    previsScenes: [],
});

async function run(scenario: string) {
    const harness = storageHarness();
    const lockNames: string[] = [];
    if (scenario === "locks" || scenario === "journal-lock") {
        const tails = new Map<string, Promise<void>>();
        Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: {
                locks: {
                    request: async (name: string, operation: () => Promise<unknown>) => {
                        lockNames.push(name);
                        const prior = tails.get(name) || Promise.resolve();
                        let unlock!: () => void;
                        const tail = new Promise<void>((resolve) => {
                            unlock = resolve;
                        });
                        tails.set(name, tail);
                        await prior;
                        try {
                            return await operation();
                        } finally {
                            unlock();
                            if (tails.get(name) === tail) tails.delete(name);
                        }
                    },
                },
            },
        });
    }
    const { useCanvasStore, flushCanvasStorePersistence } = await import("../../src/stores/canvas/use-canvas-store");
    const { useAssetStore } = await import("../../src/stores/use-asset-store");
    const sync = await import("../../src/services/user-data-sync");
    const { apiClient } = await import("../../src/services/api/request");
    const assets = await import("../../src/services/project-asset-sync");
    await Promise.all([useCanvasStore.persist.rehydrate(), useAssetStore.persist.rehydrate()]);
    useCanvasStore.setState({ projects: [], hydrated: true });
    useAssetStore.setState({ assets: [], hydrated: true });
    const requests: Array<{ method?: string; url?: string; body: any }> = [];
    const cloud = new Map<string, any>();
    const remoteAssets = new Map<string, any>();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
        started = resolve;
    });
    let oldRequests = 0;
    apiClient.defaults.adapter = async (config) => {
        const body = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
        requests.push({ method: config.method, url: config.url, body });
        const respond = (data: unknown, status = 200, reason?: string) => {
            const response = { data: { code: status === 200 ? 0 : status, msg: reason || "ok", reason, data }, status, statusText: String(status), headers: {}, config };
            if (status !== 200) throw new axios.AxiosError(reason, undefined, config, {}, response);
            return response;
        };
        const operation = /^\/canvas-projects\/([^/]+)\/operations$/.exec(config.url || "");
        if (operation) {
            const id = operation[1];
            if (id === "old") {
                oldRequests++;
                if (scenario === "scope" || scenario === "journal-lock") {
                    started();
                    await gate;
                    return respond({}, 503, "unavailable");
                }
                if (scenario === "unknown") return respond({}, 503, "unavailable");
                if (scenario === "id-reused") return respond({}, 409, "canvas_mutation_id_reused");
                if (scenario === "deleted") return respond({}, 404, "not_found");
                if (oldRequests === 1 && scenario !== "cached-create") return respond({}, 409, "canvas_field_conflict");
            }
            if (cloud.has(id) && body.operations.some((op: any) => op.type === "create_canvas")) return respond({}, 409, "canvas_field_conflict");
            let project = structuredClone(cloud.get(id) || { ...canvas(id), nodes: [], revision: 0 });
            for (const op of body.operations) {
                if (op.type === "create_canvas") project = { ...project, ...op.patch, id };
                else if (op.type === "create_node") project.nodes.push(op.node);
                else if (op.type === "patch_node") {
                    const node = project.nodes.find((item: any) => item.id === op.id);
                    for (const [field, value] of Object.entries(op.patch)) {
                        const parts = field.split(".");
                        let target = node;
                        for (const part of parts.slice(0, -1)) target = target[part] ||= {};
                        const key = parts.at(-1)!;
                        if (JSON.stringify(target[key] ?? null) !== JSON.stringify(op.before[field] ?? null)) return respond({}, 409, "canvas_field_conflict");
                        if (value === null) delete target[key];
                        else target[key] = value;
                    }
                } else if (op.type === "set_field") project[op.field] = op.value;
            }
            project.revision++;
            cloud.set(id, project);
            return respond({ project: { id, revision: project.revision }, mutationId: body.mutationId });
        }
        const project = /^\/canvas-projects\/([^/]+)$/.exec(config.url || "");
        if (project) {
            if (scenario === "load" && project[1] === "old") {
                started();
                await gate;
                return respond({}, 503, "unavailable");
            }
            return cloud.has(project[1]) ? respond({ project: cloud.get(project[1]) }) : respond({}, 404, "not_found");
        }
        if (config.url === "/assets/batch" && config.method === "post") return respond({ assets: body.ids.map((id: string) => remoteAssets.get(id)).filter(Boolean) });
        const asset = /^\/assets\/([^/]+)$/.exec(config.url || "");
        if (asset && config.method === "put") {
            remoteAssets.set(asset[1], body.asset);
            return respond({ asset: body.asset });
        }
        if (asset) return remoteAssets.has(asset[1]) ? respond({ asset: remoteAssets.get(asset[1]) }) : respond({}, 404, "not_found");
        if (config.url === "/projects/project/assets") return respond({ asset: { ...remoteAssets.get(body.assetId), category: body.category, status: "confirmed" } });
        throw new Error(`Unexpected HTTP ${config.method} ${config.url}`);
    };

    if (scenario === "locks") {
        Object.defineProperty(globalThis, "document", { configurable: true, value: {} });
        const firstModule = await import("../../src/services/provider-neutral-generation-effects");
        const secondModule = await import("../../src/services/provider-neutral-generation-effects.ts?second-realm");
        const first = firstModule.createProviderNeutralGenerationTaskEffectStore();
        const second = secondModule.createProviderNeutralGenerationTaskEffectStore();
        const claims = await Promise.all([first.claim("materialize:locked-task:0", "locked-task"), second.claim("materialize:locked-task:0", "locked-task")]);
        const winner = claims[0].status === "claimed" ? first : second;
        const claim = claims.find((item) => item.status === "claimed")!;
        await winner.complete("materialize:locked-task:0", "locked-task", { materializedAssetId: "single-asset" }, claim.status === "claimed" ? claim.binding : undefined);
        return { statuses: claims.map((item) => item.status).sort(), replays: await Promise.all([first.claim("materialize:locked-task:0", "locked-task"), second.claim("materialize:locked-task:0", "locked-task")]), lockNames };
    }
    if (scenario === "audio" || scenario === "download" || scenario === "bad-cache") {
        const task = {
            id: "two-tracks",
            type: "audio",
            provider: "test",
            status: "succeeded",
            prompt: "",
            attempts: 1,
            createdAt: "",
            updatedAt: "",
            resultJson: JSON.stringify({ mode: "audio", audios: [0, 1].map((index) => ({ dataUrl: `data:audio/mpeg,ID3-track-${index}`, mimeType: "audio/mpeg" })) }),
        } as const;
        if (scenario === "audio") {
            const first = await assets.materializeGenerationTaskAssets(task);
            const replay = await assets.materializeGenerationTaskAssets(first);
            const { getMediaBlob } = await import("../../src/services/file-storage");
            return { first: first.outputs, replay: replay.outputs, count: useAssetStore.getState().assets.length, blobs: await Promise.all(useAssetStore.getState().assets.map(async (item: any) => (await getMediaBlob(item.data.storageKey))?.text())) };
        }
        let downloads = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            downloads++;
            return downloads === 1 && scenario === "download" ? new Response("<html>gateway error</html>", { status: 502, headers: { "Content-Type": "text/html" } }) : new Response("ID3-track", { headers: { "Content-Type": "audio/mpeg" } });
        }) as never;
        const single = { ...task, resultJson: JSON.stringify({ mode: "audio", audio: { dataUrl: "https://test.invalid/output", mimeType: "audio/mpeg" } }) };
        let failed = false;
        try {
            await assets.materializeGenerationTaskAssets(single);
        } catch {
            failed = true;
        }
        const countAfterFailure = useAssetStore.getState().assets.length;
        const result = await assets.materializeGenerationTaskAssets(single);
        const originalAssetId = result.outputs?.[0].materializedAssetId;
        if (scenario === "bad-cache") {
            const asset = useAssetStore.getState().assets.find((item) => item.id === originalAssetId)!;
            harness.stores.get("media_files")!.set((asset.data as any).storageKey, new Blob(["<html>old gateway error</html>"], { type: "text/html" }));
        }
        await assets.materializeGenerationTaskAssets(result);
        const { getMediaBlob } = await import("../../src/services/file-storage");
        const asset = useAssetStore.getState().assets.find((item) => item.id === originalAssetId)!;
        globalThis.fetch = originalFetch;
        return { failed, countAfterFailure, count: useAssetStore.getState().assets.length, downloads, outputs: result.outputs, originalAssetId, blob: await (await getMediaBlob((asset.data as any).storageKey))?.text() };
    }

    const baseline = canvas();
    const local = structuredClone(baseline);
    local.nodes[0].metadata.status = "loading";
    local.nodes[0].metadata.taskStatus = "running";
    local.nodes[0].title = "local title";
    const remote = structuredClone(baseline);
    remote.revision = 2;
    remote.nodes[0].metadata = { ...remote.nodes[0].metadata, status: "success", taskStatus: "succeeded", content: "https://test.invalid/completed" };
    Object.assign(remote.nodes[0].metadata, { storageKey: "resource:one", assetId: "generated-one" });
    if (scenario === "conflict" || scenario === "converged") {
        for (const project of [baseline, local, remote]) {
            project.nodes[0].type = "text";
            project.nodes[0].metadata.status = "success";
            project.nodes[0].metadata.taskStatus = "succeeded";
        }
        baseline.nodes[0].metadata.content = "before";
        local.nodes[0].metadata.content = "local";
        remote.nodes[0].metadata.content = scenario === "converged" ? "local" : "remote";
        remote.nodes[0].title = local.nodes[0].title;
        Reflect.deleteProperty(remote.nodes[0].metadata, "storageKey");
        Reflect.deleteProperty(remote.nodes[0].metadata, "assetId");
    }
    remoteAssets.set("generated-one", {
        id: "generated-one",
        kind: "image",
        title: "completed",
        coverUrl: "/api/resources/one/file",
        tags: [],
        metadata: {},
        data: { dataUrl: "/api/resources/one/file", storageKey: "resource:one", bytes: 1, width: 100, height: 100, mimeType: "image/png" },
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
    });
    cloud.set("old", remote);
    if (scenario === "deleted") cloud.delete("old");
    if (scenario === "cached-create") {
        cloud.delete("old");
        local.revision = 0;
    }
    const request = { mutationId: "original-request", baseRevision: 1, operations: sync.buildCanvasOperations(baseline as never, local as never) };
    if (!["journal-lock", "cache-stale", "cached-create", "load"].includes(scenario)) harness.app.set("yingce:canvas-mutation-journal:user:test-user", JSON.stringify([{ projectId: "old", request, baseline, prepared: local, createdAt: "" }]));
    useCanvasStore.setState({ projects: [local] as never });
    await flushCanvasStorePersistence();
    await sync.initializeRemoteUserDataSession("test-user");
    if (scenario === "cache-stale") useCanvasStore.getState().renameProject("old", "unconfirmed local edit");
    if (scenario === "journal-lock") {
        cloud.set("old", structuredClone(local));
        const otherTab = await import("../../src/services/user-data-sync.ts?second-realm");
        await otherTab.initializeRemoteUserDataSession("test-user");
        useCanvasStore.getState().renameProject("old", "pending edit");
        const oldSave = sync.saveRemoteUserDataNow("old").catch(() => undefined);
        await waiting;
        const id = useCanvasStore.getState().createProject("new");
        const newSave = otherTab.saveRemoteUserDataNow(id);
        release();
        await Promise.all([oldSave, newSave]);
        return { journal: JSON.parse(harness.app.get("yingce:canvas-mutation-journal:user:test-user") as string), original: requests.find((item) => item.url === "/canvas-projects/old/operations")?.body, newSaved: cloud.has(id), lockNames };
    }
    if (scenario === "project-link") {
        const assetId = useAssetStore.getState().addAsset({
            kind: "audio",
            title: "audio",
            coverUrl: "",
            category: "material",
            status: "confirmed",
            source: "test",
            tags: [],
            metadata: { projectIds: ["project"] },
            data: { url: "/api/resources/one/file", storageKey: "resource:one", bytes: 10, mimeType: "audio/mpeg" },
        });
        const result = await assets.ensureCanvasNodeAsset({
            canvasId: "old",
            domainProjectId: "project",
            source: "canvas-manual",
            node: { id: "asset-node", type: "audio", title: "audio", position: { x: 0, y: 0 }, width: 10, height: 10, metadata: { assetId, content: "/api/resources/one/file", storageKey: "resource:one" } } as never,
        });
        return { result, links: requests.filter((item) => item.url === "/projects/project/assets").length, canvasWrites: requests.filter((item) => item.url?.endsWith("/operations")).length };
    }
    let firstFailed = false;
    let firstError = "";
    if (scenario === "scope" || scenario === "load") {
        const globalSave = (scenario === "load" ? sync.loadCanvasProjectForEditing("old") : sync.saveRemoteUserDataNow()).catch(() => {
            firstFailed = true;
        });
        await waiting;
        const id = useCanvasStore.getState().createProject("new");
        const scopedSave = sync.saveRemoteUserDataNow(id);
        release();
        await Promise.all([globalSave, scopedSave]);
        return { firstFailed, newSaved: cloud.has(id), oldRequests };
    }
    try {
        await sync.saveRemoteUserDataNow("old");
    } catch (error) {
        firstError = String(error);
        firstFailed = true;
    }
    if (scenario === "unknown" || scenario === "id-reused") {
        try {
            await sync.saveRemoteUserDataNow("old");
        } catch {
            /* Same body is still pending. */
        }
    }
    if (scenario === "deleted" || scenario === "conflict" || scenario === "cache-stale") {
        const id = useCanvasStore.getState().createProject("new");
        await sync.saveRemoteUserDataNow(id);
        await sync.initializeRemoteUserDataSession("test-user");
        await sync.saveRemoteUserDataNow().catch(() => undefined);
    } else if (!firstFailed) await sync.saveRemoteUserDataNow("old");
    const { readAllCanvasSyncDrafts } = await import("../../src/services/canvas-sync-drafts");
    return {
        firstFailed,
        firstError,
        oldRequests,
        requests,
        cloudProjects: [...cloud.values()],
        local: useCanvasStore.getState().openProject("old"),
        journal: harness.app.get("yingce:canvas-mutation-journal:user:test-user"),
        drafts: await readAllCanvasSyncDrafts(),
        cloud: [...cloud.keys()],
    };
}

self.onmessage = async (event: MessageEvent<string>) => {
    try {
        self.postMessage({ ok: true, result: await run(event.data) });
    } catch (error) {
        self.postMessage({ ok: false, error: error instanceof Error ? error.stack : String(error) });
    }
};
