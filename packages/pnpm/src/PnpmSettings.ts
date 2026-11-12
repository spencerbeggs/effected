// pnpm's effective settings: the sources `pnpm config get` reads for a pnpm
// setting, merged with pnpm's precedence, and typed accessors over the merge.
//
// The algorithm is pure (`PnpmSettings.fromSourcesResult`); `PnpmSettings.load`
// is the IO shell that finds the two files and reads them through core
// `FileSystem`.

import { GlobSet } from "@effected/glob";
import { Walker } from "@effected/walker";
import { Yaml } from "@effected/yaml";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path, Result, Schema } from "effect";

/** The string entries of an array, or `undefined` for a non-array. Total. */
const stringsOf = (value: unknown): ReadonlyArray<string> | undefined =>
	Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : undefined;

/**
 * A pnpm settings file could not be used.
 *
 * @remarks
 * `reason` routes: `"read"` — the file exists but could not be read (the
 * platform failure is the `cause`); `"parse"` — the file is not valid YAML (the
 * `YamlParseError` is the `cause`); `"shape"` — the file is valid YAML but its
 * document is not a mapping (a list or a scalar), which pnpm refuses too;
 * `"membership"` — the workspace's `packages:` patterns each compile alone but
 * fail as a set (they share one compile budget; the `GlobError` is the
 * `cause`), so whether the directory is a member cannot be decided and the
 * load fails rather than reading the workspace file as not applying. A
 * file that does not exist is not an error: pnpm skips it, and so does
 * {@link PnpmSettings.load}. An empty file is an empty mapping.
 *
 * @public
 */
export class PnpmSettingsError extends Schema.TaggedError<PnpmSettingsError>()("PnpmSettingsError", {
	/** Why the file could not be used. */
	reason: Schema.Literals(["read", "parse", "shape", "membership"]),
	/** The file involved, when the source named one. */
	path: Schema.optionalKey(Schema.String),
	/** The underlying failure, for `"read"`, `"parse"` and `"membership"`. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		const where = this.path === undefined ? "pnpm settings file" : `pnpm settings file ${this.path}`;
		return this.reason === "read"
			? `Could not read ${where}`
			: this.reason === "membership"
				? `The \`packages:\` patterns in ${where} compile one by one but not as a set, so workspace membership cannot be decided`
				: this.reason === "parse"
					? `Could not parse ${where} as YAML`
					: `The document in ${where} is not a mapping of settings`;
	}
}

/**
 * Where a setting's value came from, highest precedence first: a
 * `pnpm_config_*` / `PNPM_CONFIG_*` environment variable, the workspace's
 * `pnpm-workspace.yaml`, or pnpm's global `config.yaml`.
 *
 * @public
 */
export type PnpmSettingOrigin = "environment" | "workspace" | "global";

/**
 * One YAML settings file for {@link PnpmSettings.fromSourcesResult}: its text
 * and, for errors and `PnpmSettings.files`, where it came from.
 *
 * @public
 */
export interface PnpmSettingsSource {
	/** The YAML text. */
	readonly text: string;
	/** Where it was read from. */
	readonly path?: string | undefined;
}

/**
 * The inputs {@link PnpmSettings.fromSourcesResult} merges.
 *
 * @public
 */
export interface PnpmSettingsSources {
	/** The workspace root's `pnpm-workspace.yaml`. */
	readonly workspace?: PnpmSettingsSource | undefined;
	/** pnpm's global `config.yaml`. */
	readonly global?: PnpmSettingsSource | undefined;
	/** The environment, read for `pnpm_config_*` and `PNPM_CONFIG_*` variables. */
	readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

/**
 * Options for {@link PnpmSettings.load}.
 *
 * @public
 */
export interface PnpmSettingsLoadOptions {
	/**
	 * Where pnpm would run. The workspace file is the nearest
	 * `pnpm-workspace.yaml` at or above its real path, when this directory
	 * belongs to that workspace, unless the environment names a workspace
	 * directory (`PNPM_CONFIG_WORKSPACE_DIR`, then `NPM_CONFIG_WORKSPACE_DIR`,
	 * each in either case). See {@link PnpmSettings.load} for the membership
	 * rule.
	 */
	readonly cwd: string;
	/**
	 * The environment, as a plain record (pass `process.env` at the edge). Read
	 * for `pnpm_config_*` settings, the workspace-directory override,
	 * `XDG_CONFIG_HOME`, `LOCALAPPDATA` and `HOME`.
	 */
	readonly env: Readonly<Record<string, string | undefined>>;
	/**
	 * The platform pnpm runs on (pass `process.platform` at the edge). It picks
	 * pnpm's default global config directory when `XDG_CONFIG_HOME` is unset:
	 * `~/Library/Preferences/pnpm` on `"darwin"`, `%LOCALAPPDATA%\pnpm\config`
	 * on `"win32"`, `~/.config/pnpm` elsewhere.
	 */
	readonly platform: string;
	/**
	 * The home directory. Defaults to `env.HOME`, then `env.USERPROFILE`; with
	 * neither, and no `XDG_CONFIG_HOME` (or `LOCALAPPDATA` on win32), no global
	 * config file is read.
	 */
	readonly home?: string | undefined;
	/**
	 * pnpm's global config directory, holding `config.yaml`. Overrides the
	 * directory derived from the environment and platform.
	 */
	readonly globalConfigDir?: string | undefined;
}

/** A setting name as pnpm spells it in YAML: camelCase, from an npmrc-style kebab-case key. */
const settingName = (key: string): string =>
	key.startsWith("@") || key.startsWith("/")
		? key
		: key.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());

/** A lower snake-case env suffix as the camelCase setting it names (`minimum_release_age` → `minimumReleaseAge`). */
const camelFromSnake = (snake: string): string =>
	snake.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());

/** pnpm's two accepted spellings: all-lowercase or all-uppercase prefix and suffix, no empty segment. */
const LOWER_ENV = /^pnpm_config_([a-z0-9]+(?:_[a-z0-9]+)*)$/;
const UPPER_ENV = /^PNPM_CONFIG_([A-Z0-9]+(?:_[A-Z0-9]+)*)$/;

/** Defines an own, enumerable data property, so a `__proto__` key never reaches a prototype. */
const define = (target: Record<string, unknown>, key: string, value: unknown): void => {
	Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
};

/**
 * The environment's pnpm settings, keyed by camelCase setting name. An empty
 * value is unset, and the uppercase spelling wins over the lowercase one when
 * both are present, as pnpm 12 resolves them.
 */
const environmentSettings = (env: Readonly<Record<string, string | undefined>>): Record<string, string> => {
	const lower: Record<string, string> = {};
	const upper: Record<string, string> = {};
	for (const [name, value] of Object.entries(env)) {
		if (value === undefined || value === "") continue;
		const lowerMatch = LOWER_ENV.exec(name);
		if (lowerMatch !== null) define(lower, camelFromSnake(lowerMatch[1] as string), value);
		const upperMatch = UPPER_ENV.exec(name);
		if (upperMatch !== null) define(upper, camelFromSnake((upperMatch[1] as string).toLowerCase()), value);
	}
	const merged: Record<string, string> = {};
	for (const [key, value] of Object.entries(lower)) define(merged, key, value);
	for (const [key, value] of Object.entries(upper)) define(merged, key, value);
	return merged;
};

/** One YAML settings file as its top-level mapping: an empty document is `{}`, a non-mapping fails `"shape"`. */
const mappingOf = (
	source: PnpmSettingsSource | undefined,
): Result.Result<Record<string, unknown>, PnpmSettingsError> => {
	if (source === undefined) return Result.succeed({});
	const at = source.path === undefined ? {} : { path: source.path };
	const parsed = Yaml.parseResult(source.text);
	if (Result.isFailure(parsed)) {
		return Result.fail(new PnpmSettingsError({ reason: "parse", ...at, cause: parsed.failure }));
	}
	const document = parsed.success;
	if (document === null || document === undefined) return Result.succeed({});
	if (typeof document !== "object" || Array.isArray(document)) {
		return Result.fail(new PnpmSettingsError({ reason: "shape", ...at }));
	}
	const mapping: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(document)) define(mapping, key, value);
	return Result.succeed(mapping);
};

/** A canonical decimal: optional `-`, no leading zero, no `+`, hex, exponent or digit separator. */
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/** A canonical unsigned integer, the only form pnpm 12 reads for an integer setting. */
const UNSIGNED = /^(?:0|[1-9][0-9]*)$/;

/** A trimmed canonical decimal string as a finite number, or `undefined`. */
const numberFromText = (text: string): number | undefined => {
	const trimmed = text.trim();
	if (!DECIMAL.test(trimmed)) return undefined;
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : undefined;
};

/** A trimmed canonical unsigned integer string, within the safe-integer range, or `undefined`. */
const unsignedFromText = (text: string): number | undefined => {
	const trimmed = text.trim();
	if (!UNSIGNED.test(trimmed)) return undefined;
	const value = Number(trimmed);
	return Number.isSafeInteger(value) ? value : undefined;
};

/** A file value as a non-negative safe integer: a number (never `-0`) or a canonical unsigned string. */
const unsignedFromValue = (value: unknown): number | undefined =>
	typeof value === "number"
		? Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
			? value
			: undefined
		: typeof value === "string"
			? unsignedFromText(value)
			: undefined;

const numberFromValue = (value: unknown): number | undefined =>
	typeof value === "number"
		? Number.isFinite(value)
			? value
			: undefined
		: typeof value === "string"
			? numberFromText(value)
			: undefined;

const stringsFromValue = (value: unknown): ReadonlyArray<string> | undefined =>
	Array.isArray(value) && value.every((item): item is string => typeof item === "string") ? value : undefined;

/** An environment value as a list: a JSON array of strings, the one form pnpm 11 and 12 both read as a list. */
const stringsFromText = (text: string): ReadonlyArray<string> | undefined => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	return stringsFromValue(parsed);
};

/** An environment value as a boolean: exactly `true` or `false` once trimmed, as pnpm 12 reads it. */
const booleanFromText = (text: string): boolean | undefined => {
	const trimmed = text.trim();
	return trimmed === "true" ? true : trimmed === "false" ? false : undefined;
};

/** The strings pnpm 12 coerces to a boolean in a settings file, compared trimmed and case-insensitively. */
const TRUTHY: ReadonlySet<string> = new Set(["true", "yes", "y", "on"]);
const FALSY: ReadonlySet<string> = new Set(["false", "no", "n", "off"]);

/** A file value as a boolean: a YAML boolean, or one of the strings pnpm 12 coerces. */
const booleanFromValue = (value: unknown): boolean | undefined => {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return undefined;
	const word = value.trim().toLowerCase();
	return TRUTHY.has(word) ? true : FALSY.has(word) ? false : undefined;
};

/** The one name pnpm accepts for a workspace manifest. */
const WORKSPACE_MANIFEST = "pnpm-workspace.yaml";

/** The files that make a directory a project for pnpm's membership check. */
const PROJECT_MANIFESTS: ReadonlyArray<string> = ["package.json", "package.json5", "package.yaml"];

/** Directory names that keep a directory out of every workspace, as pnpm 11 rules. */
const IGNORED_SEGMENTS: ReadonlySet<string> = new Set(["node_modules", "bower_components"]);

/** A POSIX pattern body with empty and `.` segments dropped and `..` folded, as `path.posix.normalize` would. */
const normalizeBody = (body: string): string => {
	const out: Array<string> = [];
	for (const segment of body.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
		else out.push(segment);
	}
	return out.join("/");
};

/**
 * Whether a project directory at `relative` (a non-empty POSIX path below the
 * workspace root) is a member under the manifest's `packages:` value, by
 * pnpm's rule: each pattern names a directory whose `package.json` must match,
 * a `!` pattern excludes, a pattern starting with `/` is skipped, and an absent
 * list is `["."]`, the root alone. A single pattern that does not compile
 * matches nothing; a set that compiles pattern by pattern but fails as a whole
 * (the members share one compile budget) is neither member nor non-member, so
 * it fails `"membership"` rather than answering `false`.
 */
const isWorkspaceMember = (relative: string, packages: unknown): Result.Result<boolean, PnpmSettingsError> => {
	if (relative.split("/").some((segment) => IGNORED_SEGMENTS.has(segment))) return Result.succeed(false);
	const patterns = stringsOf(packages) ?? ["."];
	const globs: Array<string> = [];
	for (const pattern of patterns) {
		const negated = pattern.startsWith("!");
		const body = negated ? pattern.slice(1) : pattern;
		if (body.startsWith("/")) continue;
		const normalized = normalizeBody(body);
		const glob = `${negated ? "!" : ""}${normalized === "" ? "" : `${normalized}/`}package.json`;
		if (Result.isSuccess(GlobSet.compileResult([glob]))) globs.push(glob);
	}
	const set = GlobSet.compileResult(globs);
	return Result.isSuccess(set)
		? Result.succeed(set.success.matches(`${relative}/package.json`))
		: Result.fail(new PnpmSettingsError({ reason: "membership", cause: set.failure }));
};

/** The first non-empty value of the named variables, read as own properties. */
const firstEnv = (
	env: Readonly<Record<string, string | undefined>>,
	names: ReadonlyArray<string>,
): string | undefined => {
	for (const name of names) {
		const value = Object.hasOwn(env, name) ? env[name] : undefined;
		if (value !== undefined && value !== "") return value;
	}
	return undefined;
};

/**
 * pnpm's effective settings: the values `pnpm config get <key>` reports for a
 * pnpm setting, merged from the sources pnpm reads with pnpm's precedence.
 *
 * @remarks
 * Build one with {@link PnpmSettings.load} (finds and reads the files through
 * `FileSystem`) or {@link PnpmSettings.fromSourcesResult} (from text you
 * already hold), then read a setting by name:
 *
 * ```ts
 * settings.minimumReleaseAge;          // Option<number>
 * settings.minimumReleaseAgeExclude;   // ReadonlyArray<string>
 * settings.getBoolean("minimumReleaseAgeStrict");
 * ```
 *
 * **Precedence, highest first**: a `pnpm_config_<name>` or
 * `PNPM_CONFIG_<NAME>` environment variable, the workspace root's
 * `pnpm-workspace.yaml`, then pnpm's global `config.yaml`. A higher source
 * replaces a lower one's value whole; lists are not merged. This is the order
 * pnpm 11 and pnpm 12 apply to settings such as `minimumReleaseAge` and
 * `minimumReleaseAgeExclude`.
 *
 * **What pnpm does not read for a pnpm setting, this does not read either.**
 * `.npmrc` files (project, user and global), `npm_config_*` variables and
 * the old global `rc` file carry no pnpm setting for pnpm 11 and 12: pnpm
 * takes only registry and auth keys from `.npmrc`. A registry or a credential
 * is `@effected/npm`'s `NpmConfig`, not this. Command-line `--config.*`
 * flags, pnpm's built-in defaults (`minimumReleaseAge` reads as unset here,
 * as `pnpm config get` reports it, though pnpm applies a default when it
 * installs), and the per-setting source restrictions pnpm applies to a few
 * machine-level settings (a `pnpm-workspace.yaml` cannot set `globalDir`, for
 * example) are not modelled.
 *
 * **Keys.** Every accessor takes the camelCase name pnpm writes in YAML
 * (`minimumReleaseAge`) or the kebab-case one an npmrc would use
 * (`minimum-release-age`); both name the same setting. An environment
 * variable names a setting in snake case: `pnpm_config_minimum_release_age`
 * all lowercase, or `PNPM_CONFIG_MINIMUM_RELEASE_AGE` all uppercase. A mixed
 * spelling is not a pnpm setting and is ignored, and an empty value is unset.
 * When both spellings are set, the uppercase one wins, as in pnpm 12.
 *
 * **Typed reads.** An environment value is text, read as the type the
 * accessor asks for: a number as a canonical decimal, a boolean as `true` or
 * `false`, a list as a JSON array of strings. An environment value that does
 * not read as that type is skipped, and the next source answers, as pnpm 12
 * skips it. In a file, pnpm 12 coerces boolean words (`yes`, `on`, `"true"`)
 * and digit strings (`"15"`), and so does this. A file value that still does
 * not read as the type answers `None` instead of falling through, because
 * pnpm 12 refuses to load a file with a mistyped setting; {@link
 * PnpmSettings.get} shows the raw value. A `null` in a file is unset.
 *
 * @example
 * ```ts
 * import { PnpmSettings } from "@effected/pnpm";
 * import { Effect, Option } from "effect";
 *
 * const cutoffMinutes = Effect.gen(function* () {
 *   const settings = yield* PnpmSettings.load({
 *     cwd: process.cwd(),
 *     env: process.env,
 *     platform: process.platform,
 *   });
 *   // Unset means pnpm's own default, 1440 minutes, not an open gate.
 *   return Option.getOrElse(settings.minimumReleaseAge, () => 1440);
 * });
 * ```
 *
 * @public
 */
export class PnpmSettings extends Schema.Class<PnpmSettings>("PnpmSettings")({
	/** The environment's pnpm settings, keyed by camelCase name, as written. */
	environment: Schema.Record(Schema.String, Schema.String),
	/** The top-level settings of the workspace's `pnpm-workspace.yaml`. */
	workspace: Schema.Record(Schema.String, Schema.Unknown),
	/** The top-level settings of pnpm's global `config.yaml`. */
	global: Schema.Record(Schema.String, Schema.Unknown),
	/** The settings files that were read, lowest precedence first. */
	files: Schema.Array(Schema.String),
}) {
	/**
	 * A setting's raw value from the highest source that sets it, or `None`.
	 *
	 * @remarks
	 * An environment value is the string as written; a file value is the
	 * decoded YAML (a number, a list, a mapping). Use the typed accessors to
	 * read it as a type.
	 *
	 * @param key - The setting, camelCase or kebab-case.
	 */
	get(key: string): Option.Option<unknown> {
		const name = settingName(key);
		if (Object.hasOwn(this.environment, name)) return Option.some(this.environment[name]);
		for (const layer of [this.workspace, this.global]) {
			const value = Object.hasOwn(layer, name) ? layer[name] : undefined;
			if (value !== undefined && value !== null) return Option.some(value);
		}
		return Option.none();
	}

	/**
	 * Which source {@link PnpmSettings.get} answers a setting from, or `None`
	 * when no source sets it.
	 *
	 * @param key - The setting, camelCase or kebab-case.
	 */
	origin(key: string): Option.Option<PnpmSettingOrigin> {
		const name = settingName(key);
		if (Object.hasOwn(this.environment, name)) return Option.some("environment");
		if (Object.hasOwn(this.workspace, name) && this.workspace[name] != null) return Option.some("workspace");
		if (Object.hasOwn(this.global, name) && this.global[name] != null) return Option.some("global");
		return Option.none();
	}

	/**
	 * A string setting: an environment value as written, or a string in a file.
	 *
	 * @param key - The setting, camelCase or kebab-case.
	 */
	getString(key: string): Option.Option<string> {
		return this.read(
			key,
			(text) => text,
			(value) => (typeof value === "string" ? value : undefined),
		);
	}

	/**
	 * A numeric setting: a finite number, or a canonical decimal string, in any
	 * source.
	 *
	 * @remarks
	 * A canonical decimal is an optional `-`, digits with no leading zero, and
	 * an optional fraction: `05`, `+5`, `0x10`, `1e2` and `1_000` are not
	 * numbers here, as pnpm 12 does not read them from the environment. An
	 * integer setting such as {@link PnpmSettings.minimumReleaseAge} is
	 * stricter still.
	 *
	 * @param key - The setting, camelCase or kebab-case.
	 */
	getNumber(key: string): Option.Option<number> {
		return this.read(key, numberFromText, numberFromValue);
	}

	/**
	 * A boolean setting: `true` or `false` in the environment, a YAML boolean
	 * or a boolean word in a file.
	 *
	 * @remarks
	 * In a file, the strings `true`, `yes`, `y` and `on` read as `true` and
	 * `false`, `no`, `n` and `off` as `false`, trimmed and in any case, as
	 * pnpm 12 coerces them. A number (`1`, `0`) or any other string answers
	 * `None`; pnpm 12 refuses it as an invalid boolean. The environment is
	 * stricter: only `true` or `false`, trimmed and lowercase.
	 *
	 * @param key - The setting, camelCase or kebab-case.
	 */
	getBoolean(key: string): Option.Option<boolean> {
		return this.read(key, booleanFromText, booleanFromValue);
	}

	/**
	 * A list setting: a JSON array of strings in the environment, a YAML list
	 * of strings in a file.
	 *
	 * @remarks
	 * A comma-separated environment value is not a list: pnpm 12 ignores it,
	 * and this skips it to the next source.
	 *
	 * @param key - The setting, camelCase or kebab-case.
	 */
	getStringArray(key: string): Option.Option<ReadonlyArray<string>> {
		return this.read(key, stringsFromText, stringsFromValue);
	}

	/**
	 * `minimumReleaseAge`: the minutes a version must have been published before
	 * pnpm installs it, or `None` when no source sets it. `None` is not an
	 * open gate: pnpm then applies its built-in default of 1440 minutes.
	 *
	 * @remarks
	 * Only a non-negative safe integer counts, as pnpm 12 reads the setting
	 * (an unsigned 64-bit integer, here bounded by `Number.MAX_SAFE_INTEGER`).
	 * Text, in the environment or a quoted file value, must be canonical digits
	 * once trimmed: `" 30 "` reads as 30, while `05`, `+5`, `-0`, `5.0`, `0x10`
	 * and `1e2` do not read at all. Such an environment value is skipped to the
	 * next source; such a file value answers `None`. A YAML number is read as
	 * decoded, so an unquoted `5.0` or `1e2` in a file reads as 5 or 100 where
	 * pnpm 12 refuses the file.
	 */
	get minimumReleaseAge(): Option.Option<number> {
		return this.read("minimumReleaseAge", unsignedFromText, unsignedFromValue);
	}

	/**
	 * `minimumReleaseAgeExclude`: the package patterns exempt from
	 * {@link PnpmSettings.minimumReleaseAge}, empty when no source sets them.
	 *
	 * @remarks
	 * An explicitly empty list in a higher source shadows a lower source's
	 * entries, as in pnpm.
	 */
	get minimumReleaseAgeExclude(): ReadonlyArray<string> {
		return Option.getOrElse(this.getStringArray("minimumReleaseAgeExclude"), () => []);
	}

	/**
	 * The typed read every accessor shares: an environment value that does not
	 * parse falls through; the first file that sets the key decides.
	 */
	private read<A>(
		key: string,
		fromText: (text: string) => A | undefined,
		fromValue: (value: unknown) => A | undefined,
	): Option.Option<A> {
		const name = settingName(key);
		if (Object.hasOwn(this.environment, name)) {
			const parsed = fromText(this.environment[name] as string);
			if (parsed !== undefined) return Option.some(parsed);
		}
		for (const layer of [this.workspace, this.global]) {
			const value = Object.hasOwn(layer, name) ? layer[name] : undefined;
			if (value === undefined || value === null) continue;
			return Option.fromUndefinedOr(fromValue(value));
		}
		return Option.none();
	}

	/**
	 * Merges pnpm's settings sources, with no IO.
	 *
	 * @remarks
	 * Parses each YAML file, keeps the environment's `pnpm_config_*` and
	 * `PNPM_CONFIG_*` variables, and records the named files in
	 * `PnpmSettings.files`. Fails `"parse"` for a file that is not YAML
	 * and `"shape"` for one whose document is not a mapping.
	 *
	 * @param sources - The workspace file, the global file and the environment.
	 */
	static fromSourcesResult(sources: PnpmSettingsSources): Result.Result<PnpmSettings, PnpmSettingsError> {
		const global = mappingOf(sources.global);
		if (Result.isFailure(global)) return Result.fail(global.failure);
		const workspace = mappingOf(sources.workspace);
		if (Result.isFailure(workspace)) return Result.fail(workspace.failure);
		const files: Array<string> = [];
		for (const source of [sources.global, sources.workspace]) {
			if (source?.path !== undefined) files.push(source.path);
		}
		return Result.succeed(
			PnpmSettings.make({
				environment: environmentSettings(sources.env ?? {}),
				workspace: workspace.success,
				global: global.success,
				files,
			}),
		);
	}

	/**
	 * Loads the settings pnpm would use when run in `options.cwd`.
	 *
	 * @remarks
	 * The workspace file is found as pnpm finds it. When a
	 * `PNPM_CONFIG_WORKSPACE_DIR` / `NPM_CONFIG_WORKSPACE_DIR` variable names a
	 * directory (resolved against `cwd`), its `pnpm-workspace.yaml` is the
	 * file, unconditionally. Otherwise `cwd` is resolved through
	 * `FileSystem.realPath` (the lexical path when that fails, as in pnpm), and
	 * the nearest `pnpm-workspace.yaml` at or above it is taken. A misnamed
	 * manifest (`pnpm-workspace.yml`, `.pnpm-workspace.yaml`) is not a
	 * workspace manifest and the ascent passes it, as pnpm 12 does; pnpm 11
	 * refuses to run below one. That workspace applies only when `cwd` belongs
	 * to it: `cwd`
	 * is its root, `cwd` holds no project manifest (`package.json`,
	 * `package.json5` or `package.yaml`), or `cwd` matches the manifest's
	 * `packages:` patterns. A manifest with no `packages:` key has the root as
	 * its only member, so a nested project with its own `package.json` (an
	 * example app, a fixture) reads no workspace file, exactly as pnpm skips
	 * it. A directory under `node_modules` or `bower_components` is never a
	 * member.
	 *
	 * The global file is `config.yaml` in pnpm's global config directory:
	 * {@link PnpmSettingsLoadOptions.globalConfigDir}, else
	 * `$XDG_CONFIG_HOME/pnpm`, else the platform default (see
	 * {@link PnpmSettingsLoadOptions.platform}). A file that does not exist is
	 * skipped; one that cannot be read fails `"read"` (so does a project
	 * manifest probe that fails other than not-found), and one that does not
	 * parse fails as {@link PnpmSettings.fromSourcesResult} does.
	 *
	 * @param options - See {@link PnpmSettingsLoadOptions}.
	 */
	static readonly load = Effect.fn("PnpmSettings.load")(function* (options: PnpmSettingsLoadOptions) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const env = options.env;
		const cwd = path.resolve(options.cwd);
		const realCwd = yield* fs.realPath(cwd).pipe(Effect.orElseSucceed(() => cwd));
		const home = options.home ?? firstEnv(env, ["HOME", "USERPROFILE"]);

		const read = (file: string): Effect.Effect<PnpmSettingsSource | undefined, PnpmSettingsError> =>
			fs.readFileString(file).pipe(
				Effect.map((text): PnpmSettingsSource | undefined => ({ text, path: file })),
				Effect.catchTag("PlatformError", (error: PlatformError.PlatformError) =>
					error.reason._tag === "NotFound"
						? Effect.succeed(undefined)
						: Effect.fail(new PnpmSettingsError({ reason: "read", path: file, cause: error })),
				),
			);

		const workspaceDir = firstEnv(env, [
			"PNPM_CONFIG_WORKSPACE_DIR",
			"pnpm_config_workspace_dir",
			"NPM_CONFIG_WORKSPACE_DIR",
			"npm_config_workspace_dir",
		]);
		// Whether the directory holds a project manifest; a probe that fails other
		// than not-found is a failure, not an absence.
		const hasProjectManifest = (dir: string): Effect.Effect<boolean, PnpmSettingsError> =>
			Effect.forEach(PROJECT_MANIFESTS, (name) => {
				const file = path.join(dir, name);
				return fs
					.exists(file)
					.pipe(Effect.mapError((cause) => new PnpmSettingsError({ reason: "read", path: file, cause })));
			}).pipe(Effect.map((found) => found.some(Boolean)));

		// The nearest workspace manifest pnpm would use from `realCwd`, read, or
		// `undefined` when there is none or `realCwd` does not belong to it.
		const ascendToWorkspace = Effect.gen(function* () {
			const chain = yield* Walker.ascend(realCwd);
			const found = yield* Walker.findUpward(chain, (dir) => [path.join(dir, WORKSPACE_MANIFEST)]);
			if (Option.isNone(found)) return undefined;
			const file = found.value;
			const source = yield* read(file);
			if (source === undefined) return undefined;
			const relative = path.relative(path.dirname(file), realCwd).split(path.sep).join("/");
			if (relative === "" || !(yield* hasProjectManifest(realCwd))) return source;
			// Only now does pnpm read the manifest for its `packages:`; a file that
			// does not parse fails here exactly as it would below.
			const mapping = yield* Effect.fromResult(mappingOf(source));
			const packages = Object.hasOwn(mapping, "packages") ? mapping.packages : undefined;
			const member = yield* Effect.fromResult(isWorkspaceMember(relative, packages));
			return member ? source : undefined;
		});

		const workspaceFile =
			workspaceDir !== undefined ? path.join(path.resolve(cwd, workspaceDir), WORKSPACE_MANIFEST) : undefined;
		const workspace = workspaceFile === undefined ? yield* ascendToWorkspace : yield* read(workspaceFile);

		const xdg = firstEnv(env, ["XDG_CONFIG_HOME"]);
		const localAppData = firstEnv(env, ["LOCALAPPDATA"]);
		const configDir =
			options.globalConfigDir ??
			(xdg !== undefined
				? path.join(xdg, "pnpm")
				: options.platform === "win32" && localAppData !== undefined
					? path.join(localAppData, "pnpm", "config")
					: home === undefined
						? undefined
						: options.platform === "darwin"
							? path.join(home, "Library", "Preferences", "pnpm")
							: path.join(home, ".config", "pnpm"));
		const globalFile = configDir === undefined ? undefined : path.join(configDir, "config.yaml");

		const global = globalFile === undefined || globalFile === workspace?.path ? undefined : yield* read(globalFile);
		return yield* Effect.fromResult(PnpmSettings.fromSourcesResult({ workspace, global, env }));
	});
}
