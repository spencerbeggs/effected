import { Data } from "effect";

/**
 * A build config is structurally invalid; raised before any build work.
 *
 * @public
 */
export class ConfigValidationError extends Data.TaggedError("ConfigValidationError")<{
	readonly path: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Config validation failed at "${this.path}": ${this.reason}`;
	}
}

/**
 * API Extractor meta generation failed for an entry.
 *
 * @public
 */
export class MetaGenerationError extends Data.TaggedError("MetaGenerationError")<{
	readonly entry: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Meta generation failed for entry "${this.entry}": ${this.reason}`;
	}
}

/**
 * Writing the `bundle.json` sidecar failed: the composed manifest did not encode, or the file could not be
 * written (a read-only or full disk). Recorded in `issues.json` as a `meta` error.
 *
 * @public
 */
export class BundleManifestEmitError extends Data.TaggedError("BundleManifestEmitError")<{
	readonly packageName: string;
	readonly path: string;
	readonly cause: unknown;
}> {
	get message(): string {
		const reason = this.cause instanceof Error ? this.cause.message : String(this.cause);
		return `Could not emit ${this.path} for ${this.packageName}: ${reason}`;
	}
}
