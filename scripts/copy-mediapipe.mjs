// Copies MediaPipe's audio WebAssembly runtime into public/, so the meow detector is served by
// this app instead of a third-party CDN. Runs automatically before `npm run dev` and `npm run build`.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("public/mediapipe", { recursive: true });
cpSync("node_modules/@mediapipe/tasks-audio/wasm", "public/mediapipe", { recursive: true });
