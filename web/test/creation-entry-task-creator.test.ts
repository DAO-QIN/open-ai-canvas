import { expect, test } from "bun:test";
import type { CreationEntry, SubmitCreationEntryInput } from "../src/services/api/creation-sessions";
import type { CreateTaskInput, GenerationTask } from "../src/services/api/task-center";
import { createCreationEntryTaskCreator, type CreationEntryTaskCreatorDependencies } from "../src/services/creation-entry-task-creator";

function taskInput(batchIndex?: number): CreateTaskInput {
    return { type: "canvas_image", prompt: "海报", input: { mode: "image", metadata: batchIndex === undefined ? {} : { batchIndex } } };
}

function entryWith(results: CreationEntry["results"]): CreationEntry {
    return {
        id: "entry-1",
        sessionId: "session-1",
        origin: "manual",
        clientOperationId: "op-1",
        type: "image",
        prompt: "海报",
        config: {},
        references: [],
        creditsMicrocredits: "0",
        status: "pending",
        results,
        hiddenFailed: false,
        revision: 1,
        createdAt: "",
        updatedAt: "",
    };
}

function harness(results: CreationEntry["results"], submitError?: Error) {
    const submissions: Array<{ sessionId: string; input: SubmitCreationEntryInput }> = [];
    const announced: string[] = [];
    const dependencies: CreationEntryTaskCreatorDependencies = {
        submit: async (sessionId, input) => {
            submissions.push({ sessionId, input });
            if (submitError) throw submitError;
            return entryWith(results);
        },
        queryTask: async (id) => ({ id, status: "queued" }) as GenerationTask,
        announce: (task) => announced.push(task.id),
    };
    return { submissions, announced, dependencies };
}

test("collects every task of one generation into a single entry ordered by batch index", async () => {
    const { submissions, announced, dependencies } = harness([
        { slot: 0, taskId: "task-0", status: "pending" },
        { slot: 1, taskId: "task-1", status: "pending" },
    ]);
    let entryId = "";
    const createTask = createCreationEntryTaskCreator({ sessionId: "session-1", clientOperationId: "op-1", type: "image", prompt: "海报", taskCount: 2, onEntry: (entry) => (entryId = entry.id) }, dependencies);
    const second = createTask(taskInput(1));
    const first = createTask(taskInput(0));
    expect(submissions).toHaveLength(1);
    expect((await first).id).toBe("task-0");
    expect((await second).id).toBe("task-1");
    expect(submissions[0].sessionId).toBe("session-1");
    expect(submissions[0].input.clientOperationId).toBe("op-1");
    expect(submissions[0].input.tasks.map((task) => (task.input?.metadata as { batchIndex: number }).batchIndex)).toEqual([0, 1]);
    expect(announced).toEqual(["task-0", "task-1"]);
    expect(entryId).toBe("entry-1");
});

test("a slot the server could not create rejects only that task", async () => {
    const { dependencies } = harness([
        { slot: 0, taskId: "task-0", status: "pending" },
        { slot: 1, status: "failed", failure: "积分不足" },
    ]);
    const createTask = createCreationEntryTaskCreator({ sessionId: "s", clientOperationId: "op", type: "image", prompt: "p", taskCount: 2 }, dependencies);
    const results = await Promise.allSettled([createTask(taskInput(0)), createTask(taskInput(1))]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason.message).toBe("积分不足");
});

test("a rejected submission fails every waiting task and no more tasks are accepted", async () => {
    const { dependencies } = harness([], new Error("积分不足，请先使用兑换码充值"));
    const createTask = createCreationEntryTaskCreator({ sessionId: "s", clientOperationId: "op", type: "text", prompt: "p", taskCount: 1 }, dependencies);
    await expect(createTask(taskInput())).rejects.toThrow("积分不足");
    await expect(createTask(taskInput())).rejects.toThrow("不能再追加任务");
});
