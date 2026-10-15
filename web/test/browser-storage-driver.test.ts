import { expect, test } from "bun:test";

function migrate(scenario: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./helpers/browser-storage-migration.worker.ts", import.meta.url).href, { type: "module" });
        const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error("IndexedDB migration timed out"));
        }, 10_000);
        worker.onmessage = (event) => {
            clearTimeout(timer);
            worker.terminate();
            event.data.ok ? resolve(event.data.result) : reject(new Error(event.data.error));
        };
        worker.onerror = (event) => {
            clearTimeout(timer);
            worker.terminate();
            reject(event.error || new Error(event.message));
        };
        worker.postMessage(scenario);
    });
}

for (const scenario of ["full", "interrupted"])
    test(`real localforage IndexedDB driver migrates all business stores (${scenario})`, async () => {
        const result = await migrate(scenario);
        expect(result).toMatchObject({
            interrupted: scenario === "interrupted",
            sharedPromise: true,
            marker: "done",
            canvasA: "offline-A",
            canvasB: "newer-B",
            exactRequest: true,
            audio: "ID3-audio",
            audioType: "audio/mpeg",
            imageBytes: [137, 80, 78, 71],
            drawing: { id: "drawing-one", elements: [{ id: "element" }] },
            oldCanvas: "offline-A",
            oldAudio: "ID3-audio",
            oldSchemaUnchanged: true,
        });
    });

test("a clean installation does not create a legacy database", async () => {
    const result = await migrate("empty");
    expect(result.names).not.toContain("infinite-canvas");
    expect(result.marker).toBe("done");
    expect(result.scope).toBe("A");
});
