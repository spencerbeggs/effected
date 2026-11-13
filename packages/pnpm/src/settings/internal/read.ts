// The algorithm behind `PnpmSettingsCatalog.read`, over one untyped entry. The
// facade casts the result to the entry's type; keeping the work here keeps
// `PnpmSettingsCatalog.ts` free of an import cycle with the areas.

import type { PnpmSettings } from "@effected/pnpm";
import { PnpmSettingsError } from "@effected/pnpm";
import { Option, Result, Schema } from "effect";
import type { PnpmSetting, PnpmSettingLocation } from "../PnpmSetting.js";

/** `JSON.parse`, as an `Option`: a value that is not JSON is `None`. */
const parseJson = (text: string): Option.Option<unknown> => {
	try {
		return Option.some(JSON.parse(text));
	} catch {
		return Option.none();
	}
};

const decode = (setting: PnpmSetting<unknown>, value: unknown): Option.Option<unknown> =>
	Option.getSuccess(Schema.decodeUnknownResult(setting.schema)(value));

/**
 * A JSON value typed the way serde_json types it: a boolean setting takes a
 * JSON boolean and a number setting a JSON number, so the file codecs' string
 * coercions (`yes`, `"7"`) never apply to the environment.
 */
const decodeJson = (setting: PnpmSetting<unknown>, value: unknown): Option.Option<unknown> =>
	(setting.kind === "boolean" && typeof value !== "boolean") || (setting.kind === "number" && typeof value !== "number")
		? Option.none()
		: decode(setting, value);

/** An environment value read as pnpm 12 reads it for the setting; `None` when pnpm ignores it. */
const fromEnvironment = (setting: PnpmSetting<unknown>, text: string): Option.Option<unknown> => {
	switch (setting.envFormat) {
		case "json":
			return Option.flatMap(parseJson(text), (value) => decodeJson(setting, value));
		case "text":
			return decode(setting, text);
		case "jsonOrText":
		case "flag": {
			const read = Option.orElse(
				Option.flatMap(parseJson(text), (value) => decode(setting, value)),
				() => decode(setting, text),
			);
			return setting.envFormat === "flag" ? Option.orElse(read, () => decode(setting, true)) : read;
		}
		default:
			// `subkeys` and no format at all: no variable carries the setting's own name.
			return Option.none();
	}
};

const own = (layer: Readonly<Record<string, unknown>>, name: string): unknown =>
	Object.hasOwn(layer, name) ? layer[name] : undefined;

/** One setting from `settings` through `setting`; see `PnpmSettingsCatalog.read`. */
export const readThrough = (
	settings: PnpmSettings,
	setting: PnpmSetting<unknown>,
): Result.Result<Option.Option<unknown>, PnpmSettingsError> => {
	const name = setting.name;
	const reads = (location: PnpmSettingLocation): boolean => setting.locations.includes(location);
	if (reads("env") && Object.hasOwn(settings.environment, name)) {
		const decoded = fromEnvironment(setting, settings.environment[name] ?? "");
		if (Option.isSome(decoded)) return Result.succeed(decoded);
	}
	const files: ReadonlyArray<readonly [PnpmSettingLocation, Readonly<Record<string, unknown>>]> = [
		["workspace", settings.workspace],
		["global", settings.global],
	];
	for (const [location, layer] of files) {
		if (!reads(location)) continue;
		const value = own(layer, name);
		if (value === undefined) continue;
		const decoded = Schema.decodeUnknownResult(setting.schema)(value);
		if (Result.isSuccess(decoded)) return Result.succeed(Option.some(decoded.success));
		// A `null` the schema refuses is pnpm's "unset": the next source decides.
		if (value === null) continue;
		return Result.fail(new PnpmSettingsError({ reason: "shape", setting: name, cause: decoded.failure }));
	}
	return Result.succeed(Option.none());
};
