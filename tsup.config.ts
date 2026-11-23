import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node18",
    treeshake: true,
    outDir: "dist",
  },
  {
    // The `freetheai` command (npx freetheai init).
    entry: { cli: "src/cli/main.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: false,
    clean: false,
    target: "node18",
    outDir: "dist",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
