import type { ModelCatalogResponse, PublicChannelModel } from "@/services/api/logical-models";
import type { ModelSelection } from "./contracts";

export type ProductModelChoice = { value: string; label: string; selection: ModelSelection; model: PublicChannelModel };
export function modelChoices(catalog: ModelCatalogResponse, capability: "text" | "image", minimumImages = 1): ProductModelChoice[] {
    return (catalog.channels ?? []).flatMap((channel) =>
        channel.models
            .filter((model) => {
                const config = model.capabilityConfig as { text?: { references?: { maxImages?: number } }; image?: { references?: { maxImages?: number } } } | undefined;
                return model.available && model.capability === capability && (config?.[capability]?.references?.maxImages ?? 0) >= minimumImages;
            })
            .map((model) => ({
                value: channel.id + ":" + model.modelKey,
                label: (model.displayName || model.modelKey) + " · " + (model.channelLabel || channel.displayName || channel.name),
                selection: { channelId: channel.id, channelModelKey: model.modelKey },
                model,
            })),
    );
}
export function selectedModelKey(selection: ModelSelection) {
    return selection.logicalModelId ? "logical:" + selection.logicalModelId : selection.channelId + ":" + selection.channelModelKey;
}
