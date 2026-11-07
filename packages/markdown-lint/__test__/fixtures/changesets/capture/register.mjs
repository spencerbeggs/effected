import { register } from "node:module";

globalThis.__records = [];
register("./hooks.mjs", import.meta.url);
