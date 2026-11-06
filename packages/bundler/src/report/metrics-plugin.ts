import { gzipSync } from "node:zlib";
import type { Plugin } from "rolldown";
import type { BuildCollector, PassKind } from "./collector.js";

function contentOf(chunk: unknown): string | Uint8Array | undefined {
	const c = chunk as { type?: string; code?: string; source?: string | Uint8Array };
	if (c.type === "chunk") return c.code;
	if (c.type === "asset") return c.source;
	return c.code ?? c.source;
}

function byteLength(content: string | Uint8Array): number {
	return typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
}

/**
 * Rolldown plugin that records emitted-file metrics into the BuildCollector via writeBundle (which
 * fires for the JS pass AND the emitDtsOnly dts pass — verified against tsdown 0.22.3), plus a
 * defensive onLog for rolldown-level diagnostics that bypass tsdown's logger. Append it to each
 * build pass's `plugins` array. `bytes` is taken from the in-memory chunk/asset content (no fs);
 * `gzip` is computed only when `verbose`.
 *
 * Set `suppressMixedExports` for a pass whose emitted CJS carries the `cjsDefaultInterop()`
 * footer — see the onLog comment below for why rolldown's MIXED_EXPORTS advice does not apply
 * there.
 * @public
 */
export function buildMetricsPlugin(
	collector: BuildCollector,
	groupId: string,
	pass: PassKind,
	verbose: boolean,
	suppressMixedExports = false,
): Plugin {
	return {
		name: "savvy:build-metrics",
		writeBundle(_outputOptions, bundle: Record<string, unknown>): void {
			for (const [key, chunk] of Object.entries(bundle)) {
				const content = contentOf(chunk);
				if (content === undefined) continue;
				const bytes = byteLength(content);
				collector.recordEmitted(groupId, pass, {
					path: key,
					bytes,
					...(verbose ? { gzip: gzipSync(typeof content === "string" ? Buffer.from(content) : content).length } : {}),
				});
			}
		},
		onLog(level: string, log: unknown): boolean | undefined {
			const l = log as {
				message?: string;
				id?: string;
				code?: string;
				plugin?: string;
				loc?: { line?: number; column?: number };
			};
			// @tsdown/css (and its `:collect` sibling) compile a `.module.css` into a synthesized ESM
			// locals module — a class-name map plus a side-effect `import` of the extracted css — whose
			// transform hook returns no sourcemap, so rolldown emits SOURCEMAP_BROKEN. That map is empty
			// by construction (synthesized code has no original source positions) and the css builds
			// correctly, so the warning is pure noise. Drop it entirely (no record, no console leak)
			// without masking any genuine diagnostic from other plugins.
			if (l.code === "SOURCEMAP_BROKEN" && l.plugin?.startsWith("@tsdown/css")) return false;
			const text = l.message ?? String(log);
			const entry = {
				text,
				...(l.id !== undefined ? { file: l.id } : {}),
				...(l.loc?.line !== undefined ? { line: l.loc.line } : {}),
				...(l.loc?.column !== undefined ? { column: l.loc.column } : {}),
			};
			// MIXED_EXPORTS on a pass carrying cjsDefaultInterop(): rolldown's suggested fix
			// (`output.exports: "named"`) changes no codegen for this shape — a default+named module
			// emits `exports.default` under both "auto" and "named", which is precisely why the
			// interop footer exists (see cjs-default-interop.ts). The consequence the warning
			// describes — consumers having to reach for `chunk.default` — is what that footer
			// removes. Record it in the suppressed bucket for accounting rather than dropping it
			// silently, and keep it out of the console.
			if (suppressMixedExports && l.code === "MIXED_EXPORTS") {
				collector.recordSuppressed(groupId, { source: "rolldown", level: "warn", code: "MIXED_EXPORTS", ...entry });
				return false;
			}
			if (level === "error") {
				// Record the error but do NOT suppress: returning undefined lets rolldown's default error
				// reporting fire, so a build error is never silently swallowed.
				collector.recordError(groupId, { source: "rolldown", level: "error", ...entry });
				return undefined;
			}
			// Non-error (warn and anything else): record warn-level diagnostics, then suppress the console leak.
			if (level === "warn") collector.recordWarning(groupId, { source: "rolldown", level: "warn", ...entry });
			return false;
		},
	};
}
