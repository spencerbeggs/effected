// The control for the bundler half of the cheap-root check: the engine's build entry reaches the bundler, and tsdown,
// which the bundler loads only for a build, is imported from where the bundler resolves it.
import { createRequire } from "node:module";

await import(new URL("../../../engine/dist/prod/npm/pkg/build.js", import.meta.url).href);
const fromBundler = createRequire(new URL("../../../bundler/package.json", import.meta.url));
await import(fromBundler.resolve("tsdown"));
