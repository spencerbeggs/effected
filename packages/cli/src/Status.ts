import type { Style, TokenName } from "./Token.js";

/**
 * How one status looks: a Unicode glyph, an ASCII fallback, a token and a rank.
 *
 * @public
 */
export interface StatusDef {
	/** The Unicode glyph. */
	readonly glyph: string;
	/** The ASCII fallback, used when the theme's glyphs are ASCII. */
	readonly ascii: string;
	/** The semantic token, or an explicit style, the glyph is painted with. */
	readonly token: TokenName | Style;
	/** Severity for {@link Status.worst}: the highest rank wins. */
	readonly rank: number;
}

/**
 * The names of the core vocabulary.
 *
 * @public
 */
export type CoreStatusName = "success" | "failure" | "warning" | "info" | "skip" | "pending";

/**
 * An open vocabulary of statuses.
 *
 * @remarks
 * Start from `Status.core` and add your own with `extend`. The names are a type parameter,
 * so `def` and `worst` reject a name the vocabulary does not have at compile time.
 *
 * @public
 */
export class Status<Names extends string> {
	private constructor(private readonly defs: Readonly<Record<Names, StatusDef>>) {}

	/** The core vocabulary: success, skip, pending, info, warning and failure, by rank 10, 20, 30, 40, 60, 90. */
	static readonly core: Status<CoreStatusName> = new Status<CoreStatusName>({
		success: { glyph: "✓", ascii: "[ok]", token: "success", rank: 10 },
		skip: { glyph: "↷", ascii: "[skip]", token: "muted", rank: 20 },
		pending: { glyph: "◯", ascii: "[ ]", token: "muted", rank: 30 },
		info: { glyph: "ℹ", ascii: "[info]", token: "info", rank: 40 },
		warning: { glyph: "⚠", ascii: "[warn]", token: "warning", rank: 60 },
		failure: { glyph: "✗", ascii: "[FAIL]", token: "failure", rank: 90 },
	});

	/**
	 * The core vocabulary plus `extra`; an entry that reuses a core name replaces it.
	 *
	 * @param extra - the statuses to add, by name
	 */
	static readonly extend = <const Extra extends Record<string, StatusDef>>(
		extra: Extra,
	): Status<CoreStatusName | (keyof Extra & string)> => Status.core.extend(extra);

	/**
	 * This vocabulary plus `extra`; an entry that reuses a name replaces it.
	 *
	 * @param extra - the statuses to add, by name
	 */
	extend<const Extra extends Record<string, StatusDef>>(extra: Extra): Status<Names | (keyof Extra & string)> {
		return new Status<Names | (keyof Extra & string)>({ ...this.defs, ...extra } as Readonly<
			Record<Names | (keyof Extra & string), StatusDef>
		>);
	}

	/**
	 * The definition of a status.
	 *
	 * @param name - a name in this vocabulary
	 */
	def(name: Names): StatusDef {
		return this.defs[name];
	}

	/**
	 * The status with the highest rank; a tie goes to the one that comes first in `names`.
	 *
	 * @remarks
	 * Takes at least one name: there is no worst of nothing, and the type says so rather than the call failing.
	 *
	 * @param names - the statuses to compare
	 */
	worst(names: readonly [Names, ...Array<Names>]): Names {
		let worst = names[0];
		for (const name of names) {
			if (this.defs[name].rank > this.defs[worst].rank) worst = name;
		}
		return worst;
	}
}
