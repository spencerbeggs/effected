/**
 * A true plain object: `{}` or `Object.create(null)`. Class instances, `Date`,
 * `Map`, `Set`, `RegExp` and arrays are values, not merge targets.
 *
 * @remarks
 * This is deliberately narrower than `typeof v === "object"`. A `Date` spread
 * into a fresh object loses every internal slot and yields `{}`; a class
 * instance loses its prototype, so `instanceof` fails and its getters vanish.
 * Recursion is gated on this predicate so nested values of those kinds stay
 * atomic — the higher-priority source wins them whole.
 *
 * @internal
 */
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
};

/**
 * Record-like: a `[object Object]` whose fields can be merged. Admits plain
 * objects and class instances (a decoded `Schema.Class` document), but not
 * `Date` / `Map` / `Set` / `RegExp` / arrays, whose behaviour lives in internal
 * slots that a field-wise merge would destroy.
 */
const isRecordLike = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && Object.prototype.toString.call(value) === "[object Object]";

/**
 * Whether two TOP-LEVEL values merge field-wise: both plain objects (either
 * prototype, `Object.prototype` or `null`), or both record-like on one shared
 * prototype. Anything else is atomic.
 *
 * @remarks
 * The shared-prototype arm is what lets a document decoded through
 * `Schema.Class` merge with another of the same class and keep its identity;
 * nothing else is ever silently reshaped. The plain arm admits a
 * null-prototype object beside an ordinary one, the same pairing every nested
 * level has always merged.
 *
 * @internal
 */
export const canMerge = (a: unknown, b: unknown): boolean =>
	(isPlainObject(a) && isPlainObject(b)) ||
	(isRecordLike(a) && isRecordLike(b) && Object.getPrototypeOf(a) === Object.getPrototypeOf(b));

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/**
 * How many nested levels merge field-wise. At this depth the override's value
 * is taken whole.
 *
 * @remarks
 * Far above the 256-level nesting cap of the kit's parsers, so a decoded
 * document never reaches it. It exists so a pathologically deep pair of inputs
 * cannot overflow the stack. Cycles do not depend on it: the per-pair memo in
 * {@link deepMerge} bounds them, because a depth cap bounds depth, not work —
 * a self-cycle through two keys recursed into both at every level, about
 * 2^depth calls, before the memo existed.
 *
 * @internal
 */
export const MAX_MERGE_DEPTH = 1024;

/**
 * Results already built for a `(base, override)` pair, keyed base first.
 *
 * @remarks
 * Each pair merges once per {@link deepMerge} call. A revisit reuses the
 * result, including one still being built, so a cyclic input yields a result
 * with the same cycle and a subobject shared between keys stays shared. That
 * also bounds the work: at most one merge per distinct pair of objects.
 * `WeakMap`s, so the memo holds no input alive past the call.
 */
type Memo = WeakMap<object, WeakMap<object, Record<string, unknown>>>;

/**
 * Merge `override` over `base`. Two mergeable values ({@link canMerge}) merge
 * field-wise; otherwise `override` wins whole.
 *
 * @internal
 */
export const deepMerge = (base: unknown, override: unknown): unknown =>
	canMerge(base, override)
		? mergeRecords(base as Record<string, unknown>, override as Record<string, unknown>, 1, new WeakMap())
		: override;

/**
 * Field-wise merge, `override`'s own keys winning. Nested plain objects merge;
 * every other value is atomic.
 *
 * @remarks
 * The result is built on `override`'s prototype rather than spread into `{}`,
 * so a decoded `Schema.Class` document survives the merge as a real instance:
 * `instanceof` holds and its getters still work. Without this, `load` would
 * declare `Effect<A>` and hand back a structurally-equal plain object, and a
 * consumer calling a class method would get a `TypeError` that typechecked.
 *
 * Only own enumerable string keys are consulted (`Object.keys`, `Object.hasOwn`),
 * so a prototype getter on `override` never shadows a real key on `base`.
 * Presence decides, not value: an own key on `override` wins even when it holds
 * `undefined`.
 */
const mergeRecords = (
	base: Record<string, unknown>,
	override: Record<string, unknown>,
	depth: number,
	memo: Memo,
): Record<string, unknown> => {
	const seen = memo.get(base)?.get(override);
	if (seen !== undefined) return seen;
	const result: Record<string, unknown> = Object.create(Object.getPrototypeOf(override));
	// Registered before recursing, so a cycle back to this pair finds it.
	let byOverride = memo.get(base);
	if (byOverride === undefined) {
		byOverride = new WeakMap();
		memo.set(base, byOverride);
	}
	byOverride.set(override, result);
	// `override`'s keys must be filtered too, and copied as data properties. A
	// bare assignment uses [[Set]] semantics, so an own `__proto__` key on the
	// higher-priority document would reach `Object.prototype`'s inherited
	// accessor and reassign `result`'s prototype to attacker-controlled data —
	// defeating FORBIDDEN and the prototype just installed. `Object.assign` and
	// `result[k] = v` both do this; `defineProperty` does not.
	for (const key of Object.keys(override)) {
		if (FORBIDDEN.has(key)) continue;
		const overrideValue = override[key];
		const baseValue = Object.hasOwn(base, key) ? base[key] : undefined;
		if (depth < MAX_MERGE_DEPTH && isPlainObject(baseValue) && isPlainObject(overrideValue)) {
			define(result, key, mergeRecords(baseValue, overrideValue, depth + 1, memo));
		} else {
			define(result, key, overrideValue);
		}
	}
	for (const key of Object.keys(base)) {
		if (FORBIDDEN.has(key) || Object.hasOwn(result, key)) continue;
		define(result, key, base[key]);
	}
	return result;
};

/** Create an own data property, never invoking a setter inherited from the prototype chain. */
const define = (target: Record<string, unknown>, key: string, value: unknown): void => {
	Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
};
