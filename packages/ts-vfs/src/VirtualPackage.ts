import type { PlatformError } from "effect";
import { Effect, FileSystem, Schema } from "effect";
import type { Vfs } from "./Vfs.js";

/**
 * A synthetic npm package built from locally supplied TypeScript declaration
 * content, for inclusion in a {@link Vfs} without fetching from the CDN.
 *
 * @remarks
 * Useful when you have locally generated `.d.ts` files — API Extractor
 * output, hand-written ambient declarations — and want them in the same VFS
 * `TypeRegistry` builds from remote packages. Instances are transient: they
 * are never persisted to the disk cache.
 *
 * The class is deliberately subclass-friendly (the rspress consumer extends
 * it): construct via `VirtualPackage.make(...)` or the statics, and extend
 * with `class Mine extends VirtualPackage { ... }`.
 *
 * @example
 * ```ts
 * import { VirtualPackage } from "@effected/ts-vfs";
 *
 * const pkg = VirtualPackage.create("@my-org/api-types", "1.0.0", "export interface User { id: string }");
 * const vfs = pkg.toVfs();
 * // node_modules/@my-org/api-types/package.json, node_modules/@my-org/api-types/index.d.ts
 * ```
 *
 * @public
 */
export class VirtualPackage extends Schema.Class<VirtualPackage>("VirtualPackage")({
	/** The package name (e.g. `"@my-org/api-types"`). */
	name: Schema.String,
	/** The package version. */
	version: Schema.String,
	/** Entry file names (e.g. `"index.d.ts"`) mapped to declaration source. */
	entries: Schema.ReadonlyMap(Schema.String, Schema.String),
}) {
	/**
	 * Single-entry factory: a virtual package whose sole entry point is
	 * `index.d.ts`.
	 */
	static create(name: string, version: string, declarations: string): VirtualPackage {
		return VirtualPackage.make({ name, version, entries: new Map([["index.d.ts", declarations]]) });
	}

	/**
	 * Multi-entry factory: one `.d.ts` per entry point, exposed through a
	 * synthetic `exports` map.
	 *
	 * @remarks
	 * An empty entries map is developer wiring, not input — it would produce a
	 * package whose `types` points at a file that does not exist — so it
	 * throws at construction (defect posture), as does an entry set whose
	 * names collide after extension normalization (see
	 * {@link VirtualPackage.toVfs}).
	 */
	static createMultiEntry(name: string, version: string, entries: ReadonlyMap<string, string>): VirtualPackage {
		if (entries.size === 0) {
			throw new Error(`VirtualPackage.createMultiEntry: "${name}" needs at least one entry file`);
		}
		return VirtualPackage.make({ name, version, entries });
	}

	/**
	 * Load a single `.d.ts` file from disk as a virtual package with one
	 * `index.d.ts` entry.
	 *
	 * @remarks
	 * Reads through the platform-agnostic `FileSystem` service; the
	 * `PlatformError` surfaces typed.
	 */
	static fromFile(
		name: string,
		version: string,
		filePath: string,
	): Effect.Effect<VirtualPackage, PlatformError.PlatformError, FileSystem.FileSystem> {
		return Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const content = yield* fs.readFileString(filePath);
			return VirtualPackage.create(name, version, content);
		}).pipe(Effect.withSpan("VirtualPackage.fromFile"));
	}

	/**
	 * The package's {@link Vfs}: a synthetic `package.json` plus every entry
	 * file, each path prefixed `node_modules/<name>/`.
	 *
	 * @remarks
	 * The `package.json` uses `types` for a single entry and an `exports` map
	 * for multiple entries, so TypeScript module resolution works against the
	 * generated VFS.
	 */
	toVfs(): Vfs {
		const vfs: Vfs = new Map();
		const prefix = `node_modules/${this.name}`;
		vfs.set(`${prefix}/package.json`, this.toPackageJson());
		for (const [fileName, content] of this.entries) {
			vfs.set(`${prefix}/${fileName}`, content);
		}
		return vfs;
	}

	private toPackageJson(): string {
		// Both throws below are wiring defects, checked here so every
		// construction path (factories, `make`, subclass constructors) hits
		// them the moment a Vfs is produced.
		if (this.entries.size === 0) {
			throw new Error(`VirtualPackage: "${this.name}" has no entry files — nothing to point types at`);
		}
		const manifest: {
			name: string;
			version: string;
			types?: string;
			exports?: Record<string, { types: string }>;
		} = { name: this.name, version: this.version };

		if (this.entries.size === 1) {
			const [only] = this.entries.keys();
			manifest.types = only ?? "index.d.ts";
		} else {
			manifest.exports = {};
			const sources = new Map<string, string>();
			for (const fileName of this.entries.keys()) {
				const baseName = fileName.replace(/\.d\.(m|c)?ts$/, "");
				const key = baseName === "index" ? "." : `./${baseName}`;
				const previous = sources.get(key);
				if (previous !== undefined) {
					throw new Error(
						`VirtualPackage: "${this.name}" entries "${previous}" and "${fileName}" both normalize to the export key "${key}"`,
					);
				}
				sources.set(key, fileName);
				manifest.exports[key] = { types: `./${fileName}` };
			}
		}
		return JSON.stringify(manifest, null, 2);
	}
}
