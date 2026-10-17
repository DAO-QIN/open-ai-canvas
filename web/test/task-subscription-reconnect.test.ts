import { expect, test } from "bun:test";
import { createGenerationTaskSubscriptionService, type GenerationTask } from "../src/services/api/task-center";

const task: GenerationTask = { id: "cat-test", type: "canvas_image", status: "running", prompt: "cat", attempts: 1, createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z" };
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

test("an existing subscriber reconnects after the first status request fails", async () => {
    let queries = 0;
    const states: string[] = [];
    const service = createGenerationTaskSubscriptionService({
        reconnectDelayMs: 1,
        async queryTask() {
            if (++queries === 1) throw new Error("network unavailable");
            return { ...task, status: "succeeded" };
        },
        async waitTask() {
            throw new Error("terminal task must not wait");
        },
    });
    const stop = service.subscribe([task.id], (value) => states.push(value.status));
    try {
        await tick(30);
        expect(queries).toBe(2);
        expect(states).toEqual(["succeeded"]);
    } finally {
        stop();
    }
});

test("interrupted waiting resumes and publishes the terminal failure without remounting", async () => {
    let queries = 0;
    let waits = 0;
    const states: string[] = [];
    const service = createGenerationTaskSubscriptionService({
        reconnectDelayMs: 1,
        async queryTask() {
            return ++queries === 1 ? task : { ...task, status: "failed", error: "upstream failed" };
        },
        async waitTask() {
            waits++;
            throw new Error("connection reset");
        },
    });
    const stop = service.subscribe([task.id], (value) => states.push(value.status));
    try {
        await tick(30);
        expect(queries).toBe(2);
        expect(waits).toBe(1);
        expect(states).toEqual(["running", "failed"]);
    } finally {
        stop();
    }
});

test("unsubscribing clears a pending reconnect", async () => {
    let queries = 0;
    const service = createGenerationTaskSubscriptionService({
        reconnectDelayMs: 20,
        async queryTask() {
            queries++;
            throw new Error("offline");
        },
        async waitTask() {
            return task;
        },
    });
    const stop = service.subscribe([task.id], () => undefined);
    await tick();
    stop();
    await tick(40);
    expect(queries).toBe(1);
});
