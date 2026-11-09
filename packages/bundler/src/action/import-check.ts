import { execFile } from "node:child_process";
// `node:fs` rather than `FileSystem`: the scratch directory is the HOME, TMPDIR and cwd of the child Node that
// imports the bundle, so it must be a host directory whatever filesystem the caller provides.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** How a bundle loaded, as far as the check can tell. */
export type ImportVerdict =
	| { readonly kind: "imported" }
	/** The action asked for an input it was not given, so the bundle itself is sound. */
	| { readonly kind: "missing-input"; readonly message: string }
	/** The only thing missing is a package the config keeps external, which is the caller's to install. */
	| { readonly kind: "external-missing"; readonly packageName: string; readonly message: string }
	| { readonly kind: "failed"; readonly message: string };

/** What `checkImport` waits for by default before calling a bundle hung. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Tags the line the child writes about a thrown error, so nothing else on stderr can be read as it. */
const FAILURE_MARKER = "__EFFECTED_IMPORT_FAILURE__";

/** The failure of a read input: `@actions/core`'s text, a message opening on a missing input, or a `Config` read of `INPUT_*`. */
const MISSING_INPUT =
	/^Input required and not supplied\b|^(?:missing|required)(?: required)? input\b|\bat \["INPUT_[A-Z0-9_-]+"\]/i;

/** Errors that mean the code is wrong, whatever their message says. */
const PROGRAMMING_ERRORS: ReadonlySet<string> = new Set(["TypeError", "ReferenceError", "RangeError", "SyntaxError"]);

const MODULE_NOT_FOUND_CODES: ReadonlySet<string> = new Set(["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"]);

interface ThrownError {
	readonly name: string;
	readonly code: string | undefined;
	readonly message: string;
}

/**
 * The program the child runs: it imports the bundle and reports a thrown error as data, so the verdict reads the
 * error and never the source line Node echoes above an uncaught one.
 */
const childProgram = (url: string): string => `try {
	await import(${JSON.stringify(url)});
} catch (error) {
	const code = typeof error?.code === "string" ? error.code : undefined;
	const failure = { name: String(error?.name ?? "Error"), code, message: String(error?.message ?? error) };
	process.stderr.write("\\n${FAILURE_MARKER}" + JSON.stringify(failure) + "\\n");
	process.exitCode = 1;
}
`;

/** The error the child reported. A marker line that does not parse is not a report, so the run is read by its exit. */
const thrownFrom = (stderr: string): ThrownError | undefined => {
	const line = stderr.split("\n").find((candidate) => candidate.startsWith(FAILURE_MARKER));
	if (line === undefined) return undefined;
	try {
		return JSON.parse(line.slice(FAILURE_MARKER.length)) as ThrownError;
	} catch {
		return undefined;
	}
};

const verdictOfThrown = (thrown: ThrownError, externals: ReadonlyArray<string>): ImportVerdict => {
	const message = `${thrown.name}: ${thrown.message}`;
	if (thrown.code !== undefined && MODULE_NOT_FOUND_CODES.has(thrown.code)) {
		// ESM says `package` and a CommonJS require says `module`, for the same missing package.
		const packageName = /^Cannot find (?:package|module) '([^']+)'/.exec(thrown.message)?.[1];
		return packageName !== undefined &&
			externals.some((name) => packageName === name || packageName.startsWith(`${name}/`))
			? { kind: "external-missing", packageName, message }
			: { kind: "failed", message };
	}
	return MISSING_INPUT.test(thrown.message) && !PROGRAMMING_ERRORS.has(thrown.name)
		? { kind: "missing-input", message }
		: { kind: "failed", message };
};

/** A run that ended itself reports through `::error::` lines, the only stdout it does not merely echo. */
const verdictOfExit = (stdout: string, stderr: string, exitCode: number): ImportVerdict => {
	const reported = stdout
		.split("\n")
		.filter((line) => line.startsWith("::error::"))
		.map((line) => line.slice("::error::".length));
	const message = reported.join("; ") || stderr.trim() || `exited with code ${exitCode}`;
	return reported.some((line) => MISSING_INPUT.test(line))
		? { kind: "missing-input", message }
		: { kind: "failed", message };
};

/**
 * Imports a bundle in a fresh Node and says whether it loaded.
 *
 * @remarks
 * The child's environment is only `HOME` and `TMPDIR`, both a directory made for this run, which is also its working
 * directory and is removed afterwards. So no `GITHUB_*` variable, token or `NODE_OPTIONS` reaches it, an action's
 * `GITHUB_ACTIONS` guard stays closed, and what an action with no such guard writes stays out of its output.
 *
 * A timeout or an aborted `signal` kills the child with `SIGKILL`, so a child ignoring `SIGTERM` cannot outlive it.
 */
export const checkImport = (
	file: string,
	options?: { readonly externals?: ReadonlyArray<string>; readonly timeoutMs?: number; readonly signal?: AbortSignal },
): Promise<ImportVerdict> => {
	const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const scratch = realpathSync(mkdtempSync(join(tmpdir(), "effected-import-check-")));
	return new Promise((done) => {
		const child = execFile(
			process.execPath,
			["--input-type=module", "-e", childProgram(pathToFileURL(file).href)],
			{
				cwd: scratch,
				env: { HOME: scratch, TMPDIR: scratch },
				timeout,
				killSignal: "SIGKILL",
				maxBuffer: 16 * 1024 * 1024,
			},
			(error, stdout, stderr) => {
				options?.signal?.removeEventListener("abort", onAbort);
				rmSync(scratch, { recursive: true, force: true, maxRetries: 2 });
				if (error === null) {
					done({ kind: "imported" });
				} else if (options?.signal?.aborted) {
					done({ kind: "failed", message: "the load check was aborted" });
				} else if (typeof error.code !== "number") {
					done({ kind: "failed", message: error.killed ? `did not finish within ${timeout} ms` : error.message });
				} else {
					const thrown = thrownFrom(stderr);
					done(
						thrown !== undefined
							? verdictOfThrown(thrown, options?.externals ?? [])
							: verdictOfExit(stdout, stderr, error.code),
					);
				}
			},
		);
		// Not execFile's own `signal` option: it aborts with SIGTERM whatever `killSignal` says, and settles without waiting.
		function onAbort(): void {
			child.kill("SIGKILL");
		}
		if (options?.signal?.aborted) onAbort();
		else options?.signal?.addEventListener("abort", onAbort, { once: true });
	});
};
