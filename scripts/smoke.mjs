import { spawn, spawnSync } from "node:child_process";

const appUrl = process.env.APP_URL || "http://127.0.0.1:5187/";
const logHealthUrl = process.env.LOG_HEALTH_URL || "http://127.0.0.1:5188/health";
const logEventsUrl = process.env.LOG_EVENTS_URL || "http://127.0.0.1:5188/events";
const children = [];

try {
  const appAlreadyRunning = await isOk(appUrl);
  const logsAlreadyRunning = await isOk(logHealthUrl);

  if (appAlreadyRunning || logsAlreadyRunning) {
    if (!appAlreadyRunning || !logsAlreadyRunning) {
      throw new Error("Partial server state: app and log server must both be running or both be free.");
    }
  } else {
    startServers();
  }

  await waitForOk(appUrl, "app");
  await waitForOk(logHealthUrl, "log server");

  const html = await fetchText(appUrl);
  assertIncludes(html, "particle-canvas", "app shell should include the particle canvas");
  assertIncludes(html, "/src/main.ts", "app shell should load the TypeScript entrypoint");

  await postJson(logEventsUrl, {
    event: "smoke.probe",
    payload: { source: "scripts/smoke.mjs" },
    at: new Date().toISOString(),
  });

  const eventPayload = await fetchJson(logEventsUrl);
  const hasSmokeProbe = Array.isArray(eventPayload.events)
    && eventPayload.events.some((entry) => entry.event === "smoke.probe");

  if (!hasSmokeProbe) {
    throw new Error("Diagnostics smoke failed: probe event was not retained.");
  }

  console.log(`[webgpu-particle-lab:smoke] app OK at ${appUrl}`);
  console.log(`[webgpu-particle-lab:smoke] logs OK at ${logHealthUrl}`);
} finally {
  shutdown();
}

function startServers() {
  const npmRunner = resolveNpmRunner();
  start("logs", process.execPath, ["scripts/log-server.mjs"]);
  start("vite", npmRunner.command, [...npmRunner.args, "run", "dev:vite"]);
}

function start(label, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  children.push(child);
  child.stdout.on("data", (chunk) => write(label, chunk));
  child.stderr.on("data", (chunk) => write(label, chunk));
}

function write(label, chunk) {
  const lines = chunk.toString().split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    console.log(`[webgpu-particle-lab:${label}] ${line}`);
  }
}

function shutdown() {
  for (const child of children) {
    if (child.pid) {
      killProcessTree(child.pid);
    }
  }
}

function killProcessTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
    });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // The process may already be gone during shutdown.
  }
}

async function waitForOk(url, label) {
  const deadline = Date.now() + 15000;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }

      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for ${label} at ${url}: ${lastError}`);
}

async function isOk(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchText(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`POST failed for ${url}: ${response.status} ${response.statusText}`);
  }
}

function assertIncludes(text, expected, reason) {
  if (!text.includes(expected)) {
    throw new Error(`${reason}. Missing: ${expected}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveNpmRunner() {
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath?.endsWith(".js")) {
    return {
      command: process.execPath,
      args: [npmExecPath],
    };
  }

  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd"],
    };
  }

  return {
    command: "npm",
    args: [],
  };
}
