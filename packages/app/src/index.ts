/**
 * The application control plane for Effect: `App.layer` wires XDG-namespaced
 * directories, a migrated SQLite state database and a TTL cache to one
 * namespace, `AppStore` and `AppCache` provide either database alone, and
 * `AppConfig.layer` adds an XDG-discovered config file. A composition over
 * `@effected/xdg`, `@effected/store` and `@effected/config-file`.
 *
 * @packageDocumentation
 */

export type { AppError, AppOptions, AppTestOptions } from "./App.js";
export { App } from "./App.js";
export type { AppCacheOptions } from "./AppCache.js";
export { AppCache } from "./AppCache.js";
export type { AppConfigOptions } from "./AppConfig.js";
export { AppConfig } from "./AppConfig.js";
export type { AppStoreOptions } from "./AppStore.js";
export { AppStore } from "./AppStore.js";
