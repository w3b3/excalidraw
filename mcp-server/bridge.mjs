/**
 * HTTP bridge between the MCP server and the Excalidraw browser app.
 *
 * MCP server  →  POST /elements or POST /clear  →  bridge queue
 * Browser app →  GET  /poll                     →  drains queue + applies ops
 * Browser app →  POST /scene                    →  stores current element snapshot
 * MCP server  →  GET  /scene                    →  reads snapshot
 */

import http from "node:http";

const queue = [];   // pending operations for the browser to apply
let scene = [];     // latest snapshot from the browser

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, data) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Browser drains the queue
  if (req.method === "GET" && req.url === "/poll") {
    const ops = queue.splice(0);
    return json(res, 200, ops);
  }

  // MCP pushes new elements
  if (req.method === "POST" && req.url === "/elements") {
    const body = await readBody(req);
    queue.push({ type: "add_elements", elements: body.elements });
    return json(res, 200, { ok: true, queued: body.elements.length });
  }

  // MCP clears the canvas
  if (req.method === "POST" && req.url === "/clear") {
    queue.push({ type: "clear" });
    return json(res, 200, { ok: true });
  }

  // Browser reports current scene state
  if (req.method === "POST" && req.url === "/scene") {
    const body = await readBody(req);
    scene = body.elements ?? [];
    return json(res, 200, { ok: true });
  }

  // MCP reads current scene state
  if (req.method === "GET" && req.url === "/scene") {
    return json(res, 200, { elements: scene });
  }

  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true, queued: queue.length });
  }

  cors(res);
  res.writeHead(404);
  res.end("Not found");
});

const PORT = 3002;
server.listen(PORT, () => {
  console.error(`Excalidraw bridge running on http://localhost:${PORT}`);
});
