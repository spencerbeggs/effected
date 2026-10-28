import { deepMerge } from "./internal/deepMerge.js";

/**
 * Pure, synchronous merging of config values: the merge
 * `MergeStrategy.layeredMerge` runs, without `ConfigSource` wrappers or an
 * `Effect`.
 *
 * @remarks
 * A module of its own, imported from the root: it reaches no codec and no
 * parsing engine, so importing it costs a consumer nothing else.
 *
 * @example
 * ```ts
 * import { ConfigMerge } from "@effected/config-file";
 *
 * const profile = { server: { host: "localhost", port: 8080 }, tags: ["a"] };
 * const user = { server: { port: 9090 }, tags: ["b"] };
 * console.log(ConfigMerge.deep(profile, user));
 * // => { server: { port: 9090, host: "localhost" }, tags: ["b"] }
 * ```
 *
 * @public
 */
export class ConfigMerge {
	private constructor() {}

	/**
	 * Merges `override` over `base`, `override` winning on every conflict.
	 * Neither input is modified.
	 *
	 * @remarks
	 * The rules, which are `MergeStrategy.layeredMerge`'s too:
	 *
	 * - **Which values merge.** Two plain objects merge field-wise, whichever
	 *   of `Object.prototype` and `null` each has as its prototype, so a
	 *   null-prototype object and an ordinary one merge with each other. At the
	 *   top level only, two instances of one class (a decoded `Schema.Class`
	 *   document) merge too. Any other pair is atomic and `override` wins whole.
	 * - **The result's prototype** is `override`'s, so a class instance stays
	 *   an instance and a null-prototype override yields a null-prototype
	 *   result.
	 * - **Arrays are atomic.** `override`'s array replaces `base`'s whole;
	 *   nothing is concatenated or merged by index. So are `Date`, `Map`,
	 *   `Set`, `RegExp` and nested class instances.
	 * - **Presence decides, not value.** An own key on `override` wins even
	 *   when its value is `undefined`; to inherit `base`'s value, omit the key.
	 * - **Prototype keys are dropped.** At every level that merges,
	 *   `__proto__`, `constructor` and `prototype` are skipped on both sides,
	 *   and every key is written as an own data property, so neither input can
	 *   reach `Object.prototype` or replace the result's prototype. A config
	 *   whose real data uses one of those names loses that key at those
	 *   levels. A value taken whole is shared as it is, so an own `__proto__`
	 *   data key inside it (as `JSON.parse` writes one) stays, and stays inert.
	 * - **Only own enumerable string keys** are read. Symbol keys,
	 *   non-enumerable properties and getters on the prototype are not copied.
	 * - **Nothing is cloned.** Merged levels are fresh objects; every value
	 *   taken whole is the same reference as in its input.
	 * - **Shared and cyclic inputs keep their shape.** Each pair of objects
	 *   merges once: a subobject that two keys share on both sides yields one
	 *   merged object both keys share, and a cycle in the inputs becomes the
	 *   same cycle in the result. That also bounds the work to one merge per
	 *   distinct pair, so a cyclic input returns promptly.
	 * - **It is total.** Nested levels merge down to a depth of 1024, far below
	 *   any decoded document; below that, `override`'s value is taken whole,
	 *   so a pathologically deep input returns instead of overflowing the
	 *   stack.
	 */
	static deep<A>(base: A, override: A): A {
		return deepMerge(base, override) as A;
	}
}
