// Run with: node --test yingce-agent/server.test.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const serverPath = join(dirname(fileURLToPath(import.meta.url)), "server.mjs");
const token = "prewarm-test-token-0123456789abcdef";

// Stand-in for agent-runtime.mjs. It leaves marker files next to itself (its cwd is that
// directory and its env has no test settings), writes one stdout and one stderr line before it
// reads stdin, then echoes the request body.
const fakeRuntime = String.raw`
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const startedAt = Date.now();
const dir = dirname(process.argv[1]);
process.on("SIGTERM", () => {
  writeFileSync(join(dir, "sigterm-" + process.pid), "");
  process.exit(143);
});
writeFileSync(join(dir, "spawn-" + process.pid + "-" + startedAt), "");
if (existsSync(join(dir, "crash"))) process.exit(1);
process.stdout.write(JSON.stringify({ event: "boot", pid: process.pid }) + "\n");
process.stderr.write("fake-runtime boot " + process.pid + "\n");
writeFileSync(join(dir, "booted-" + process.pid), "");
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString("utf8");
if (!raw.trim()) {
  // stdin closed without a request (server gone). Leave a moment for a pending SIGTERM to win.
  setTimeout(() => process.exit(2), 200);
} else {
  const body = JSON.parse(raw);
  process.stdout.write(JSON.stringify({ event: "echo", pid: process.pid, startedAt, receivedAt: Date.now(), body }) + "\n");
  if (body.holdMs) await new Promise((resolve) => setTimeout(resolve, body.holdMs));
  if (body.runtimeError) process.stdout.write(JSON.stringify({ event: "runtime_error", message: body.runtimeError }) + "\n");
  if (body.exitCode) process.exitCode = body.exitCode;
  else process.stdout.write(JSON.stringify({ event: "settled", pid: process.pid, settledAt: Date.now() }) + "\n");
}
`;

async function startServer(t, { prewarm, maxSessions = 4, crash = false }) {
  const dir = mkdtempSync(join(tmpdir(), "yingce-agent-prewarm-"));
  const runtimePath = join(dir, "agent-runtime.mjs");
  writeFileSync(runtimePath, fakeRuntime);
  if (crash) writeFileSync(join(dir, "crash"), "");
  const env = {
    ...process.env,
    YINGCE_AGENT_TOKEN: token,
    YINGCE_AGENT_RUNTIME: runtimePath,
    YINGCE_AGENT_PREWARM: String(prewarm),
    MAX_CONCURRENT_SESSIONS: String(maxSessions),
    PORT: "0",
  };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [serverPath], { env, stdio: ["ignore", "pipe", "pipe"] });
  const server = { child, dir, port: 0, stderr: "" };
  server.exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  t.after(() => stopServer(server));
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    server.stderr += chunk;
  });
  server.port = await new Promise((resolve, reject) => {
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const match = /YINGCE_AGENT_READY (\d+)/.exec(stdout);
      if (match) resolve(Number(match[1]));
    });
    child.once("exit", () => reject(new Error(`server exited before it was ready:\n${server.stderr}`)));
  });
  return server;
}

async function stopServer(server) {
  if (server.child.exitCode === null && server.child.signalCode === null) server.child.kill("SIGKILL");
  await server.exited;
  // Idle runtimes read EOF once the server is gone and exit on their own.
  await waitFor(() => runtimes(server.dir).every(({ pid }) => !alive(pid)), "runtimes to exit after the server").catch(() => {});
  try {
    rmSync(server.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Best effort: Windows refuses to delete a directory that is still a process's cwd.
  }
}

function runtimes(dir) {
  return readdirSync(dir)
    .map((name) => /^spawn-(\d+)-(\d+)$/.exec(name))
    .filter(Boolean)
    .map(([, pid, startedAt]) => ({ pid: Number(pid), startedAt: Number(startedAt), booted: existsSync(join(dir, `booted-${pid}`)) }))
    .sort((a, b) => a.startedAt - b.startedAt);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function waitFor(check, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await delay(25);
  }
}

function waitForBooted(server, count) {
  return waitFor(() => {
    const list = runtimes(server.dir);
    return list.length === count && list.every(({ booted }) => booted) && list;
  }, `${count} booted runtimes`);
}

function call(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const headers = { authorization: `Bearer ${token}` };
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    if (payload) Object.assign(headers, { "content-type": "application/json", "content-length": payload.length });
    const request = httpRequest({ host: "127.0.0.1", port, method, path, headers, agent: false }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, type: response.headers["content-type"], text: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    request.on("error", reject);
    if (payload) request.end(payload);
    else request.end();
  });
}

async function health(port) {
  const response = await call(port, "GET", "/healthz");
  assert.equal(response.status, 200);
  return JSON.parse(response.text);
}

async function run(port, body) {
  const response = await call(port, "POST", "/v1/runs", body);
  assert.equal(response.status, 200, response.text);
  assert.equal(response.type, "application/x-ndjson");
  return response.text.trim().split("\n").map((line) => JSON.parse(line));
}

const events = (lines) => lines.map(({ event }) => event);

test("healthz reports warm=2 and a run is served by a runtime started before the request", async (t) => {
  const server = await startServer(t, { prewarm: 2, maxSessions: 4 });
  assert.deepEqual(await health(server.port), { ok: true, active: 0, limit: 4, queued: 0, warm: 2, prewarm: 2 });
  const initial = await waitForBooted(server, 2);
  for (const { pid } of initial) assert.ok(!server.stderr.includes(`fake-runtime boot ${pid}`), "warm stderr stays buffered until assignment");

  await delay(20);
  const requestedAt = Date.now();
  const lines = await run(server.port, { hello: "world", n: 1 });
  assert.deepEqual(events(lines), ["boot", "echo", "settled"], "output written while warm reaches the run");
  const [boot, echo, settled] = lines;
  assert.ok(initial.some(({ pid }) => pid === echo.pid), "served by a prewarmed runtime");
  assert.equal(boot.pid, echo.pid);
  assert.equal(settled.pid, echo.pid);
  assert.ok(echo.startedAt < requestedAt, `runtime started ${echo.startedAt - requestedAt}ms relative to the request`);
  assert.deepEqual(echo.body, { hello: "world", n: 1 });
  await waitFor(() => server.stderr.includes(`fake-runtime boot ${echo.pid}\n`), "stderr of the assigned runtime to be forwarded");
  const remaining = initial.find(({ pid }) => pid !== echo.pid);
  assert.ok(!server.stderr.includes(`fake-runtime boot ${remaining.pid}`), "the other warm runtime is still untouched");

  assert.deepEqual(await health(server.port), { ok: true, active: 0, limit: 4, queued: 0, warm: 2, prewarm: 2 });
  const refilled = await waitForBooted(server, 3);
  assert.ok(refilled.at(-1).startedAt >= requestedAt, "the pool was refilled with a new runtime");

  const second = await run(server.port, { n: 2 });
  assert.equal(second[1].pid, remaining.pid, "the oldest idle runtime is used first");
  assert.deepEqual(events(second), ["boot", "echo", "settled"]);
});

test("exit handling of a prewarmed runtime is unchanged", async (t) => {
  const server = await startServer(t, { prewarm: 2, maxSessions: 4 });
  await waitForBooted(server, 2);

  const failed = await run(server.port, { exitCode: 3 });
  assert.deepEqual(events(failed), ["boot", "echo", "runtime_error"]);
  assert.equal(failed[2].message, "Agent runtime exited with code 3");

  const reported = await run(server.port, { runtimeError: "model failed", exitCode: 1 });
  assert.deepEqual(events(reported), ["boot", "echo", "runtime_error"], "no second error when the runtime reported one");
  assert.equal(reported[2].message, "model failed");

  assert.deepEqual(await health(server.port), { ok: true, active: 0, limit: 4, queued: 0, warm: 2, prewarm: 2 });
});

test("YINGCE_AGENT_PREWARM=0 still serves runs from a cold runtime", async (t) => {
  const server = await startServer(t, { prewarm: 0, maxSessions: 4 });
  assert.deepEqual(await health(server.port), { ok: true, active: 0, limit: 4, queued: 0, warm: 0, prewarm: 0 });
  await delay(300);
  assert.equal(runtimes(server.dir).length, 0, "nothing is spawned before a request");

  const requestedAt = Date.now();
  const lines = await run(server.port, { cold: true });
  assert.deepEqual(events(lines), ["boot", "echo", "settled"]);
  assert.ok(lines[1].startedAt >= requestedAt, "runtime started after the request");
  assert.deepEqual(lines[1].body, { cold: true });

  const failed = await run(server.port, { exitCode: 3 });
  assert.deepEqual(events(failed), ["boot", "echo", "runtime_error"]);
  assert.equal(failed[2].message, "Agent runtime exited with code 3");

  await delay(300);
  assert.equal(runtimes(server.dir).length, 2, "one runtime per run and none in advance");
  assert.deepEqual(await health(server.port), { ok: true, active: 0, limit: 4, queued: 0, warm: 0, prewarm: 0 });
});

// A run above the limit waits for a free slot (it used to be answered with 499 at once, because a
// fully read request is already `destroyed`), with and without prewarming.
test("maxSessions limiting is unchanged by prewarming; warm runtimes do not take slots", async (t) => {
  const outcomes = [];
  for (const prewarm of [0, 2]) {
    const server = await startServer(t, { prewarm, maxSessions: 1 });
    if (prewarm) await waitForBooted(server, prewarm);

    const first = run(server.port, { name: "first", holdMs: 1500 });
    await waitFor(async () => (await health(server.port)).active === 1, "first run to take the only slot");
    const second = call(server.port, "POST", "/v1/runs", { name: "second" });
    await delay(200);
    const during = await health(server.port);
    assert.equal(during.active, 1, "never more than maxSessions runs");
    assert.equal(during.limit, 1);
    assert.equal(during.warm, prewarm, "warm runtimes are not counted as active");

    const firstLines = await first;
    const secondResponse = await second;
    assert.deepEqual(events(firstLines), ["boot", "echo", "settled"]);
    const outcome = { status: secondResponse.status };
    if (secondResponse.status === 200) {
      const secondEcho = secondResponse.text.trim().split("\n").map((line) => JSON.parse(line))[1];
      outcome.startedAfterFirst = secondEcho.receivedAt >= firstLines[2].settledAt;
      assert.ok(outcome.startedAfterFirst, "the run above the limit did not start before a slot was free");
    } else {
      outcome.body = secondResponse.text;
    }
    t.diagnostic(`PREWARM=${prewarm}: run above the limit -> ${JSON.stringify(outcome)}`);
    assert.equal(outcome.status, 200, "the run above the limit is queued, not rejected");
    outcomes.push(outcome);
    assert.deepEqual(await health(server.port), { ok: true, active: 0, limit: 1, queued: 0, warm: prewarm, prewarm });
  }
  assert.deepEqual(outcomes[1], outcomes[0], "same outcome with and without prewarming");
});

// Starts a run and returns a handle to cut the client connection once the runtime has echoed.
function startRun(port, body) {
  const payload = Buffer.from(JSON.stringify(body));
  let request;
  const echoed = new Promise((resolve, reject) => {
    request = httpRequest(
      { host: "127.0.0.1", port, method: "POST", path: "/v1/runs", agent: false, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "content-length": payload.length } },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
          const echo = text
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line))
            .find(({ event }) => event === "echo");
          if (echo) resolve(echo);
        });
        response.on("error", () => {});
      },
    );
    request.on("error", (error) => {
      if (error.code !== "ECONNRESET") reject(error);
    });
    request.end(payload);
  });
  return { echoed, cut: () => request.destroy() };
}

test("a client that disconnects stops its runtime and frees the slot", async (t) => {
  const server = await startServer(t, { prewarm: 2, maxSessions: 1 });
  await waitForBooted(server, 2);
  const running = startRun(server.port, { name: "long", holdMs: 20000 });
  const echo = await running.echoed;
  assert.equal((await health(server.port)).active, 1);
  const cutAt = Date.now();
  running.cut();
  await waitFor(() => !alive(echo.pid), "the runtime of the disconnected client to stop");
  await waitFor(async () => (await health(server.port)).active === 0, "the slot to be released");
  assert.ok(Date.now() - cutAt < 10000, "stopped well before the run would have finished");

  const next = await run(server.port, { after: "disconnect" });
  assert.deepEqual(events(next), ["boot", "echo", "settled"]);
});

test("a queued request whose client disconnects never starts", async (t) => {
  const server = await startServer(t, { prewarm: 0, maxSessions: 1 });
  const first = run(server.port, { name: "first", holdMs: 1500 });
  await waitFor(async () => (await health(server.port)).active === 1, "first run to take the only slot");
  const queued = startRun(server.port, { name: "queued" });
  await waitFor(async () => (await health(server.port)).queued === 1, "second run to wait for a slot");
  queued.cut();
  await waitFor(async () => (await health(server.port)).queued === 0, "the cancelled waiter to leave the queue");
  assert.deepEqual(events(await first), ["boot", "echo", "settled"]);
  await delay(300);
  assert.equal(runtimes(server.dir).length, 1, "the cancelled request did not start a runtime");
  assert.deepEqual(await health(server.port), { ok: true, active: 0, limit: 1, queued: 0, warm: 0, prewarm: 0 });
});

test("a warm runtime that dies before assignment is replaced", async (t) => {
  const server = await startServer(t, { prewarm: 2, maxSessions: 4 });
  const initial = await waitForBooted(server, 2);
  const victim = initial[0].pid;
  process.kill(victim);
  await waitFor(() => !alive(victim), "the killed runtime to exit");

  const refilled = await waitForBooted(server, 3);
  assert.deepEqual(await health(server.port), { ok: true, active: 0, limit: 4, queued: 0, warm: 2, prewarm: 2 });
  await waitFor(() => server.stderr.includes(`fake-runtime boot ${victim}\n`), "stderr of the dead runtime to be drained");

  const lines = await run(server.port, { after: "replacement" });
  assert.notEqual(lines[1].pid, victim);
  assert.ok(refilled.some(({ pid }) => pid === lines[1].pid));
  assert.deepEqual(events(lines), ["boot", "echo", "settled"]);
});

test("warm runtimes that keep dying right after spawn back off and recover", async (t) => {
  const server = await startServer(t, { prewarm: 2, maxSessions: 4, crash: true });
  const backoffLogs = () => server.stderr.split("\n").filter((line) => line.includes("pausing prewarm"));

  await waitFor(() => backoffLogs().length >= 1, "first backoff");
  const firstLoggedAt = Date.now();
  assert.match(backoffLogs()[0], /3 prewarmed runtimes in a row exited within 10s of spawning \(last: code 1\); pausing prewarm for 1s/);
  await waitFor(async () => (await health(server.port)).warm === 0, "pool to drain while paused");

  await waitFor(() => backoffLogs().length >= 2, "second backoff");
  assert.ok(Date.now() - firstLoggedAt >= 900, "the retry waited for the first backoff");
  assert.match(backoffLogs()[1], /pausing prewarm for 2s/, "the delay doubles");
  assert.ok(runtimes(server.dir).length <= 6, `crash loop spawned ${runtimes(server.dir).length} runtimes`);

  unlinkSync(join(server.dir, "crash"));
  await waitFor(async () => {
    const status = await health(server.port);
    return status.warm === 2 && runtimes(server.dir).filter(({ booted }) => booted).length === 2;
  }, "pool to recover after the backoff");
  assert.equal(backoffLogs().length, 2, "one log line per backoff");

  const lines = await run(server.port, { recovered: true });
  assert.deepEqual(events(lines), ["boot", "echo", "settled"]);
});

test("SIGTERM stops idle warm runtimes and the server still exits by the signal", { skip: process.platform === "win32" && "POSIX signals cannot be delivered on Windows" }, async (t) => {
  const server = await startServer(t, { prewarm: 2, maxSessions: 4 });
  const warm = await waitForBooted(server, 2);
  server.child.kill("SIGTERM");
  assert.deepEqual(await server.exited, { code: null, signal: "SIGTERM" });
  await waitFor(() => warm.every(({ pid }) => existsSync(join(server.dir, `sigterm-${pid}`))), "warm runtimes to receive SIGTERM");
});
