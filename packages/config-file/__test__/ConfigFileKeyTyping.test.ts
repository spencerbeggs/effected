import { assert, describe, it } from "@effect/vitest";
import { Context, Schema } from "effect";
import type { ConfigFileShape } from "../src/ConfigFile.js";
import { ConfigFile } from "../src/ConfigFile.js";
import { JsonCodec } from "../src/JsonCodec.js";
import { MergeStrategy } from "../src/MergeStrategy.js";

class Settings extends Schema.Class<Settings>("Settings")({ port: Schema.Number }) {}
type SettingsEncoded = typeof Settings.Encoded;
class SettingsFile extends ConfigFile.Service<SettingsFile, Settings>()("key-typing/SettingsFile") {}
// A key over a WIDER shape: the layer could never supply `extra`.
class WiderFile extends Context.Service<WiderFile, ConfigFileShape<Settings> & { readonly extra: string }>()(
	"key-typing/WiderFile",
) {}

const options = { schema: Settings, codec: JsonCodec, strategy: MergeStrategy.firstMatch<Settings>() };

describe("ConfigFile key typing", () => {
	it("layer accepts a ConfigFile.Service key, with or without explicit type arguments", () => {
		const inferred = ConfigFile.layer(SettingsFile, { ...options, resolvers: [] });
		const explicit = ConfigFile.layer<SettingsFile, Settings, SettingsEncoded, never>(SettingsFile, {
			...options,
			resolvers: [],
		});
		assert.isDefined(inferred);
		assert.isDefined(explicit);
	});

	it("layer and testLayer reject a key over a wider shape", () => {
		// @ts-expect-error a wider shape would be handed a value missing `extra`
		const layer = () => ConfigFile.layer(WiderFile, { ...options, resolvers: [] });
		// @ts-expect-error the same pin applies to testLayer
		const testLayer = () => ConfigFile.testLayer(WiderFile, { ...options, files: {} });
		const accepted = () => ConfigFile.testLayer(SettingsFile, { ...options, files: {} });
		for (const build of [layer, testLayer, accepted]) assert.isFunction(build);
	});
});
