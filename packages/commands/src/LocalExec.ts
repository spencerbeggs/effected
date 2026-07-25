import type { Effect } from "effect";
import { Context, Effect as Eff, Layer, Option, Schema } from "effect";
import { ChildProcess } from "effect/unstable/process";

/**
 * The package managers whose project-local exec argv this package knows.
 *
 * @remarks
 * Structurally identical to `@effected/workspaces`' `PackageManagerName` and
 * assigns freely to and from it — deliberately **not** an import, because this
 * package takes no `@effected` edges. The names are a four-value literal; the
 * *detection* of which one owns a directory is what
 * `@effected/workspaces` contributes, through {@link LocalExec}.
 *
 * @public
 */
export const Launcher = Schema.Literals(["npm", "pnpm", "yarn", "bun"]);

/**
 * The decoded type of {@link (Launcher:variable)}.
 *
 * @public
 */
export type Launcher = typeof Launcher.Type;

/** The argv prefixes for each launcher. The one place this knowledge lives. */
const PREFIXES: Readonly<
	Record<Launcher, { readonly prefix: ReadonlyArray<string>; readonly dlxPrefix: ReadonlyArray<string> }>
> = {
	// `--no` refuses to silently install a missing binary; the `--` stops npx
	// from claiming the tool's own flags.
	npm: { prefix: ["npx", "--no", "--"], dlxPrefix: ["npx"] },
	pnpm: { prefix: ["pnpm", "exec"], dlxPrefix: ["pnpm", "dlx"] },
	yarn: { prefix: ["yarn", "exec"], dlxPrefix: ["yarn", "dlx"] },
	// `--no-install` is bun's equivalent of npm's `--no`.
	bun: { prefix: ["bun", "x", "--no-install"], dlxPrefix: ["bun", "x"] },
};

/**
 * How to run a project-local binary here.
 *
 * @remarks
 * This is the whole of what tool discovery needs from a workspace: an argv
 * prefix and a directory to run it in. It deliberately carries no workspace
 * root, no manifest and no package-manager semantics — `label` is for
 * reporting only, and nothing in this package branches on it.
 *
 * @public
 */
export class ExecContext extends Schema.Class<ExecContext>("ExecContext")({
	/** Human label of the launcher, e.g. `"pnpm"`. Reporting only. */
	label: Schema.String,
	/** argv prefix that runs a project-local binary, e.g. `["pnpm", "exec"]`. */
	prefix: Schema.Array(Schema.String),
	/** argv prefix that fetch-and-runs a package binary, e.g. `["pnpm", "dlx"]`. */
	dlxPrefix: Schema.Array(Schema.String),
	/** Directory the prefix must run in. Omitted means "wherever the caller is". */
	directory: Schema.optionalKey(Schema.String),
}) {
	/** Prefixes `command` with `prefix` and applies `directory`, returning a core `Command`. */
	apply(command: ChildProcess.StandardCommand): ChildProcess.Command {
		return this.withPrefix(command, this.prefix);
	}

	/** As {@link ExecContext.apply}, using `dlxPrefix` — the fetch-and-run launcher. */
	applyDlx(command: ChildProcess.StandardCommand): ChildProcess.Command {
		return this.withPrefix(command, this.dlxPrefix);
	}

	/**
	 * Core's `prefix` and `setCwd` both return NEW commands, so the caller's
	 * value is never mutated.
	 */
	private withPrefix(command: ChildProcess.StandardCommand, prefix: ReadonlyArray<string>): ChildProcess.Command {
		const [head, ...rest] = prefix;
		const prefixed = head === undefined ? command : ChildProcess.prefix(command, head, rest);
		return this.directory === undefined ? prefixed : ChildProcess.setCwd(prefixed, this.directory);
	}
}

/**
 * The project-local execution context could not be determined.
 *
 * @remarks
 * A *mechanism* failure — an unreadable manifest, a detection error. "There is
 * no project-local way to run tools here" is `Option.none()`, never this error:
 * the same `None`-is-success convention `@effected/npm`'s resolver contracts
 * use, so an implementation never has to decide whether absence is exceptional.
 *
 * @public
 */
export class LocalExecError extends Schema.TaggedErrorClass<LocalExecError>()("LocalExecError", {
	/** The directory whose context could not be determined, when one is known. */
	directory: Schema.optionalKey(Schema.String),
	/** The underlying failure. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		return this.directory === undefined
			? "Could not determine the project-local execution context"
			: `Could not determine the project-local execution context for ${this.directory}`;
	}
}

/**
 * The {@link LocalExec} service shape.
 *
 * @remarks
 * Exported so a consumer can type a bespoke implementation against the contract
 * without naming the service class.
 *
 * @public
 */
export interface LocalExecShape {
	/**
	 * The project-local execution context, or `Option.none()` when there is no
	 * project-local way to run tools here.
	 *
	 * @remarks
	 * A value that *is* an `Effect`, because yielding is the natural verb —
	 * core writes `ChildProcessHandle.exitCode` the same way.
	 */
	readonly context: Effect.Effect<Option.Option<ExecContext>, LocalExecError>;
}

/**
 * Contract: how to run a project-local binary in this project.
 *
 * @remarks
 * **This is an inverted contract.** Tool discovery needs package-manager
 * detection and workspace-root resolution, both of which live in the
 * integrated-tier `@effected/workspaces`. Depending on it directly would make
 * this package integrated too — and, through the planned `@effected/npm` edge,
 * would drag `npm`, `lockfiles` and `package-json` up a tier with it. So this
 * package declares the narrow contract and `@effected/workspaces` ships the
 * layer that implements it, exactly as `@effected/npm` owns `CatalogResolver`
 * and workspaces implements that.
 *
 * A consumer with no monorepo never needs that implementation:
 * {@link LocalExec.layerNone} (global-only) and {@link LocalExec.layerFor}
 * (a known package manager) are one-liners.
 *
 * @public
 */
export class LocalExec extends Context.Service<LocalExec, LocalExecShape>()("@effected/commands/LocalExec") {
	/** The exec and dlx argv prefixes for a launcher — the single home of that knowledge. */
	static readonly prefixes = (
		launcher: Launcher,
	): { readonly prefix: ReadonlyArray<string>; readonly dlxPrefix: ReadonlyArray<string> } => PREFIXES[launcher];

	/**
	 * No project-local execution context: every tool resolves globally.
	 *
	 * @remarks
	 * The right wiring for a GitHub Action or any single-package checkout, and
	 * the reason such a consumer never installs `@effected/workspaces`.
	 */
	static readonly layerNone: Layer.Layer<LocalExec> = Layer.succeed(this, {
		context: Eff.succeed(Option.none()),
	});

	/** A context for a known package manager, from the static prefix table. */
	static readonly layerFor = (
		launcher: Launcher,
		options?: { readonly directory?: string | undefined },
	): Layer.Layer<LocalExec> => {
		const { prefix, dlxPrefix } = PREFIXES[launcher];
		return LocalExec.layerContext(
			ExecContext.make({
				label: launcher,
				prefix,
				dlxPrefix,
				...(options?.directory === undefined ? {} : { directory: options.directory }),
			}),
		);
	};

	/** A caller-supplied context, answered verbatim. */
	static readonly layerContext = (context: ExecContext): Layer.Layer<LocalExec> =>
		Layer.succeed(LocalExec, { context: Eff.succeed(Option.some(context)) });

	/**
	 * An in-memory test double.
	 *
	 * @remarks
	 * Unlike most `makeTest` doubles in the kit, the unstubbed default here is
	 * **honest rather than loud**: `Option.none()` is a real, correct answer
	 * ("no project-local context"), so a test that does not care about local
	 * resolution gets the global-only behavior instead of a defect.
	 */
	static readonly makeTest = (overrides: Partial<LocalExecShape> = {}): LocalExecShape => ({
		context: Eff.succeed(Option.none()),
		...overrides,
	});

	/**
	 * {@link LocalExec.makeTest} behind `Layer.succeed`.
	 *
	 * @remarks
	 * A parameterized layer factory mints a fresh reference per call and layers
	 * memoize by reference — bind the result to a `const` rather than calling it
	 * at each composition site.
	 */
	static readonly layerTest = (overrides: Partial<LocalExecShape> = {}): Layer.Layer<LocalExec> =>
		Layer.succeed(LocalExec, LocalExec.makeTest(overrides));
}
