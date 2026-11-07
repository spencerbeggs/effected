import { Sgr } from "@effected/env";
import type { BuildCollector } from "./collector.js";

/**
 * Structural match for tsdown's Logger interface (tsdown 0.22.x).
 *
 * @public
 */
export interface TsdownLogger {
	level: "info";
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	warnOnce: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
	success: (...args: unknown[]) => void;
	clearScreen: () => void;
}

const join = (args: unknown[]): string => Sgr.strip(args.map((a) => String(a)).join(" ")).trim();

/**
 * Warnings that are advisory noise for THIS builder and go to the `suppressed` bucket (recorded
 * for accounting, never surfaced). rolldown-plugin-dts announces its tsgo generator as experimental
 * on every pass; the generator is the one this package deliberately pins, so the notice carries no
 * action for a package author.
 */
const SUPPRESSED_WARNINGS: ReadonlyMap<string, string> = new Map([
	["TypeScript Go is experimental. Some options will be unavailable.", "TSGO_EXPERIMENTAL"],
]);

/**
 * A tsdown `customLogger` that routes warnings/errors into the BuildCollector instead of the
 * console. Paired with `logLevel: "silent"` in the same build config: silent suppresses tsdown's
 * own console output while this logger still receives every message (verified against tsdown 0.22.3).
 * info/success are dropped — file metrics come from the writeBundle plugin and timing from our timer.
 * @public
 */
export function createTsdownLogger(collector: BuildCollector, groupId: string): TsdownLogger {
	const seenOnce = new Set<string>();
	const warn = (text: string): void => {
		const code = SUPPRESSED_WARNINGS.get(text);
		if (code !== undefined) {
			collector.recordSuppressed(groupId, { source: "tsdown", level: "warn", code, text });
			return;
		}
		collector.recordWarning(groupId, { source: "tsdown", level: "warn", text });
	};
	return {
		level: "info",
		info: () => {},
		success: () => {},
		clearScreen: () => {},
		warn: (...args) => warn(join(args)),
		warnOnce: (...args) => {
			const text = join(args);
			if (seenOnce.has(text)) return;
			seenOnce.add(text);
			warn(text);
		},
		error: (...args) => collector.recordError(groupId, { source: "tsdown", level: "error", text: join(args) }),
	};
}
