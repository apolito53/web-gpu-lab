import { createServer } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const port = Number(process.env.LOG_PORT || 5188);
const host = process.env.LOG_HOST || "127.0.0.1";
const maxEvents = Number(process.env.LOG_BUFFER_SIZE || 400);
const recentEvents = [];
const logDirectory = join(process.cwd(), "logs");
const logFile = join(logDirectory, "events.ndjson");

await mkdir(logDirectory, { recursive: true });

const server = createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    writeJson(response, 200, {
      ok: true,
      service: "webgpu-particle-lab-log-server",
      retainedEvents: recentEvents.length,
    });
    return;
  }

  if (request.method === "GET" && request.url === "/events") {
    writeJson(response, 200, {
      events: recentEvents,
    });
    return;
  }

  if (request.method === "POST" && request.url === "/events") {
    try {
      const body = await readBody(request);
      const parsed = JSON.parse(body);
      const entry = {
        receivedAt: new Date().toISOString(),
        ...parsed,
      };

      recentEvents.push(entry);

      while (recentEvents.length > maxEvents) {
        recentEvents.shift();
      }

      await appendFile(logFile, `${JSON.stringify(entry)}\n`, "utf8");
      writeJson(response, 202, { ok: true });
    } catch (error) {
      writeJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return;
  }

  writeJson(response, 404, { ok: false, error: "Not found" });
});

server.listen(port, host, () => {
  console.log(`[webgpu-particle-lab:logs] listening at http://${host}:${port}`);
  console.log(`[webgpu-particle-lab:logs] retaining ${maxEvents} events; writing ${logFile}`);
});

function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "http://127.0.0.1:5187");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

