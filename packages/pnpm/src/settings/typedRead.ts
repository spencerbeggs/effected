import type { PnpmSettings } from "@effected/pnpm";
import { PnpmSettingsError } from "@effected/pnpm";
import { Option, Result, Schema } from "effect";
import type { PnpmSettingLocation } from "./PnpmSetting.js";
import type { PnpmSettingName, PnpmSettingType } from "./PnpmSettingsCatalog.js";
import { PnpmSettingsCatalog } from "./PnpmSettingsCatalog.js";

/** An environment value: the text as a value first, then as the JSON document pnpm 12 also accepts. */
const fromText = (schema: Schema.Codec<unknown, unknown>, text: string): Option.Option<unknown> => {
	const direct = Schema.decodeUnknownResult(schema)(text);
	if (Result.isSuccess(direct)) return Option.some(direct.success);
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return Option.none();
	}
	return Option.getSuccess(Schema.decodeUnknownResult(schema)(json));
};

const own = (layer: Readonly<Record<string, unknown>>, name: string): unknown =>
	Object.hasOwn(layer, name) ? layer[name] : undefined;

/**
 * One setting from `settings`, decoded through its {@link PnpmSettingsCatalog}
 * entry: the highest source pnpm 12 reads the setting from that sets it, or
 * `None`.
 *
 * @remarks
 * Only the sources in the entry's `locations` are consulted, in pnpm's order:
 * the environment, then `pnpm-workspace.yaml`, then the global `config.yaml`.
 * A `nodeLinker` in the global file is not read, as pnpm does not read it;
 * neither is a `stateDir` in the workspace file.
 *
 * An environment value is decoded as text, then as JSON (`PNPM_CONFIG_NODE_LINKER`
 * may hold the loaded-linker object), and one that decodes neither way is
 * skipped to the next source, as pnpm 12 skips it. A file value that does not
 * decode fails `"shape"` naming the setting, with the schema issue as the
 * `cause`: pnpm 12 refuses such a file. A file's `null` is the value of a
 * setting that accepts `null` (`scriptShell: null` clears an inherited shell)
 * and unset for any other, as pnpm reads it.
 *
 * @example
 * ```ts
 * import { PnpmSettings } from "@effected/pnpm";
 * import { readSetting } from "@effected/pnpm/settings";
 * import { Result } from "effect";
 *
 * const settings = Result.getOrThrow(
 *   PnpmSettings.fromSourcesResult({ workspace: { text: "nodeLinker: hoisted\n" } }),
 * );
 * console.log(readSetting(settings, "nodeLinker"));
 * // => a success holding Option.some("hoisted")
 * ```
 *
 * @param settings - The merged settings sources.
 * @param key - The setting.
 * @public
 */
export const readSetting = <K extends PnpmSettingName>(
	settings: PnpmSettings,
	key: K,
): Result.Result<Option.Option<PnpmSettingType<K>>, PnpmSettingsError> => {
	const setting = PnpmSettingsCatalog[key];
	const schema = setting.schema as Schema.Codec<unknown, unknown>;
	const reads = (location: PnpmSettingLocation): boolean => setting.locations.includes(location);
	if (reads("env") && Object.hasOwn(settings.environment, key)) {
		const decoded = fromText(schema, settings.environment[key] ?? "");
		if (Option.isSome(decoded)) return Result.succeed(decoded as Option.Option<PnpmSettingType<K>>);
	}
	const files: ReadonlyArray<readonly [PnpmSettingLocation, Readonly<Record<string, unknown>>]> = [
		["workspace", settings.workspace],
		["global", settings.global],
	];
	for (const [location, layer] of files) {
		if (!reads(location)) continue;
		const value = own(layer, key);
		if (value === undefined) continue;
		const decoded = Schema.decodeUnknownResult(schema)(value);
		if (Result.isSuccess(decoded)) return Result.succeed(Option.some(decoded.success as PnpmSettingType<K>));
		// A `null` the schema refuses is pnpm's "unset": the next source decides.
		if (value === null) continue;
		return Result.fail(new PnpmSettingsError({ reason: "shape", setting: key, cause: decoded.failure }));
	}
	return Result.succeed(Option.none());
};
