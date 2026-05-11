/**
 * Excalidraw HTTP bridge — standalone always-on service on port 4243.
 *
 * The browser connects via SSE (/events) to receive draw ops in real time.
 * The MCP stdio server (server.mjs) POSTs ops here.
 *
 * Start: node bridge.mjs
 * LaunchAgent: com.d.excalidraw-bridge
 */

import http from "node:http";

const PORT = 4243;

const queue      = [];
const sseClients = new Set();
let   scene      = [];

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function jsonReply(res, status, data) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function enqueue(op) {
  if (sseClients.size > 0) {
    const frame = `data: ${JSON.stringify(op)}\n\n`;
    for (const client of sseClients) client.write(frame);
  } else {
    queue.push(op);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && req.url === "/events") {
    cors(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    });
    res.write(": connected\n\n");
    for (const op of queue.splice(0)) res.write(`data: ${JSON.stringify(op)}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (req.method === "GET"  && req.url === "/scene")  return jsonReply(res, 200, { elements: scene });
  if (req.method === "GET"  && req.url === "/health") return jsonReply(res, 200, { ok: true, sseClients: sseClients.size, queued: queue.length });

  if (req.method === "POST" && req.url === "/elements") {
    const body = await readBody(req);
    enqueue({ type: "add_elements", elements: body.elements });
    return jsonReply(res, 200, { ok: true });
  }
  if (req.method === "POST" && req.url === "/clear") {
    enqueue({ type: "clear" });
    return jsonReply(res, 200, { ok: true });
  }
  if (req.method === "POST" && req.url === "/scene") {
    const body = await readBody(req);
    scene = body.elements ?? [];
    return jsonReply(res, 200, { ok: true });
  }

  cors(res); res.writeHead(404); res.end("not found");
});

server.listen(PORT, () => {
  console.log(`[excalidraw-bridge] listening on http://localhost:${PORT}`);
});
