/**
 * Excalidraw MCP server — stdio MCP protocol + embedded HTTP bridge on port 3002.
 *
 * Ops are pushed to SSE-connected browsers instantly; the queue catches ops that
 * arrive before the browser connects and flushes them on first SSE connection.
 *
 * Start: node server.mjs   (Claude Code launches this automatically)
 */

import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BRIDGE_PORT = 3002;

// ─── embedded HTTP bridge ─────────────────────────────────────────────────────

const queue = [];        // ops buffered while no SSE client is connected
const sseClients = new Set();  // active browser SSE connections
let scene = [];          // latest element snapshot from the browser

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

// Deliver an op: push directly to connected SSE clients, or queue for later.
function enqueue(op) {
  if (sseClients.size > 0) {
    const frame = `data: ${JSON.stringify(op)}\n\n`;
    for (const client of sseClients) client.write(frame);
  } else {
    queue.push(op);
  }
}

const bridge = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

  // SSE stream — browser subscribes here for real-time ops
  if (req.method === "GET" && req.url === "/events") {
    cors(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    res.write(": connected\n\n");

    // Flush any ops that arrived before the browser was open
    const pending = queue.splice(0);
    for (const op of pending) res.write(`data: ${JSON.stringify(op)}\n\n`);

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

bridge.listen(BRIDGE_PORT, () => {
  console.error(`[excalidraw-mcp] bridge listening on http://localhost:${BRIDGE_PORT}`);
});

// ─── element factories ────────────────────────────────────────────────────────

const rnd  = () => Math.random().toString(36).slice(2, 10);
const seed = () => Math.floor(Math.random() * 2_147_483_647);

function base(o = {}) {
  return {
    id: rnd(), angle: 0,
    strokeColor: "#1e1e1e", backgroundColor: "transparent",
    fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid",
    roughness: 1, opacity: 100, roundness: { type: 3 },
    seed: seed(), version: 1, versionNonce: seed(),
    index: null, isDeleted: false, groupIds: [], frameId: null,
    boundElements: null, updated: Date.now(), link: null, locked: false,
    ...o,
  };
}

const mkRect = ({ x, y, width, height, strokeColor = "#1e1e1e", backgroundColor = "transparent", fillStyle = "solid" }) =>
  base({ type: "rectangle", x, y, width, height, strokeColor, backgroundColor, fillStyle });

const mkEllipse = ({ x, y, width, height, strokeColor = "#1e1e1e", backgroundColor = "transparent" }) =>
  base({ type: "ellipse", x, y, width, height, strokeColor, backgroundColor });

const mkText = ({ x, y, text: t, fontSize = 20, color = "#1e1e1e" }) => {
  const lh = 1.25;
  return base({
    type: "text", x, y,
    width: Math.max(t.length * fontSize * 0.55, 10), height: fontSize * lh,
    strokeColor: color, text: t, originalText: t,
    fontSize, fontFamily: 1, textAlign: "left", verticalAlign: "top",
    containerId: null, autoResize: true, lineHeight: lh,
  });
};

const mkArrow = ({ x1, y1, x2, y2, strokeColor = "#1e1e1e", endArrowhead = "arrow" }) =>
  base({
    type: "arrow", x: x1, y: y1,
    width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
    strokeColor, points: [[0, 0], [x2 - x1, y2 - y1]],
    lastCommittedPoint: null, startBinding: null, endBinding: null,
    startArrowhead: null, endArrowhead, elbowed: false,
  });

// ─── MCP tools ────────────────────────────────────────────────────────────────

const mcp = new McpServer({ name: "excalidraw", version: "0.1.0" });

const push = (elements) => enqueue({ type: "add_elements", elements });
const ok   = (msg) => ({ content: [{ type: "text", text: msg }] });

mcp.tool("draw_rectangle", "Draw a rectangle on the Excalidraw canvas", {
  x: z.number(), y: z.number(),
  width: z.number().positive(), height: z.number().positive(),
  strokeColor: z.string().optional().default("#1e1e1e"),
  backgroundColor: z.string().optional().default("transparent"),
  fillStyle: z.enum(["solid", "hachure", "cross-hatch", "zigzag"]).optional().default("solid"),
}, async (args) => { push([mkRect(args)]); return ok(`rectangle (${args.x},${args.y}) ${args.width}×${args.height}`); });

mcp.tool("draw_ellipse", "Draw an ellipse or circle on the canvas", {
  x: z.number(), y: z.number(),
  width: z.number().positive(), height: z.number().positive(),
  strokeColor: z.string().optional().default("#1e1e1e"),
  backgroundColor: z.string().optional().default("transparent"),
}, async (args) => { push([mkEllipse(args)]); return ok(`ellipse (${args.x},${args.y}) ${args.width}×${args.height}`); });

mcp.tool("draw_text", "Add a text label on the canvas", {
  text: z.string(),
  x: z.number(), y: z.number(),
  fontSize: z.number().positive().optional().default(20),
  color: z.string().optional().default("#1e1e1e"),
}, async (args) => { push([mkText(args)]); return ok(`text "${args.text}" at (${args.x},${args.y})`); });

mcp.tool("draw_arrow", "Draw an arrow between two points", {
  x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(),
  strokeColor: z.string().optional().default("#1e1e1e"),
}, async (args) => { push([mkArrow(args)]); return ok(`arrow (${args.x1},${args.y1})→(${args.x2},${args.y2})`); });

mcp.tool("draw_line", "Draw a straight line between two points (no arrowhead)", {
  x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(),
  strokeColor: z.string().optional().default("#1e1e1e"),
}, async (args) => { push([mkArrow({ ...args, endArrowhead: null })]); return ok(`line (${args.x1},${args.y1})→(${args.x2},${args.y2})`); });

mcp.tool("draw_elements", "Add raw Excalidraw element objects (batched / advanced)", {
  elements: z.array(z.record(z.unknown())),
}, async ({ elements }) => {
  const stamped = elements.map((el) => ({ ...base(), ...el }));
  push(stamped);
  return ok(`added ${stamped.length} element(s)`);
});

mcp.tool("clear_canvas", "Remove all elements from the canvas", {},
  async () => { enqueue({ type: "clear" }); return ok("canvas cleared"); });

mcp.tool("get_scene", "Return the elements currently on the canvas as JSON", {},
  async () => ({ content: [{ type: "text", text: JSON.stringify(scene, null, 2) }] }));

const transport = new StdioServerTransport();
await mcp.connect(transport);
