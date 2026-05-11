/**
 * SPA-aware static file server for the Excalidraw built app on port 4242.
 * Serves excalidraw-app/dist/. Falls back to index.html for unknown routes.
 *
 * Start: node static-server.mjs
 * LaunchAgent: com.d.excalidraw-app
 */

import http    from "node:http";
import fs      from "node:fs";
import path    from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 4242;
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
