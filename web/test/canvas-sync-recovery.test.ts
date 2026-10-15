import { expect, test } from "bun:test";

function scenario(name: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./helpers/canvas-sync-recovery.worker.ts", import.meta.url).href, { type: "module" });
        const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error(`Timed out: ${name}`));
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
        worker.postMessage(name);
    });
}

test("stale task status rebases onto completed cloud output and preserves the user's title", async () => {
    const result = await scenario("status");
    expect(result.firstFailed).toBe(false);
    expect(result.local.nodes[0]).toMatchObject({ title: "local title", metadata: { status: "success", taskStatus: "succeeded", content: "/api/resources/one/file", storageKey: "resource:one", assetId: "generated-one" } });
    const posts = result.requests.filter((item: any) => item.method === "patch");
    expect(posts).toHaveLength(2);
    expect(posts[0].body.mutationId).toBe("original-request");
    expect(posts[1].body.mutationId).not.toBe("original-request");
    expect(result.journal).toBeUndefined();
});

test("already converged content is adopted without submitting another mutation", async () => {
    const result = await scenario("converged");
    expect(result.firstFailed).toBe(false);
    expect(result.oldRequests).toBe(1);
    expect(result.local.nodes[0].metadata.content).toBe("local");
    expect(result.journal).toBeUndefined();
});

for (const name of ["conflict", "deleted"])
    test(`${name} retains a durable draft and does not block new canvases, including after reload`, async () => {
        const result = await scenario(name);
        expect(result.firstFailed).toBe(true);
        expect(result.oldRequests).toBe(1);
        expect(result.drafts).toHaveLength(1);
        expect(JSON.parse(result.journal)[0].blocked).toBe(name === "deleted" ? "unavailable" : "conflict");
        expect(result.cloud.length).toBe(name === "deleted" ? 1 : 2);
        if (name === "conflict") expect(result.local.nodes[0].metadata.content).toBe("local");
    });

test("ambiguous server failure retries the exact mutation ID and body without fetching a new baseline", async () => {
    const result = await scenario("unknown");
    const posts = result.requests.filter((item: any) => item.method === "patch");
    expect(posts).toHaveLength(2);
    expect(posts[0].body).toEqual(posts[1].body);
    expect(result.requests.some((item: any) => item.method === "get")).toBe(false);
    expect(JSON.parse(result.journal)[0].request).toEqual(posts[0].body);
});

test("a scoped save queued behind a failing global save confirms its own canvas", async () => {
    const result = await scenario("scope");
    expect(result).toEqual({ firstFailed: true, newSaved: true, oldRequests: 1 });
});

test("an unrelated failed canvas load does not prevent saving the selected canvas", async () => {
    const result = await scenario("load");
    expect(result).toEqual({ firstFailed: true, newSaved: true, oldRequests: 0 });
});

test("mutation ID reuse is surfaced without rewriting the original body", async () => {
    const result = await scenario("id-reused");
    const posts = result.requests.filter((item: any) => item.method === "patch");
    expect(result.firstFailed).toBe(true);
    expect(posts).toHaveLength(2);
    expect(posts[0].body).toEqual(posts[1].body);
    expect(result.requests.some((item: any) => item.method === "get")).toBe(false);
});

test("two audio outputs materialize and replay as distinct durable assets", async () => {
    const result = await scenario("audio");
    expect(result.first).toHaveLength(2);
    expect(new Set(result.first.map((item: any) => item.materializedAssetId)).size).toBe(2);
    expect(result.replay).toEqual(result.first);
    expect(result.count).toBe(2);
    expect(result.blobs.sort()).toEqual(["ID3-track-0", "ID3-track-1"]);
});

test("502 download does not create an asset, and retrying the original task recovers without duplicates", async () => {
    const result = await scenario("download");
    expect(result.failed).toBe(true);
    expect(result.countAfterFailure).toBe(0);
    expect(result.count).toBe(1);
    expect(result.downloads).toBe(2);
});

test("a previously completed effect with a poisoned blob repairs the existing asset", async () => {
    const result = await scenario("bad-cache");
    expect(result.count).toBe(1);
    expect(result.downloads).toBe(2);
    expect(result.blob).toBe("ID3-track");
    expect(result.outputs[0].materializedAssetId).toBe(result.originalAssetId);
});

test("project association is confirmed with the server despite a stale local hint and an unrelated canvas queue", async () => {
    const result = await scenario("project-link");
    expect(result.result.linkedToProject).toBe(true);
    expect(result.links).toBe(1);
    expect(result.canvasWrites).toBe(0);
});

test("independent page modules share a browser effect lock and produce one materialization claim", async () => {
    const result = await scenario("locks");
    expect(result.statuses).toEqual(["busy", "claimed"]);
    expect(result.replays).toEqual([
        { status: "completed", result: { materializedAssetId: "single-asset" } },
        { status: "completed", result: { materializedAssetId: "single-asset" } },
    ]);
    expect(result.lockNames.some((name: string) => name.startsWith("yingce:generation-effect-lock:"))).toBe(true);
});

test("another page reloads the journal under the browser lock before saving, preserving an ambiguous request", async () => {
    const result = await scenario("journal-lock");
    expect(result.newSaved).toBe(true);
    expect(result.journal).toHaveLength(1);
    expect(result.journal[0].projectId).toBe("old");
    expect(result.journal[0].request).toEqual(result.original);
    expect(result.lockNames.some((name: string) => name.startsWith("yingce:remote-user-data-sync:"))).toBe(true);
});

test("a stale cache without an edit baseline is preserved before any overwrite attempt", async () => {
    const result = await scenario("cache-stale");
    expect(result.firstFailed).toBe(true);
    expect(result.oldRequests).toBe(0);
    expect(result.drafts).toHaveLength(1);
    expect(result.local.title).toBe("unconfirmed local edit");
    expect(result.cloud.length).toBe(2);
});

test("a cached revision-zero canvas without a journal can still be created after reload", async () => {
    const result = await scenario("cached-create");
    expect(result.firstFailed).toBe(false);
    expect(result.oldRequests).toBe(1);
    expect(result.local.revision).toBe(1);
    expect(result.journal).toBeUndefined();
});
