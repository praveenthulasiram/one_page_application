import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg"
};

// Minimal static file server for the quiz page; port 0 picks a free port.
export const startStaticServer = (root, port = 0) =>
  new Promise((resolve, reject) => {
    const rootDir = path.resolve(root);
    const server = createServer(async (request, response) => {
      const urlPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const filePath = path.resolve(rootDir, `.${urlPath === "/" ? "/index.html" : urlPath}`);
      if (!filePath.startsWith(rootDir + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      try {
        const info = await stat(filePath);
        if (!info.isFile()) {
          throw new Error("not a file");
        }
        response.writeHead(200, {
          "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
          "Content-Length": info.size,
          "Cache-Control": "no-store"
        });
        createReadStream(filePath).pipe(response);
      } catch {
        response.writeHead(404).end("Not found");
      }
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
