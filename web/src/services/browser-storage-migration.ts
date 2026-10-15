import localforage from "localforage";

const LEGACY_DATABASE = "infinite-canvas";
export const BROWSER_STORAGE_DATABASE = "yingce";
const MIGRATION_MARKER = "yingce:storage-migration:v1";
let migration: Promise<void> | undefined;

export function migratedStorageKey(key: string) {
    return key.replace(/^infinite-canvas(?=[:/])/, "yingce");
}

function migratedStateValue(key: string, value: unknown) {
    if (!key.startsWith("yingce:canvas_store_journal") || typeof value !== "string") return value;
    try {
        const journal = JSON.parse(value) as { name?: string };
        return journal.name === "infinite-canvas:canvas_store" ? JSON.stringify({ ...journal, name: "yingce:canvas_store" }) : value;
    } catch {
        return value;
    }
}

/** The legacy database remains a recovery copy. Existing new data always wins. */
export async function copyLegacyBrowserStore(legacy: Pick<LocalForage, "keys" | "getItem">, target: Pick<LocalForage, "getItem" | "setItem">, storeName: string) {
    for (const key of await legacy.keys()) {
        const nextKey = storeName === "app_state" ? migratedStorageKey(key) : key;
        if ((await target.getItem(nextKey)) !== null) continue;
        const value = await legacy.getItem(key);
        if (value === null) continue;
        await target.setItem(nextKey, storeName === "app_state" ? migratedStateValue(nextKey, value) : value);
        if ((await target.getItem(nextKey)) === null) throw new Error("本地资料迁移尚未完成");
    }
}

export function migrateLocalStorageNamespace(storage: Storage) {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key));
    for (const key of keys) {
        const nextKey = migratedStorageKey(key);
        const value = storage.getItem(key);
        if (value === null) continue;
        if (nextKey !== key && storage.getItem(nextKey) === null) storage.setItem(nextKey, value);
        if (key.startsWith("yingce:canvas_store_journal")) {
            const next = migratedStateValue(key, value);
            if (next !== value) storage.setItem(key, String(next));
        }
    }
}

async function legacyObjectStores(): Promise<string[]> {
    if (typeof indexedDB.databases === "function" && !(await indexedDB.databases()).some((db) => db.name === LEGACY_DATABASE && (db.version ?? 0) > 0)) return [];
    return new Promise((resolve, reject) => {
        let absent = false;
        const request = indexedDB.open(LEGACY_DATABASE);
        request.onupgradeneeded = () => {
            absent = true;
            request.transaction?.abort();
        };
        request.onerror = () => (absent ? resolve([]) : reject(request.error));
        request.onsuccess = () => {
            const db = request.result;
            const stores = Array.from(db.objectStoreNames).filter((name) => name !== "local-forage-detect-blob-support");
            db.close();
            resolve(stores);
        };
    });
}

export function migrateBrowserStorage() {
    if (migration) return migration;
    const run = async () => {
        if (window.localStorage.getItem(MIGRATION_MARKER) === "done") return;
        if (typeof indexedDB !== "undefined") {
            for (const storeName of await legacyObjectStores()) {
                const legacy = localforage.createInstance({ name: LEGACY_DATABASE, storeName, driver: localforage.INDEXEDDB });
                const target = localforage.createInstance({ name: BROWSER_STORAGE_DATABASE, storeName, driver: localforage.INDEXEDDB });
                await copyLegacyBrowserStore(legacy, target, storeName);
            }
        }
        migrateLocalStorageNamespace(window.localStorage);
        window.localStorage.setItem(MIGRATION_MARKER, "done");
    };
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    migration = (locks ? locks.request("yingce:storage-migration", run) : run()).catch((error) => {
        migration = undefined;
        throw error;
    });
    return migration;
}
