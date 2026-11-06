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
