import { submitCreationEntry, type CreationEntry, type CreationEntryType, type CreationReference } from "@/services/api/creation-sessions";
import { announceGenerationTaskCreated, queryGenerationTask, type CreateTaskInput, type GenerationTask } from "@/services/api/task-center";

/**
 * 把首页一次生成的全部任务输入合成一条服务端生成记录。
 *
 * 生成流程照旧逐个调用 createTask（参考上传、协议参数、等待、物化都不变）；这里先收齐 taskCount 个输入，
 * 一次提交 POST /creation/sessions/:id/entries，由服务端建任务、计费并保证同一 clientOperationId 不重复扣费，
 * 再按槽位把建好的任务交还给各自的调用方。
 */

export type CreationEntryTaskCreatorOptions = {
    sessionId: string;
    clientOperationId: string;
    type: CreationEntryType;
    prompt: string;
    config?: Record<string, unknown>;
    references?: CreationReference[];
    taskCount: number;
    onEntry?: (entry: CreationEntry) => void;
};

export type CreationEntryTaskCreatorDependencies = {
    submit: typeof submitCreationEntry;
    queryTask: (id: string) => Promise<GenerationTask>;
    announce: (task: GenerationTask) => void;
};

const defaultDependencies: CreationEntryTaskCreatorDependencies = {
    submit: submitCreationEntry,
    queryTask: (id) => queryGenerationTask(id),
    announce: announceGenerationTaskCreated,
};

type PendingSlot = { input: CreateTaskInput; order: number; resolve: (task: GenerationTask) => void; reject: (error: unknown) => void };

function batchIndexOf(input: CreateTaskInput) {
    const metadata = input.input?.metadata;
    const value = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).batchIndex : undefined;
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function createCreationEntryTaskCreator(options: CreationEntryTaskCreatorOptions, dependencies: CreationEntryTaskCreatorDependencies = defaultDependencies) {
    const expected = Math.max(1, Math.floor(options.taskCount) || 1);
    const pending: PendingSlot[] = [];
    let submitted = false;

    const flush = async (slots: PendingSlot[]) => {
        let entry: CreationEntry;
        try {
            entry = await dependencies.submit(options.sessionId, {
                clientOperationId: options.clientOperationId,
                type: options.type,
                prompt: options.prompt,
                config: options.config,
                references: options.references,
                tasks: slots.map((slot) => slot.input),
            });
        } catch (error) {
            for (const slot of slots) slot.reject(error);
            return;
        }
        options.onEntry?.(entry);
        await Promise.all(
            slots.map(async (slot, index) => {
                const result = entry.results.find((item) => item.slot === index);
                if (!result?.taskId) {
                    slot.reject(new Error(result?.failure || "生成任务未能创建"));
                    return;
                }
                try {
                    const task = await dependencies.queryTask(result.taskId);
                    dependencies.announce(task);
                    slot.resolve(task);
                } catch (error) {
                    slot.reject(error);
                }
            }),
        );
    };

    return (input: CreateTaskInput) =>
        new Promise<GenerationTask>((resolve, reject) => {
            if (submitted) {
                reject(new Error("本次生成已提交，不能再追加任务"));
                return;
            }
            pending.push({ input, order: batchIndexOf(input) ?? pending.length, resolve, reject });
            if (pending.length < expected) return;
            submitted = true;
            void flush([...pending].sort((left, right) => left.order - right.order));
        });
}
