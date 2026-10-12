import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export type CanvasSyncDraft = { id: string; savedAt: string; project: CanvasProject };
// Keep previously saved drafts readable after operations journals replace draft writes.
const draftKey = (projectId: string) => `infinite-canvas:sync-drafts:${projectId}`;
const draftIndexKey = "infinite-canvas:sync-draft-index";

export async function readAllCanvasSyncDrafts(scope = getActiveUserScope()) {
    const raw = await localForageStorageForScope(scope).getItem(draftIndexKey);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    return (await Promise.all(ids.map((id) => readCanvasSyncDrafts(id, scope)))).flat();
}

export async function readCanvasSyncDrafts(projectId: string, scope = getActiveUserScope()): Promise<CanvasSyncDraft[]> {
    const raw = await localForageStorageForScope(scope).getItem(draftKey(projectId));
    return raw ? JSON.parse(raw) : [];
}
