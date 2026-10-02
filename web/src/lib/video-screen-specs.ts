import type { VideoCapabilityConfig, VideoScreenSpecConfig } from "./model-capabilities";
import type { ModelProtocolWorkflow } from "./model-protocols";

export function cleanVideoScreenSpecValues(values: readonly string[]) {
    const seen = new Set<string>();
    return values.map((value) => value.trim()).filter((value) => {
        const key = value.toLowerCase();
        if (!value || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function workflowVideoScreenSpec(workflow: ModelProtocolWorkflow): VideoScreenSpecConfig {
    const resolution = workflow.parameters.find((field) => field.mapping === "resolution" || field.name === "resolution");
    return {
        ratios: [],
        defaultRatio: "",
        resolutions: cleanVideoScreenSpecValues(resolution?.values || []),
        defaultResolution: String(resolution ? workflow.defaults?.[resolution.name] || "" : "").trim(),
    };
}

export function resolveWorkflowVideoScreenSpec(profile: VideoCapabilityConfig, workflow?: ModelProtocolWorkflow): VideoCapabilityConfig {
    const fixed = workflow ? workflowVideoScreenSpec(workflow) : profile.fixedScreenSpec;
    if (!fixed) return profile;
    const source = profile.customScreenSpec || (profile.customSizeEnabled ? profile : fixed);
    const resolutions = cleanVideoScreenSpecValues(source.resolutions);
    const defaultResolution = source.defaultResolution.trim();
    const custom: VideoScreenSpecConfig = {
        ratios: [],
        defaultRatio: "",
        resolutions,
        defaultResolution: resolutions.find((value) => value.toLowerCase() === defaultResolution.toLowerCase()) || defaultResolution,
    };
    return {
        ...profile,
        ...(profile.customSizeEnabled ? custom : fixed),
        customSizeEnabled: profile.customSizeEnabled === true,
        customScreenSpec: custom,
        fixedScreenSpec: fixed,
    };
}

export function updateWorkflowVideoScreenSpec(profile: VideoCapabilityConfig, workflow: ModelProtocolWorkflow | undefined, patch: Partial<VideoScreenSpecConfig> & { customSizeEnabled?: boolean }): VideoCapabilityConfig {
    const resolved = resolveWorkflowVideoScreenSpec(profile, workflow);
    if (!resolved.fixedScreenSpec) return profile;
    const { customSizeEnabled = resolved.customSizeEnabled, ...values } = patch;
    return resolveWorkflowVideoScreenSpec({
        ...resolved,
        customSizeEnabled,
        customScreenSpec: { ...resolved.customScreenSpec!, ...values },
    }, workflow);
}
