// The drift-detection canonicaliser: JSON text with object keys sorted by
// UTF-16 code units at every depth, array order kept, and undefined members
// dropped from objects. Only a Date's toJSON is honoured: any other object
// must be an array or a plain object, because another type's toJSON (an
// Effect data type's debug rendering, say) is no stable contract. Not RFC 8785 (that refuses undefined, where drift
// detection must treat absent and undefined alike). Unspanned: the
// `Fingerprint` facade owns the span.

import { Result } from "effect";
import { FingerprintError } from "../FingerprintError.js";

/** Thrown inside the walk and converted at the boundary; never escapes this module. */
class Refusal {
	constructor(
		readonly path: string,
		readonly detail: string,
	) {}
}

const pointer = (parent: string, key: string | number): string =>
	`${parent}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;

/** The remedy every non-plain object refusal carries. */
const ENCODE_FIRST = "(encode it to plain JSON first)";

const describe = (value: unknown): string => {
	if (typeof value === "bigint") return "a bigint";
	if (typeof value === "function") return "a function";
	if (typeof value === "symbol") return "a symbol";
	if (value === undefined) return "undefined";
	if (typeof value === "number") return `the number ${String(value)}`;
	if (value instanceof Map) return `a Map ${ENCODE_FIRST}`;
	if (value instanceof Set) return `a Set ${ENCODE_FIRST}`;
	return `a non-plain object ${ENCODE_FIRST}`;
};

const isPlainObject = (value: object): boolean => {
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
};

/** A `Date`'s `toJSON` applied as `JSON.stringify` applies it; no other type's is trusted. */
const toJson = (value: unknown, key: string, path: string): unknown => {
	if (value instanceof Date) {
		try {
			return value.toJSON(key);
		} catch {
			throw new Refusal(path, "a toJSON that throws");
		}
	}
	return value;
};

const emit = (raw: unknown, key: string, path: string, stack: Set<object>): string | undefined => {
	const value = toJson(raw, key, path);
	if (value === null) return "null";
	switch (typeof value) {
		case "boolean":
			return value ? "true" : "false";
		case "string":
			return JSON.stringify(value);
		case "number":
			if (!Number.isFinite(value)) throw new Refusal(path, describe(value));
			return JSON.stringify(value);
		case "undefined":
			return undefined;
		case "object":
			break;
		default:
			throw new Refusal(path, describe(value));
	}
	if (stack.has(value)) throw new Refusal(path, "a cycle");
	stack.add(value);
	try {
		if (Array.isArray(value)) {
			const items: Array<string> = [];
			for (let index = 0; index < value.length; index++) {
				const at = pointer(path, index);
				let element: unknown;
				try {
					element = value[index];
				} catch {
					throw new Refusal(at, "a getter that throws");
				}
				// An undefined element (or a hole) becomes null, as JSON.stringify writes it.
				items.push(emit(element, String(index), at, stack) ?? "null");
			}
			return `[${items.join(",")}]`;
		}
		if (!isPlainObject(value)) throw new Refusal(path, describe(value));
		const record = value as Record<string, unknown>;
		const members: Array<string> = [];
		for (const name of Object.keys(record).sort()) {
			const at = pointer(path, name);
			let member: unknown;
			try {
				member = record[name];
			} catch {
				throw new Refusal(at, "a getter that throws");
			}
			const text = emit(member, name, at, stack);
			// An undefined member is dropped, so absent and undefined fingerprint alike.
			if (text !== undefined) members.push(`${JSON.stringify(name)}:${text}`);
		}
		return `{${members.join(",")}}`;
	} finally {
		stack.delete(value);
	}
};

/** V8 and JavaScriptCore report stack exhaustion as a `RangeError`, SpiderMonkey as an `InternalError`; each message names the call stack or the recursion. */
const isStackOverflow = (thrown: unknown): boolean =>
	(thrown instanceof RangeError || (thrown instanceof Error && thrown.name === "InternalError")) &&
	/call stack|too much recursion/i.test(thrown.message);

/**
 * The canonical JSON text of a value, or a typed refusal.
 *
 * @internal
 */
export const canonicalText = (value: unknown): Result.Result<string, FingerprintError> => {
	try {
		const text = emit(value, "", "", new Set());
		return text === undefined
			? Result.fail(new FingerprintError({ path: "", detail: "undefined" }))
			: Result.succeed(text);
	} catch (thrown) {
		if (thrown instanceof Refusal) {
			return Result.fail(new FingerprintError({ path: thrown.path, detail: thrown.detail }));
		}
		// A pathologically deep value overflows the stack; anything else (a
		// Proxy trap that throws, say, or another RangeError such as V8's
		// "Invalid string length") is not a property of the value's JSON form
		// and propagates as a defect.
		if (isStackOverflow(thrown)) {
			return Result.fail(new FingerprintError({ path: "", detail: "a value nested too deeply" }));
		}
		throw thrown;
	}
};
