/**
 * SPA-aware static file server for the Excalidraw built app on port 4242.
 * Serves excalidraw-app/build/. Falls back to index.html for unknown routes.
 * Also proxies bridge API paths (/events /scene /health /elements /clear)
 * to bridge.mjs on port 4243, making the whole app single-origin.
 *
 * Start: node static-server.mjs
 * LaunchAgent: com.d.excalidraw-app
 */

import http    from "node:http";
import fs      from "node:fs";
import path    from "node:path";
import { fileURLToPath } from "node:url";

const PORT        = 4242;
const BRIDGE_PORT = 4243;
const BRIDGE_PATHS = new Set(["/events", "/scene", "/health", "/elements", "/clear"]);
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "excalidraw-app", "build");

const MIME = {
  ".html":  "text/html; charset=utf-8",
  ".js":    "application/javascript",
  ".mjs":   "application/javascript",
  ".css":   "text/css",
  ".json":  "application/json",
  ".png":   "image/png",
  ".svg":   "image/svg+xml",
  ".ico":   "image/x-icon",
  ".woff":  "font/woff",
  ".woff2": "font/woff2",
  ".ttf":   "font/ttf",
  ".wasm":  "application/wasm",
  ".txt":   "text/plain",
};

const INDEX = path.join(DIST, "index.html");

http.createServer((req, res) => {
  const url  = new URL(req.url, "http://localhost");

  // Proxy bridge API — keeps the app single-origin regardless of which host/port it's served from
  if (BRIDGE_PATHS.has(url.pathname)) {
    const proxy = http.request(
      { hostname: "localhost", port: BRIDGE_PORT, path: req.url, method: req.method,
        headers: { ...req.headers, host: `localhost:${BRIDGE_PORT}` } },
      (bridgeRes) => {
        res.writeHead(bridgeRes.statusCode, bridgeRes.headers);
        bridgeRes.pipe(res);
      },
    );
    proxy.on("error", () => { res.writeHead(502); res.end("bridge unavailable"); });
    req.pipe(proxy);
    return;
  }

  const file = path.join(DIST, url.pathname);

  // Prevent path traversal outside dist
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }

  const serve = (filePath, status = 200) => {
    const ext  = path.extname(filePath);
    const mime = MIME[ext] ?? "application/octet-stream";
    // cache static assets aggressively; never cache index.html
    const cc   = ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable";
    res.writeHead(status, { "Content-Type": mime, "Cache-Control": cc });
    fs.createReadStream(filePath).pipe(res);
  };

  fs.stat(file, (err, stat) => {
    if (!err && stat.isFile())           return serve(file);
    if (!err && stat.isDirectory())      return serve(path.join(file, "index.html"));
    // SPA fallback — let the client router handle it
    serve(INDEX);
  });
}).listen(PORT, () => {
  console.log(`[excalidraw-app] serving ${DIST} on http://localhost:${PORT}`);
});
