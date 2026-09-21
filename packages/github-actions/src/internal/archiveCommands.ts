/**
 * The archiver command lines this package spawns, spelled once.
 *
 * @remarks
 * `Artifact` (pack and unpack) and `ToolInstaller` (unpack only) each spawn
 * the same three shapes — a zip, an unzip, a tar extraction — and each has a
 * Windows half that no test on a POSIX host can execute. Two hand-written
 * copies drifted: `ToolInstaller.extractZip` learned the overwrite overload
 * and the stderr capture below, `Artifact.download` did not, and a download
 * into a non-empty directory kept failing on Windows with an EMPTY stderr.
 * This module is the one spelling; the tests pin its text verbatim, which
 * is the only proof the Windows halves get.
 *
 * **The pwsh unzip is deliberately belt-and-braces.** The THREE-argument
 * `ExtractToDirectory(src, dest, $true)` overload overwrites existing files —
 * the two-argument one refuses, which is what turned a repeated extraction
 * into a hard failure — and the `$ErrorActionPreference = 'Stop'` plus
 * try/catch writes the actual .NET exception text plainly to stderr and
 * exits 1. pwsh's own error rendering does not reliably reach a captured
 * stream, and an empty complaint costs a source dive to even hypothesize
 * about.
 *
 * Every path handed to PowerShell is single-quoted, and a single quote inside
 * one is doubled — the only escape a single-quoted PowerShell literal has.
 *
 * Pure: no filesystem, no environment, no spawn. `internal/spawn.ts` is the
 * execution half. Reaches `effect/unstable/process` alone, so it is safe for
 * any module to import (`__test__/reachability.test.ts`).
 *
 * @internal
 */
import { ChildProcess } from "effect/unstable/process";

/** A PowerShell single-quoted literal: `'` becomes `''`, nothing else is special. */
const pwshLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/** A non-interactive pwsh invocation of one command line. */
const pwsh = (script: string, options?: ChildProcess.CommandOptions): ChildProcess.StandardCommand =>
	ChildProcess.make("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script], options);

/** What {@link zipCommand} packs. */
export interface ZipCommandOptions {
	/** Whether the runner is Windows (`RUNNER_OS`), which selects `Compress-Archive` over `zip`. */
	readonly windows: boolean;
	/** The directory the archiver runs in; every entry is recorded relative to it. */
	readonly root: string;
	/** The files to pack, ALREADY relative to `root` — the caller relativizes, this module does not. */
	readonly files: ReadonlyArray<string>;
	/** Where the archive is written. */
	readonly destination: string;
	/** `zip`'s compression level, clamped to `0..9`; `Compress-Archive` has no equivalent and ignores it. */
	readonly level: number;
}

/**
 * Pack `files` into a zip: `zip -<level> -qr <destination> <files...>` with
 * `root` as the working directory, or `Compress-Archive ... -Force` on
 * Windows (`-Force` overwrites an existing archive).
 *
 * @internal
 */
export const zipCommand = (options: ZipCommandOptions): ChildProcess.StandardCommand =>
	options.windows
		? pwsh(
				`Compress-Archive -Path ${options.files.map(pwshLiteral).join(",")} -DestinationPath ${pwshLiteral(options.destination)} -Force`,
				{ cwd: options.root },
			)
		: ChildProcess.make(
				"zip",
				[`-${Math.min(9, Math.max(0, Math.trunc(options.level)))}`, "-qr", options.destination, ...options.files],
				{ cwd: options.root },
			);

/** What {@link unzipCommand} unpacks. */
export interface UnzipCommandOptions {
	/** Whether the runner is Windows (`RUNNER_OS`), which selects the .NET `ZipFile` over `unzip`. */
	readonly windows: boolean;
	/** The archive. */
	readonly source: string;
	/** The directory its contents land in; existing files are overwritten on both platforms. */
	readonly destination: string;
}

/**
 * Unpack a zip into `destination`, overwriting: `unzip -oq <source> -d
 * <destination>`, or the three-argument `ExtractToDirectory` overload under
 * `$ErrorActionPreference = 'Stop'` and a stderr-writing try/catch on
 * Windows (the module doc says why both halves are load-bearing).
 *
 * @internal
 */
export const unzipCommand = (options: UnzipCommandOptions): ChildProcess.StandardCommand =>
	options.windows
		? pwsh(
				"$ErrorActionPreference = 'Stop'; try { Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
					`[System.IO.Compression.ZipFile]::ExtractToDirectory(${pwshLiteral(options.source)}, ${pwshLiteral(options.destination)}, $true) } ` +
					"catch { [Console]::Error.WriteLine($_.Exception.ToString()); exit 1 }",
			)
		: ChildProcess.make("unzip", ["-oq", options.source, "-d", options.destination]);

/** What {@link tarExtractCommand} unpacks. */
export interface TarExtractCommandOptions {
	/** The tarball. */
	readonly archive: string;
	/** The directory its contents land in (`-C`). */
	readonly destination: string;
	/** `tar`'s flags; absent or empty means `xzf`. */
	readonly flags?: ReadonlyArray<string> | undefined;
}

/**
 * Extract a tarball: `tar <flags> <archive> -C <destination>`. The same on
 * every platform — bsdtar ships on the Windows runner image — so unlike the
 * zip pair there is no `windows` switch.
 *
 * @internal
 */
export const tarExtractCommand = (options: TarExtractCommandOptions): ChildProcess.StandardCommand => {
	const flags = options.flags === undefined || options.flags.length === 0 ? ["xzf"] : [...options.flags];
	return ChildProcess.make("tar", [...flags, options.archive, "-C", options.destination]);
};
