import { rm } from "node:fs/promises";

await rm("main.js", { force: true });
