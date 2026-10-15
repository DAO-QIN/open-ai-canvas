export async function loadOrStoreGenerationArtifact<TArtifact>(dependencies: {
    effectKey: string;
    read: (effectKey: string) => Promise<TArtifact | null>;
    materialize: () => Promise<TArtifact>;
    write: (effectKey: string, artifact: TArtifact) => Promise<void>;
    validate?: (artifact: TArtifact) => boolean | Promise<boolean>;
}): Promise<TArtifact> {
    const existing = await dependencies.read(dependencies.effectKey);
    if (existing && (!dependencies.validate || (await dependencies.validate(existing)))) return existing;
    const materialized = await dependencies.materialize();
    if (dependencies.validate && !(await dependencies.validate(materialized))) throw new Error("生成结果校验失败，未写入缓存");
    await dependencies.write(dependencies.effectKey, materialized);
    const stored = (await dependencies.read(dependencies.effectKey)) ?? materialized;
    if (dependencies.validate && !(await dependencies.validate(stored))) throw new Error("生成结果缓存校验失败，请重新读取结果");
    return stored;
}

export function generationArtifactStorageKey(effectKey: string, mediaType: "image" | "video" | "audio", scope = "local"): string {
    return `generation-${mediaType}:${scope}:${encodeURIComponent(effectKey)}`;
}
