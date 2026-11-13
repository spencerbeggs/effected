// pnpm 12's registry, proxy and TLS view as an `@effected/npm` `NpmConfig`:
// the npmrc files pnpm reads, overlaid with the settings pnpm takes from
// `pnpm-workspace.yaml`, the global `config.yaml` and `PNPM_CONFIG_*`.
//
// The merge is pure (`PnpmNpmConfig.fromSourcesResult`, over the lines
// `internal/pnpmNpmrc.ts` renders); `PnpmNpmConfig.load` finds and reads the
// files. Citations name files under `.repos/pnpm/pnpm/crates/config/src`.

import type { NpmConfigSource } from "@effected/npm";
import { NpmConfig, NpmConfigError } from "@effected/npm";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Result } from "effect";
import type { LinesResult } from "./internal/pnpmNpmrc.js";
import { environmentCredentialLines, expandPlaceholders, npmrcLines, overlayLines } from "./internal/pnpmNpmrc.js";
import type { PnpmSettings, PnpmSettingsLoadOptions } from "./PnpmSettings.js";
import { PnpmSettingsError, locatePnpmSettings } from "./PnpmSettings.js";

/**
 * The inputs {@link PnpmNpmConfig.fromSourcesResult} merges: the three npmrc
 * files pnpm 12 reads, pnpm's settings, and the environment.
 *
 * @public
 */
export interface PnpmNpmConfigSources {
	/** pnpm's settings: the environment, workspace and global layers, as `PnpmSettings.load` reads them. */
	readonly settings: PnpmSettings;
	/** The user npmrc (`~/.npmrc`, or the file `npmrcAuthFile` names). */
	readonly user?: NpmConfigSource | undefined;
	/** `auth.ini` in pnpm's global config directory, where `pnpm login` writes. */
	readonly authIni?: NpmConfigSource | undefined;
	/** The project `.npmrc`, at the workspace root. */
	readonly project?: NpmConfigSource | undefined;
	/**
	 * Read the project `.npmrc` as a trusted file. Defaults to `false`: pnpm
	 * trusts it only when the user npmrc setting names that same file.
	 */
	readonly trustProject?: boolean | undefined;
	/** The environment, for `${VAR}` and the `npm_config_//…` / `pnpm_config_//…` credentials. */
	readonly env: Readonly<Record<string, string | undefined>>;
}

/** The one name pnpm accepts for a workspace manifest. */
const WORKSPACE_MANIFEST = "pnpm-workspace.yaml";

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
 * pnpm 12's registry, proxy and TLS configuration, as an `@effected/npm`
 * `NpmConfig`: what `pnpm view` connects with.
 *
 * @remarks
 * `NpmConfig.load` reads what npm reads. pnpm 12 reads different files and
 * three more sources, so a repository with `registry:` or `httpsProxy:` in
 * its `pnpm-workspace.yaml` is answered by `pnpm view` and missed by
 * `NpmConfig.load`. The result here is an ordinary `NpmConfig`: hand
 * `targetFor`'s answer to `NpmRegistry`, and pass `packageManager: "pnpm"` to
 * `proxyFor`, `tlsFor` and `@effected/npm/node`'s `NpmHttpClient.layer`.
 *
 * **Precedence, highest first** (`loading.rs` `load_sources`): a
 * `PNPM_CONFIG_*` / `pnpm_config_*` variable; `pnpm-workspace.yaml`; the
 * global `config.yaml`; then the npmrc files, the project `.npmrc` over
 * `auth.ini` over the user npmrc (`auth_sources.rs` `collect_auth_sources`).
 * The settings files and variables carry `registry`, `registries` (files
 * only), `httpsProxy`, `httpProxy`, `proxy`, `noProxy`, `noproxy`,
 * `strictSsl` and `localAddress`. A CA, a client certificate and every
 * credential come from the npmrc files alone, plus the
 * `npm_config_//host/:_authToken`-style variables (`pnpm_config_` winning),
 * which rank above every file.
 *
 * **What pnpm 12 does not read, this does not either:** npm's global
 * `<prefix>/etc/npmrc`, and every other `npm_config_*` variable. The project
 * `.npmrc` is the one at the workspace root, not the nearest package's.
 *
 * **Repository files are not trusted with the environment.** In the project
 * `.npmrc`, pnpm expands no `${VAR}` in a registry, proxy or credential, so
 * such a line is dropped (`//registry.npmjs.org/:_authToken=${NPM_TOKEN}` in
 * the project file sends no token under pnpm 12); in `pnpm-workspace.yaml`,
 * a proxy with a placeholder is dropped. A registry URL with one in either
 * file fails `PnpmSettingsError` `"untrusted-env"`, as pnpm refuses to load.
 *
 * **pnpm's own readings.** An unscoped `_authToken`, `_auth`,
 * `username`/`_password`, `cert` or `key` applies only to the registry its
 * own file declares (else the public one), so a top-level `cert` reaches
 * `NpmConfig.tlsFor` for that registry, never `transport.cert`. `${VAR}`
 * follows pnpm's dialect (`${VAR:-default}`, an unset variable reads as
 * empty, never a failure). `no-proxy` and `noproxy` in an npmrc are one
 * setting. The `NpmConfig` holds only the keys pnpm reads.
 *
 * **Not modelled:** command-line flags, the structured `_auth` credentials of
 * the global `config.yaml` and `pnpm_config__auth`, `tokenHelper`, the
 * per-registry options of `registries` declarations, and resolving a relative
 * `cafile` against its npmrc's directory (pnpm does; `NpmHttpClient` reads it
 * against the working directory). An npmrc that exists but cannot be read
 * fails `NpmConfigError` `"read"`, where pnpm warns and goes on without it.
 *
 * @example
 * ```ts
 * import { NpmRegistry } from "@effected/npm";
 * import { PnpmNpmConfig } from "@effected/pnpm";
 * import { Effect } from "effect";
 *
 * const tags = (name: string) =>
 *   Effect.gen(function* () {
 *     const config = yield* PnpmNpmConfig.load({ cwd: process.cwd(), env: process.env, platform: process.platform });
 *     const registry = yield* NpmRegistry;
 *     return yield* registry.distTags(name, config.targetFor(name));
 *   });
 * ```
 *
 * @public
 */
export class PnpmNpmConfig {
	private constructor() {}

	/**
	 * Merges pnpm's npmrc files with its settings, with no IO.
	 *
	 * @remarks
	 * Fails `PnpmSettingsError` `"untrusted-env"` for a registry URL with a
	 * `${VAR}` placeholder in the project `.npmrc` (unless `trustProject`) or
	 * in `pnpm-workspace.yaml`. The `NpmConfigError` side of the error is
	 * `NpmConfig.fromSourcesResult`'s and is not expected: every value reaches
	 * it already resolved.
	 *
	 * @param sources - See {@link PnpmNpmConfigSources}.
	 */
	static fromSourcesResult(
		sources: PnpmNpmConfigSources,
	): Result.Result<NpmConfig, NpmConfigError | PnpmSettingsError> {
		const { env, settings } = sources;
		const workspacePath = settings.files.find((file) => file.endsWith(WORKSPACE_MANIFEST));
		const layers: Array<NpmConfigSource> = [];
		// Lowest precedence first: the npmrc files, then the settings layers
		// over them, then the credential variables over everything.
		const files: ReadonlyArray<readonly [NpmConfigSource | undefined, boolean]> = [
			[sources.user, true],
			[sources.authIni, true],
			[sources.project, sources.trustProject === true],
		];
		const rendered: Array<readonly [LinesResult, string | undefined, boolean]> = [];
		for (const [source, trusted] of files) {
			if (source !== undefined) rendered.push([npmrcLines({ text: source.text, trusted }, env), source.path, true]);
		}
		rendered.push(
			[overlayLines({ _tag: "file", settings: settings.global, trusted: true }, env), undefined, false],
			[overlayLines({ _tag: "file", settings: settings.workspace, trusted: false }, env), workspacePath, false],
			[overlayLines({ _tag: "environment", settings: settings.environment }, env), undefined, false],
		);
		for (const [result, path, isNpmrc] of rendered) {
			if (result._tag === "untrusted") {
				return Result.fail(
					new PnpmSettingsError({
						reason: "untrusted-env",
						setting: result.failure.setting,
						...(path === undefined ? {} : { path }),
					}),
				);
			}
			// Only an npmrc is named in `NpmConfig.files`; the settings files are `PnpmSettings.files`.
			layers.push({ text: result.lines.join("\n"), ...(isNpmrc && path !== undefined ? { path } : {}) });
		}
		layers.push({ text: environmentCredentialLines(env).join("\n") });
		return NpmConfig.fromSourcesResult(layers, env, { npmEnvironment: false });
	}

	/**
	 * Loads the configuration pnpm 12 would connect with when run in
	 * `options.cwd`.
	 *
	 * @remarks
	 * The settings are `PnpmSettings.load`'s, from the same options. The
	 * project `.npmrc` is in the workspace root whose `pnpm-workspace.yaml`
	 * applied, else in `cwd`. `auth.ini` is in pnpm's global config
	 * directory. The user npmrc is the first of `pnpm_config_npmrc_auth_file`,
	 * `pnpm_config_userconfig` (each also in upper case), the global
	 * `config.yaml`'s `npmrcAuthFile`, and `npm_config_userconfig` (or
	 * `NPM_CONFIG_USERCONFIG`), a relative path resolving against `cwd`; else
	 * `~/.npmrc` (`auth_sources.rs` `user_npmrc_path`). When it names the
	 * project `.npmrc`, that file is read once, trusted. A file that does not
	 * exist is skipped; an npmrc that cannot be read fails `NpmConfigError`
	 * `"read"`.
	 *
	 * @param options - See `PnpmSettingsLoadOptions`.
	 */
	static readonly load = Effect.fn("PnpmNpmConfig.load")(function* (options: PnpmSettingsLoadOptions) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const env = options.env;
		const located = yield* locatePnpmSettings(options);
		const cwd = path.resolve(options.cwd);
		const home = options.home ?? firstEnv(env, ["HOME", "USERPROFILE"]);

		const read = (file: string): Effect.Effect<NpmConfigSource | undefined, NpmConfigError> =>
			fs.readFileString(file).pipe(
				Effect.map((text): NpmConfigSource | undefined => ({ text, path: file })),
				Effect.catchTag("PlatformError", (error: PlatformError.PlatformError) =>
					error.reason._tag === "NotFound"
						? Effect.succeed(undefined)
						: Effect.fail(new NpmConfigError({ reason: "read", path: file, cause: error })),
				),
			);

		const global = located.settings.global;
		const authFile = Object.hasOwn(global, "npmrcAuthFile") ? global.npmrcAuthFile : undefined;
		const userSetting =
			firstEnv(env, [
				"pnpm_config_npmrc_auth_file",
				"PNPM_CONFIG_NPMRC_AUTH_FILE",
				"pnpm_config_userconfig",
				"PNPM_CONFIG_USERCONFIG",
			]) ??
			(typeof authFile === "string" && authFile !== "" ? expandPlaceholders(authFile, env) : undefined) ??
			firstEnv(env, ["npm_config_userconfig", "NPM_CONFIG_USERCONFIG"]);
		const userFile =
			userSetting !== undefined
				? path.resolve(cwd, userSetting)
				: home !== undefined
					? path.join(home, ".npmrc")
					: undefined;
		const projectFile = path.join(located.workspaceDir ?? cwd, ".npmrc");
		const trustProject = userFile === projectFile;

		const project = yield* read(projectFile);
		const user = userFile === undefined || trustProject ? undefined : yield* read(userFile);
		const authIniFile = located.configDir === undefined ? undefined : path.join(located.configDir, "auth.ini");
		const authIni = authIniFile === undefined ? undefined : yield* read(authIniFile);

		return yield* Effect.fromResult(
			PnpmNpmConfig.fromSourcesResult({
				settings: located.settings,
				env,
				trustProject,
				...(user === undefined ? {} : { user }),
				...(authIni === undefined ? {} : { authIni }),
				...(project === undefined ? {} : { project }),
			}),
		);
	});
}
