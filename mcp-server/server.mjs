/**
 * Excalidraw MCP server — stdio only.
 *
 * Delegates all canvas ops to the always-running bridge on port 4243.
 * Claude Code launches this process via stdio when a session starts.
 *
 * Start: node server.mjs   (Claude Code handles this automatically)
 * Bridge must already be running: node bridge.mjs (or via LaunchAgent)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BRIDGE = "http://localhost:4243";

// ─── bridge helpers ───────────────────────────────────────────────────────────

async function post(path, data) {
  await fetch(`${BRIDGE}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  }).catch(() => {}); // bridge not running — silently no-op
}

async function getScene() {
  try {
    const r = await fetch(`${BRIDGE}/scene`);
    return (await r.json()).elements ?? [];
  } catch {
    return [];
  }
}

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

const mcp = new McpServer({ name: "excalidraw", version: "0.2.0" });

const push = (elements) => post("/elements", { elements });
const ok   = (msg) => ({ content: [{ type: "text", text: msg }] });

mcp.tool("draw_rectangle", "Draw a rectangle on the Excalidraw canvas", {
  x: z.number(), y: z.number(),
  width: z.number().positive(), height: z.number().positive(),
  strokeColor: z.string().optional().default("#1e1e1e"),
  backgroundColor: z.string().optional().default("transparent"),
  fillStyle: z.enum(["solid", "hachure", "cross-hatch", "zigzag"]).optional().default("solid"),
}, async (args) => { await push([mkRect(args)]); return ok(`rectangle (${args.x},${args.y}) ${args.width}×${args.height}`); });

mcp.tool("draw_ellipse", "Draw an ellipse or circle on the canvas", {
  x: z.number(), y: z.number(),
  width: z.number().positive(), height: z.number().positive(),
  strokeColor: z.string().optional().default("#1e1e1e"),
  backgroundColor: z.string().optional().default("transparent"),
}, async (args) => { await push([mkEllipse(args)]); return ok(`ellipse (${args.x},${args.y}) ${args.width}×${args.height}`); });

mcp.tool("draw_text", "Add a text label on the canvas", {
  text: z.string(),
  x: z.number(), y: z.number(),
  fontSize: z.number().positive().optional().default(20),
  color: z.string().optional().default("#1e1e1e"),
}, async (args) => { await push([mkText(args)]); return ok(`text "${args.text}" at (${args.x},${args.y})`); });

mcp.tool("draw_arrow", "Draw an arrow between two points", {
  x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(),
  strokeColor: z.string().optional().default("#1e1e1e"),
}, async (args) => { await push([mkArrow(args)]); return ok(`arrow (${args.x1},${args.y1})→(${args.x2},${args.y2})`); });

mcp.tool("draw_line", "Draw a straight line between two points (no arrowhead)", {
  x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(),
  strokeColor: z.string().optional().default("#1e1e1e"),
}, async (args) => { await push([mkArrow({ ...args, endArrowhead: null })]); return ok(`line (${args.x1},${args.y1})→(${args.x2},${args.y2})`); });

mcp.tool("draw_elements", "Add raw Excalidraw element objects (batched / advanced)", {
  elements: z.array(z.record(z.unknown())),
}, async ({ elements }) => {
  const stamped = elements.map((el) => ({ ...base(), ...el }));
  await push(stamped);
  return ok(`added ${stamped.length} element(s)`);
});

mcp.tool("clear_canvas", "Remove all elements from the canvas", {},
  async () => { await post("/clear", {}); return ok("canvas cleared"); });

mcp.tool("get_scene", "Return the elements currently on the canvas as JSON", {},
  async () => ({ content: [{ type: "text", text: JSON.stringify(await getScene(), null, 2) }] }));

const transport = new StdioServerTransport();
await mcp.connect(transport);
