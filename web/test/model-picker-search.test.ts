import { expect, test } from "bun:test";
import { filterModelPickerGroups, type ModelPickerGroup } from "../src/lib/model-picker-groups";

const groups: ModelPickerGroup[] = Array.from({ length: 40 }, (_, index) => ({
    key: `group-${index}`, label: `模型 ${index}`, icon: "", scope: "平台服务", kind: "product",
    models: Array.from({ length: 3 }, (_, channel) => ({ key: `${index}-${channel}`, label: `渠道 ${channel}`, models: [`provider-${index}-${channel}::Model-${index}`] })),
}));

test("full mobile catalogue retains all groups and the final channel, without slicing", () => {
    expect(filterModelPickerGroups(groups, "  ")).toBe(groups);
    expect(filterModelPickerGroups(groups, "").flatMap((group) => group.models)).toHaveLength(120);
    expect(filterModelPickerGroups(groups, "").at(-1)?.models.at(-1)?.key).toBe("39-2");
});

test("search finds the final model group and preserves all of its independent channels", () => {
    const result = filterModelPickerGroups(groups, " 模型 39 ");
    expect(result).toHaveLength(1);
    expect(result[0].models).toHaveLength(3);
    expect(result[0].models.at(-1)?.models).toEqual(["provider-39-2::Model-39"]);
});

test("channel and raw model searches ignore case and keep catalogue order", () => {
    const channels = filterModelPickerGroups(groups, "渠道 2");
    expect(channels).toHaveLength(40);
    expect(channels.flatMap((group) => group.models)).toHaveLength(40);
    expect(filterModelPickerGroups(groups, "PROVIDER-39-2")[0].models[0].key).toBe("39-2");
    expect(filterModelPickerGroups(groups, "不存在")).toEqual([]);
    expect(groups[39].models).toHaveLength(3);
});
