import "fake-indexeddb/auto";

async function run(scenario: string) {
    const { default: localforage } = await import("localforage");
    const { migrateBrowserStorage } = await import("../../src/services/browser-storage-migration");
    const preferences = new Map<string, string>([["infinite-canvas:active-user-scope", "A"]]);
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            indexedDB,
            localStorage: {
                get length() {
                    return preferences.size;
                },
                key: (index: number) => [...preferences.keys()][index] ?? null,
                getItem: (key: string) => preferences.get(key) ?? null,
                setItem: (key: string, value: string) => preferences.set(key, value),
            },
        },
    });
    const store = (name: string, storeName: string) => localforage.createInstance({ name, storeName, driver: localforage.INDEXEDDB });
    if (scenario === "empty") {
        await migrateBrowserStorage();
        return { names: (await indexedDB.databases()).map((db) => db.name), marker: preferences.get("yingce:storage-migration:v1"), scope: preferences.get("yingce:active-user-scope") };
    }
    const oldState = store("infinite-canvas", "app_state");
    await oldState.setItem("infinite-canvas:canvas_store:user:A", "offline-A");
    await oldState.setItem("infinite-canvas:canvas_store:user:B", "offline-B");
    const mutation = JSON.stringify([{ projectId: "canvas", request: { mutationId: "unconfirmed", operations: [{ type: "set_field", field: "title", value: "offline", beforeValue: "before" }] } }]);
    await oldState.setItem("yingce:canvas-mutation-journal:user:A", mutation);
    const oldMedia = store("infinite-canvas", "media_files");
    await oldMedia.setItem("generation-audio:A:original", new Blob(["ID3-audio"], { type: "audio/mpeg" }));
    const oldImages = store("infinite-canvas", "image_files");
    await oldImages.setItem("generation-image:A:original", new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));
    const drawing = store("infinite-canvas", "drawing_documents");
    await drawing.setItem("drawing:A:one", { id: "drawing-one", elements: [{ id: "element" }] });
    const targetState = store("yingce", "app_state");
    await targetState.setItem("yingce:canvas_store:user:B", "newer-B");
    const schema = (name: string): Promise<string[]> =>
        new Promise((resolve, reject) => {
            const request = indexedDB.open(name);
            request.onsuccess = () => {
                const names = [...request.result.objectStoreNames];
                request.result.close();
                resolve(names);
            };
            request.onerror = () => reject(request.error);
        });
    const beforeSchema = await schema("infinite-canvas");
    let interrupted = false;
    if (scenario === "interrupted") {
        const originalCreate = localforage.createInstance.bind(localforage);
        const targetMedia = originalCreate({ name: "yingce", storeName: "media_files", driver: localforage.INDEXEDDB });
        await targetMedia.ready();
        const originalSet = targetMedia.setItem.bind(targetMedia);
        let failOnce = true;
        targetMedia.setItem = (async (key: string, value: unknown) => {
            if (failOnce) {
                failOnce = false;
                throw new DOMException("quota", "QuotaExceededError");
            }
            return originalSet(key, value);
        }) as never;
        localforage.createInstance = ((options: LocalForageOptions) => {
            return options.name === "yingce" && options.storeName === "media_files" ? targetMedia : originalCreate(options);
        }) as typeof localforage.createInstance;
        try {
            await migrateBrowserStorage();
        } catch {
            interrupted = true;
        }
        if (!interrupted) throw new Error("Fault injection did not run");
        if (preferences.has("yingce:storage-migration:v1")) throw new Error("Migration marked complete after a failed write");
    }
    const first = migrateBrowserStorage();
    const second = migrateBrowserStorage();
    await Promise.all([first, second]);
    const targetMedia = store("yingce", "media_files");
    const audio = await targetMedia.getItem<Blob>("generation-audio:A:original");
    const image = await store("yingce", "image_files").getItem<Blob>("generation-image:A:original");
    return {
        interrupted,
        sharedPromise: first === second,
        marker: preferences.get("yingce:storage-migration:v1"),
        canvasA: await targetState.getItem("yingce:canvas_store:user:A"),
        canvasB: await targetState.getItem("yingce:canvas_store:user:B"),
        exactRequest: (await targetState.getItem("yingce:canvas-mutation-journal:user:A")) === mutation,
        audio: await audio?.text(),
        audioType: audio?.type,
        imageBytes: image ? [...new Uint8Array(await image.arrayBuffer())] : [],
        drawing: await store("yingce", "drawing_documents").getItem("drawing:A:one"),
        oldCanvas: await oldState.getItem("infinite-canvas:canvas_store:user:A"),
        oldAudio: await (await oldMedia.getItem<Blob>("generation-audio:A:original"))?.text(),
        oldSchemaUnchanged: JSON.stringify(beforeSchema) === JSON.stringify(await schema("infinite-canvas")),
    };
}

self.onmessage = async (event: MessageEvent<string>) => {
    try {
        self.postMessage({ ok: true, result: await run(event.data) });
    } catch (error) {
        self.postMessage({ ok: false, error: error instanceof Error ? error.stack : String(error) });
    }
};
