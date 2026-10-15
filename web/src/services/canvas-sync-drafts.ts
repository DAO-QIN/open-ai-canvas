import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export type CanvasSyncDraft = { id: string; savedAt: string; project: CanvasProject; reason?: string; mutationId?: string; scope?: string };
// Keep previously saved drafts readable after operations journals replace draft writes.
const draftKey = (projectId: string) => `yingce:sync-drafts:${projectId}`;
const draftIndexKey = "yingce:sync-draft-index";

export async function readAllCanvasSyncDrafts(scope = getActiveUserScope()) {
    const raw = await localForageStorageForScope(scope).getItem(draftIndexKey);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    return (await Promise.all(ids.map((id) => readCanvasSyncDrafts(id, scope)))).flat();
}

export async function readCanvasSyncDrafts(projectId: string, scope = getActiveUserScope()): Promise<CanvasSyncDraft[]> {
    const raw = await localForageStorageForScope(scope).getItem(draftKey(projectId));
    return raw ? (JSON.parse(raw) as CanvasSyncDraft[]).map((draft) => ({ ...draft, scope })) : [];
}

export async function saveCanvasSyncDraft(project: CanvasProject, reason: string, mutationId?: string, scope = getActiveUserScope()) {
    const storage = localForageStorageForScope(scope);
    const drafts = await readCanvasSyncDrafts(project.id, scope);
    const id = mutationId || crypto.randomUUID();
    const draft = { id, savedAt: new Date().toISOString(), project, reason, mutationId };
    await storage.setItem(draftKey(project.id), JSON.stringify([...drafts.filter((item) => item.id !== id), draft]));
    const rawIndex = await storage.getItem(draftIndexKey);
    const index: string[] = rawIndex ? JSON.parse(rawIndex) : [];
    await storage.setItem(draftIndexKey, JSON.stringify([...new Set([...index, project.id])]));
    return draft;
}
