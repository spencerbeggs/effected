import { Result } from "effect";

const MAX_DEPTH = 256;

const isPlainObject = (value: object): boolean => {
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
};

const encode = (value: unknown, depth: number): Result.Result<string, string> => {
	if (depth > MAX_DEPTH) return Result.fail(`nesting deeper than ${MAX_DEPTH}`);
	if (value === null || typeof value === "boolean" || typeof value === "string")
		return Result.succeed(JSON.stringify(value));
	if (typeof value === "number") {
		return Number.isFinite(value) ? Result.succeed(JSON.stringify(value)) : Result.fail(`non-finite number ${value}`);
	}
	if (Array.isArray(value)) {
		const parts: Array<string> = [];
		for (const item of value) {
			if (item === undefined) return Result.fail("undefined array element");
			const part = encode(item, depth + 1);
			if (Result.isFailure(part)) return part;
			parts.push(part.success);
		}
		return Result.succeed(`[${parts.join(",")}]`);
	}
	if (typeof value === "object" && isPlainObject(value)) {
		const parts: Array<string> = [];
		for (const key of Object.keys(value).sort()) {
			const member = (value as Record<string, unknown>)[key];
			if (member === undefined) continue;
			const part = encode(member, depth + 1);
			if (Result.isFailure(part)) return part;
			parts.push(`${JSON.stringify(key)}:${part.success}`);
		}
		return Result.succeed(`{${parts.join(",")}}`);
	}
	const kind = typeof value === "object" ? (value.constructor?.name ?? "object") : typeof value;
	return Result.fail(`value of type ${kind} is not JSON data`);
};

/**
 * Canonical JSON: recursively sorted keys, no whitespace, undefined members omitted; non-JSON values refused.
 *
 * Core has no canonical serializer, and `@effected/schemastore`'s `CanonicalJson` is a file formatter that keeps
 * insertion order, so this one is the package's own.
 *
 * @internal
 */
export const canonicalJson = (value: unknown): Result.Result<string, string> => encode(value, 0);
