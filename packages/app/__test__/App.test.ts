import { assert, describe, layer } from "@effect/vitest";
import type { StoreMigration } from "@effected/store";
import { Cache, Store } from "@effected/store";
import { AppDirs, Xdg, XdgPaths } from "@effected/xdg";
import { Effect, Option } from "effect";
import { App } from "../src/index.js";

const migrations: ReadonlyArray<StoreMigration> = [
	{ id: 1, name: "create-notes", up: (sql) => sql`CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT)` },
];

describe("App.layerTest", () => {
	// The whole point: this fixture typechecks with R = never. If it ever needs
	// a NodeFileSystem import, the layer has stopped doing its job.
	layer(App.layerTest({ namespace: "myapp", store: { migrations } }))((it) => {
		it.effect("provides a working Store with zero platform layers", () =>
			Effect.gen(function* () {
				const store = yield* Store;
				yield* store.client`INSERT INTO notes (id, body) VALUES ('a', 'hello')`;
				const rows = yield* store.client<{ body: string }>`SELECT body FROM notes WHERE id = 'a'`;
				assert.strictEqual(rows[0]?.body, "hello");
			}),
		);

		it.effect("provides a working Cache with zero platform layers", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				yield* cache.set({ key: "greeting", value: new TextEncoder().encode("hi") });
				const entry = yield* cache.get("greeting");
				assert.isTrue(Option.isSome(entry));
				assert.strictEqual(new TextDecoder().decode(Option.getOrThrow(entry).value), "hi");
			}),
		);

		it.effect("resolves AppDirs against the synthetic default paths", () =>
			Effect.gen(function* () {
				const appDirs = yield* AppDirs;
				assert.strictEqual(appDirs.namespace, "myapp");
				assert.strictEqual(appDirs.dirs.state, "/home/test/.local/state/myapp");
				assert.strictEqual(appDirs.dirs.cache, "/home/test/.cache/myapp");
				assert.strictEqual(appDirs.dirs.config, "/home/test/.config/myapp");
				const paths = yield* Xdg;
				assert.strictEqual(paths.home, "/home/test");
			}),
		);
	});

	const pinned = XdgPaths.make({
		home: "/pinned",
		stateHome: "/pinned/state",
		configDirs: ["/etc/xdg"],
		dataDirs: ["/usr/share"],
	});

	layer(App.layerTest({ namespace: "other", paths: pinned }))((it) => {
		it.effect("pins real XDG paths when given, and store defaults to no migrations", () =>
			Effect.gen(function* () {
				const appDirs = yield* AppDirs;
				assert.strictEqual(appDirs.dirs.state, "/pinned/state/other");
				// No stateHome ladder below the pinned set: config falls back to $HOME/.<ns>.
				assert.strictEqual(appDirs.dirs.config, "/pinned/.other");
				const store = yield* Store;
				const status = yield* store.status;
				assert.deepStrictEqual(status, []);
			}),
		);
	});
});
