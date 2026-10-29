import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { dirname } from "node:path";

const token = process.env.YINGCE_AGENT_TOKEN || "";
let maxSessions = positiveInt(process.env.MAX_CONCURRENT_SESSIONS, 30, 64);
const memoryMB = positiveInt(process.env.NODE_MAX_OLD_SPACE_SIZE, 512, 8192);
const runtimePath = process.env.YINGCE_AGENT_RUNTIME || "/app/agent-runtime/agent-runtime.mjs";
const port = Number(process.env.PORT || 8081);
const bodyLimit = 32 * 1024 * 1024;
const prewarm = prewarmCount(process.env.YINGCE_AGENT_PREWARM);
// 预热进程在启动后 10 秒内退出算作启动失败；连续 3 次就暂停补充，间隔从 1 秒倍增到 60 秒。
const warmEarlyExitMs = 10_000;
const warmCrashLimit = 3;
const warmBackoffBaseMs = 1_000;
const warmBackoffMaxMs = 60_000;
const warmIdleMs = 30 * 60_000;

if (token.length < 32) {
  console.error("YINGCE_AGENT_TOKEN must contain at least 32 characters");
  process.exit(1);
}

let active = 0;
const waiters = [];
// 空闲的预热进程，按启动先后排列。它们不计入 active，也不占 maxSessions 名额。
const warmPool = [];
let warmEarlyExits = 0;
let warmLastFailure = "";
let warmBackoffMs = 0;
let warmBackoffTimer = null;
let shuttingDown = false;

function positiveInt(raw, fallback, max) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function prewarmCount(raw) {
  if (raw === undefined || String(raw).trim() === "") return 2;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return 2;
  return Math.min(parsed, 4);
}

function spawnRuntime() {
  return spawn(process.execPath, [`--max-old-space-size=${memoryMB}`, runtimePath], {
    cwd: dirname(runtimePath),
    env: {
      PATH: process.env.PATH || "",
      NODE_ENV: "production",
      PI_OFFLINE: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// 预热进程加载完依赖后阻塞在 stdin 上。分配前不读取它的 stdout/stderr：流保持暂停，
// 输出留在缓冲区里，分配后由对话挂上的监听器从头读到，与现启动的进程一致。
function startWarmRuntime() {
  let child;
  try {
    child = spawnRuntime();
  } catch (error) {
    noteWarmFailure(0, error instanceof Error ? error.message : String(error));
    return;
  }
  const entry = { child, startedAt: performance.now(), retired: false, dropped: false };
  entry.onExit = (code, signal) => dropWarmRuntime(entry, code === null ? `signal ${signal}` : `code ${code}`);
  entry.onError = (error) => dropWarmRuntime(entry, error.message);
  // 活过 10 秒说明运行时能正常启动，清零连续失败次数和退避间隔。
  entry.stableTimer = setTimeout(resetWarmFailures, warmEarlyExitMs);
  entry.stableTimer.unref();
  entry.idleTimer = setTimeout(() => recycleWarmRuntime(entry), warmIdleMs);
  entry.idleTimer.unref();
  child.once("exit", entry.onExit);
  child.on("error", entry.onError);
  warmPool.push(entry);
}

function replenishWarmRuntimes() {
  // 同步启动失败会累计次数并在第 3 次进入退避，循环因此一定结束。
  while (!shuttingDown && !warmBackoffTimer && warmPool.length < prewarm) startWarmRuntime();
}

function takeWarmRuntime() {
  while (warmPool.length > 0) {
    const entry = warmPool.shift();
    const { child } = entry;
    if (child.exitCode === null && child.signalCode === null && !child.killed && child.stdin?.writable) {
      clearWarmTimers(entry);
      child.off("exit", entry.onExit);
      child.off("error", entry.onError);
      resetWarmFailures();
      return child;
    }
    retireWarmRuntime(entry);
  }
  return null;
}

function clearWarmTimers(entry) {
  clearTimeout(entry.stableTimer);
  clearTimeout(entry.idleTimer);
}

function removeWarmEntry(entry) {
  const index = warmPool.indexOf(entry);
  if (index >= 0) warmPool.splice(index, 1);
}

function retireWarmRuntime(entry) {
  entry.retired = true;
  clearWarmTimers(entry);
  removeWarmEntry(entry);
  if (entry.child.exitCode === null && entry.child.signalCode === null) entry.child.kill("SIGTERM");
}

function recycleWarmRuntime(entry) {
  if (!warmPool.includes(entry)) return;
  retireWarmRuntime(entry);
  replenishWarmRuntimes();
}

// 分配前退出或出错的预热进程：移出池子并补一个新的。
function dropWarmRuntime(entry, reason) {
  if (entry.dropped) return;
  entry.dropped = true;
  clearWarmTimers(entry);
  removeWarmEntry(entry);
  const { child } = entry;
  // 不会再有对话读取它：关闭 stdin 让仍在运行的进程读到 EOF 退出，丢弃 stdout，stderr 照常转出便于排查。
  child.stdin?.destroy();
  child.stdout?.resume();
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  if (entry.retired || shuttingDown) return;
  noteWarmFailure(performance.now() - entry.startedAt, reason);
  replenishWarmRuntimes();
}

function noteWarmFailure(livedMs, reason) {
  if (livedMs >= warmEarlyExitMs) return;
  warmLastFailure = reason;
  warmEarlyExits += 1;
  if (warmEarlyExits >= warmCrashLimit) pauseWarmRuntimes();
}

function resetWarmFailures() {
  warmEarlyExits = 0;
  warmBackoffMs = 0;
}

function pauseWarmRuntimes() {
  if (warmBackoffTimer) return;
  warmBackoffMs = Math.min(warmBackoffMs ? warmBackoffMs * 2 : warmBackoffBaseMs, warmBackoffMaxMs);
  console.error(`yingce-agent: ${warmEarlyExits} prewarmed runtimes in a row exited within ${warmEarlyExitMs / 1000}s of spawning (last: ${warmLastFailure}); pausing prewarm for ${warmBackoffMs / 1000}s`);
  warmBackoffTimer = setTimeout(() => {
    warmBackoffTimer = null;
    replenishWarmRuntimes();
  }, warmBackoffMs);
  warmBackoffTimer.unref();
}

function stopWarmRuntimes(signal) {
  shuttingDown = true;
  clearTimeout(warmBackoffTimer);
  warmBackoffTimer = null;
  for (const entry of [...warmPool]) retireWarmRuntime(entry);
  // 去掉监听后重发同一信号，交回 Node 默认处理：停止流程与未开启预热时相同。
  process.off("SIGTERM", stopWarmRuntimes);
  process.off("SIGINT", stopWarmRuntimes);
  process.kill(process.pid, signal);
}

function authorized(request) {
  const actual = Buffer.from(request.headers.authorization || "");
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// 客户端是否已断开。请求体读完后 Node 会自动销毁 request，request.destroyed / "aborted" 都不能
// 再表示断开，只能看底层连接和 response 的 close。
function clientGone(request, response) {
  return Boolean(request.socket?.destroyed) || (response.destroyed && !response.writableFinished);
}

function acquire(request, response) {
  if (active < maxSessions) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = waiters.indexOf(waiter);
      if (index < 0) return;
      waiters.splice(index, 1);
      reject(new Error("Agent request cancelled while queued"));
    };
    const waiter = {
      resolve: () => {
        response.off("close", abort);
        resolve();
      },
      reject,
    };
    waiters.push(waiter);
    if (clientGone(request, response)) abort();
    else response.once("close", abort);
  });
}

function admitWaiters() {
  while (waiters.length > 0 && active < maxSessions) {
    active += 1;
    waiters.shift().resolve();
  }
}

function release() {
  if (waiters.length > 0 && active <= maxSessions) {
    waiters.shift().resolve();
    admitWaiters();
    return;
  }
  active = Math.max(0, active - 1);
  admitWaiters();
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > bodyLimit) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function writeRuntimeError(response, message) {
  if (!response.headersSent) {
    response.writeHead(200, { "content-type": "application/x-ndjson" });
  }
  response.end(`${JSON.stringify({ event: "runtime_error", message })}\n`);
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, active, limit: maxSessions, queued: waiters.length, warm: warmPool.length, prewarm }));
    return;
  }
  if (request.method === "PUT" && request.url === "/v1/limit") {
    if (!authorized(request)) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    try {
      const body = JSON.parse((await readBody(request)).toString("utf8"));
      const next = positiveInt(body.maxSessions, 0, 64);
      if (!next) throw new Error("maxSessions must be an integer from 1 to 64");
      maxSessions = next;
      admitWaiters();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, active, limit: maxSessions, queued: waiters.length }));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "invalid limit" }));
    }
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/runs") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
    return;
  }
  if (!authorized(request)) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  let body;
  try {
    body = await readBody(request);
    JSON.parse(body.toString("utf8"));
  } catch (error) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "invalid request" }));
    return;
  }
  try {
    await acquire(request, response);
  } catch (error) {
    response.writeHead(499, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "cancelled" }));
    return;
  }

  // 拿到名额时客户端已断开：不再启动这一轮，直接归还名额。
  if (clientGone(request, response)) {
    release();
    return;
  }
  const child = takeWarmRuntime() || spawnRuntime();
  let released = false;
  const finish = () => {
    if (released) return;
    released = true;
    release();
  };
  let sawRuntimeError = false;
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  };
  // 后端取消或断线时结束子进程；正常结束（response 已写完）后的 close 不算断开。
  response.on("close", () => {
    if (!response.writableFinished) stop();
  });
  response.writeHead(200, { "content-type": "application/x-ndjson" });
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    if (text.includes('"runtime_error"') || text.includes('"bridge_error"')) sawRuntimeError = true;
    response.write(chunk);
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("error", (error) => {
    writeRuntimeError(response, error.message);
    finish();
  });
  child.on("close", (code) => {
    if (!response.writableEnded) {
      if (code && !sawRuntimeError) {
        response.write(`${JSON.stringify({ event: "runtime_error", message: `Agent runtime exited with code ${code}` })}\n`);
      }
      response.end();
    }
    finish();
  });
  child.stdin.end(body);
  replenishWarmRuntimes();
});

if (prewarm > 0) {
  process.on("SIGTERM", stopWarmRuntimes);
  process.on("SIGINT", stopWarmRuntimes);
}

server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;
server.listen(port, "0.0.0.0", () => {
  const address = server.address();
  replenishWarmRuntimes();
  console.log(`YINGCE_AGENT_READY ${address.port}`);
});
