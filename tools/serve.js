import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "./static_server.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2]) || 5500;
const { port: actualPort } = await startStaticServer(repoRoot, port);
console.log(`Quiz preview: http://localhost:${actualPort}/index.html`);
console.log(`Pick a dataset: http://localhost:${actualPort}/index.html?dataset=asset/data/quizzes/guess-the-animal/guess-the-animal-001.json`);
