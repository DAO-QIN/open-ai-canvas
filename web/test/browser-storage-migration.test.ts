import { expect, test } from "bun:test";
import { copyLegacyBrowserStore, migrateLocalStorageNamespace } from "../src/services/browser-storage-migration";

function memory(values = new Map<string, unknown>()) {
    return {
        values,
        keys: async () => [...values.keys()],
        getItem: async (key: string) => values.get(key) ?? null,
        setItem: async (key: string, value: unknown) => {
            values.set(key, value);
            return value;
        },
    };
}

test("migration preserves scoped canvases and exact mutation requests and leaves the old store intact", async () => {
    const request = JSON.stringify([{ projectId: "canvas", request: { mutationId: "ambiguous", operations: [{ type: "patch_node", id: "node", before: { "metadata.content": "" }, patch: { "metadata.content": "draft" } }] } }]);
    const old = memory(
        new Map([
            ["infinite-canvas:canvas_store:user:account-A", "offline-canvas-A"],
            ["infinite-canvas:canvas_store:user:account-B", "offline-canvas-B"],
            ["yingce:canvas-mutation-journal:user:account-A", request],
            ["infinite-canvas:generation-effect:account-A:materialize:task:0:user:account-A", "completed-effect"],
        ]),
    );
    const target = memory();
    await copyLegacyBrowserStore(old as never, target as never, "app_state");
    expect(target.values.get("yingce:canvas_store:user:account-A")).toBe("offline-canvas-A");
    expect(target.values.get("yingce:canvas_store:user:account-B")).toBe("offline-canvas-B");
    expect(target.values.get("yingce:canvas-mutation-journal:user:account-A")).toBe(request);
    expect(target.values.get("yingce:generation-effect:account-A:materialize:task:0:user:account-A")).toBe("completed-effect");
    expect(old.values.size).toBe(4);
});

test("interrupted migration can resume without overwriting data already saved in the new store", async () => {
    const old = memory(
        new Map([
            ["infinite-canvas:canvas_store:user:A", "old"],
            ["infinite-canvas:asset_store:user:A", "asset"],
        ]),
    );
    const target = memory();
    let writes = 0;
    const interrupted = {
        ...target,
        setItem: async (key: string, value: unknown) => {
            if (++writes === 2) throw new Error("quota");
            return target.setItem(key, value);
        },
    };
    await expect(copyLegacyBrowserStore(old as never, interrupted as never, "app_state")).rejects.toThrow("quota");
    target.values.set("yingce:canvas_store:user:A", "newer edit");
    await copyLegacyBrowserStore(old as never, target as never, "app_state");
    expect(target.values.get("yingce:canvas_store:user:A")).toBe("newer edit");
    expect(target.values.get("yingce:asset_store:user:A")).toBe("asset");
    expect(old.values.get("infinite-canvas:canvas_store:user:A")).toBe("old");
});

test("media blob keys and bytes survive migration", async () => {
    const blob = new Blob(["ID3-original-track"], { type: "audio/mpeg" });
    const old = memory(new Map([["generation-audio:A:materialize%3Atask%3A0", blob]]));
    const target = memory();
    await copyLegacyBrowserStore(old as never, target as never, "media_files");
    expect(await (target.values.values().next().value as Blob).text()).toBe("ID3-original-track");
    expect(old.values.size).toBe(1);
});

test("local preferences migrate while persistence journal names follow the new canvas store", () => {
    const values = new Map([
        ["infinite-canvas:active-user-scope", "A"],
        ["infinite-canvas:theme_store:user:A", "dark"],
        ["yingce:canvas_store_journal:user:A:tab", JSON.stringify({ name: "infinite-canvas:canvas_store", projects: [{ id: "unsaved" }] })],
    ]);
    const storage = { length: values.size, key: (index: number) => [...values.keys()][index], getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    migrateLocalStorageNamespace(storage as never);
    expect(values.get("yingce:active-user-scope")).toBe("A");
    expect(values.get("yingce:theme_store:user:A")).toBe("dark");
    expect(JSON.parse(values.get("yingce:canvas_store_journal:user:A:tab")!)).toEqual({ name: "yingce:canvas_store", projects: [{ id: "unsaved" }] });
    expect(values.get("infinite-canvas:theme_store:user:A")).toBe("dark");
});
