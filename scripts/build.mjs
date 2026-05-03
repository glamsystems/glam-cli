import { chmod, readFile, rm } from "node:fs/promises";
import { build } from "esbuild";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const optionalPackages = Object.keys(packageJson.optionalDependencies ?? {});
const external = optionalPackages.flatMap((name) => [name, `${name}/*`]);

await rm("main.js", { force: true });

await build({
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2020",
  banner: {
    js: "#!/usr/bin/env node",
  },
  external,
  sourcemap: false,
  minify: true,
  logLevel: "info",
});

await chmod("main.js", 0o755);
