import { Equal, Result, Schema } from "effect";
import { CommentStyle } from "./CommentStyle.js";
import type { Section, SectionId } from "./Section.js";

/**
 * The line ending a document uses.
 *
 * @public
 */
export type Eol = "\n" | "\r\n";

/**
 * Raised when a section cannot be turned into marker-delimited text.
 *
 * @remarks
 * Both reasons describe a document this package would be unable to read back
 * correctly, so rendering refuses rather than writing something it cannot
 * re-parse.
 *
 * @public
 */
export class SectionRenderError extends Schema.TaggedError<SectionRenderError>()("SectionRenderError", {
	/**
	 * `markerInContent` — the content carries a line the scanner would read as
	 * a marker, which would move the block boundary and let the next sync
	 * consume user text. `unknownCommentStyle` — the section's comment style
	 * is not in the dialect's set, so the block would be written into a
	 * document where the scanner could never find it again, growing a
	 * duplicate on every run. `duplicateDeclaration` — the same identity was
	 * declared twice in one call, so the caller stated two intentions for one
	 * block and any choice between them would be a guess; this is the
	 * caller-side twin of the document-side `duplicateSection`.
	 */
	reason: Schema.Literals(["markerInContent", "unknownCommentStyle", "duplicateDeclaration"]),
	/** The key of the section that could not be rendered. */
	key: Schema.String,
}) {
	override get message(): string {
		switch (this.reason) {
			case "markerInContent":
				return `Section "${this.key}" has content containing a managed-section marker`;
			case "unknownCommentStyle":
				return `Section "${this.key}" uses a comment style this dialect does not recognize`;
			default:
				return `Section "${this.key}" was declared twice in one call`;
		}
	}
}

/** The key grammar, mirrored from `SectionKey` for the scanner's capture group. */
const KEY_CAPTURE = "([A-Za-z0-9][A-Za-z0-9._-]*)";

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Inter-token whitespace is tolerated on read, normalized on write. */
const GAP = "[ \\t]+";

/**
 * Compiled matchers are cached per dialect instance. A `WeakMap` rather than
 * a field keeps `SectionDialect` a pure schema class — v3 hung a non-schema
 * private field off its definition class and had to hand-copy it on every
 * derivation.
 */
const matcherCache = new WeakMap<
	SectionDialect,
	ReadonlyArray<{ readonly style: CommentStyle; readonly regex: RegExp }>
>();

/**
 * The marker vocabulary: what phrase delimits a managed section, and which
 * comment styles a document is scanned for.
 *
 * @remarks
 * `styles` exists because reconciliation must **recognize sections it does
 * not own** — a foreign tool's block in the same file is preserved verbatim
 * and must never be mistaken for prose. That set cannot be derived from the
 * caller's own sections, because a foreign block's style may appear nowhere
 * in them.
 *
 * One phrase per dialect is deliberate: two marker families in one document
 * make parsing ambiguous for no benefit anyone has asked for.
 *
 * @public
 */
export class SectionDialect extends Schema.Class<SectionDialect>("SectionDialect")({
	/**
	 * The phrase between the key and the closing rule.
	 *
	 * @remarks
	 * Letters, digits, spaces and underscores only. Dashes are excluded so a
	 * phrase can never contain the `---` rule and make a marker ambiguous
	 * against itself.
	 */
	phrase: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9 _]*$/)),
	/** Which comment styles the document scanner recognizes. At least one. */
	styles: Schema.Array(CommentStyle).check(Schema.isMinLength(1)),
}) {
	/**
	 * The zero-configuration dialect: the phrase `MANAGED SECTION` and every
	 * preset comment style.
	 */
	static readonly default: SectionDialect = SectionDialect.make({
		phrase: "MANAGED SECTION",
		styles: CommentStyle.presets,
	});

	/** True when a section written in this style can be scanned back. */
	recognizes(style: CommentStyle): boolean {
		return this.styles.some((candidate) => Equal.equals(candidate, style));
	}

	/** The opening marker line for an identity, without a line break. */
	beginMarker(id: SectionId): string {
		return this.marker("BEGIN", id);
	}

	/** The closing marker line for an identity, without a line break. */
	endMarker(id: SectionId): string {
		return this.marker("END", id);
	}

	/**
	 * A section as marker-delimited text, or a typed refusal.
	 *
	 * @remarks
	 * Fails rather than producing a document it could not read back: see
	 * {@link SectionRenderError}. Content is emitted with `eol` throughout,
	 * so a section rendered into a CRLF document stays CRLF.
	 */
	render(section: Section, eol: Eol = "\n"): Result.Result<string, SectionRenderError> {
		if (!this.recognizes(section.commentStyle)) {
			return Result.fail(new SectionRenderError({ reason: "unknownCommentStyle", key: section.key }));
		}
		if (this.containsMarker(section.content)) {
			return Result.fail(new SectionRenderError({ reason: "markerInContent", key: section.key }));
		}
		const body = eol === "\n" ? section.content : section.content.replace(/\n/g, eol);
		return Result.succeed(`${this.beginMarker(section.id)}${eol}${body}${eol}${this.endMarker(section.id)}`);
	}

	/**
	 * True when `text` contains a line this dialect would read as a marker.
	 *
	 * @internal
	 */
	containsMarker(text: string): boolean {
		// `matchAll` clones the regex internally; `regex.test` would advance the
		// shared `lastIndex` and make a second call on the same text answer
		// differently from the first.
		return this.matchers().some((matcher) => text.matchAll(matcher.regex).next().done === false);
	}

	/**
	 * One compiled scanner per recognized comment style, memoized.
	 *
	 * @remarks
	 * Each pattern is anchored per line, bounds the key with an explicit
	 * character class, and carries no nested quantifier, so scanning is linear
	 * in document length. Every caller-supplied fragment — prefix, suffix,
	 * phrase — is regex-escaped before interpolation.
	 *
	 * @internal
	 */
	matchers(): ReadonlyArray<{ readonly style: CommentStyle; readonly regex: RegExp }> {
		const cached = matcherCache.get(this);
		if (cached !== undefined) {
			return cached;
		}
		// A phrase's internal spaces read as "some whitespace" so a hand-edited
		// file with a double space still matches.
		const phrase = escapeRegex(this.phrase).replace(/ +/g, GAP);
		const compiled = this.styles.map((style) => {
			const tail = style.suffix === undefined ? "" : `${GAP}${escapeRegex(style.suffix)}`;
			return {
				style,
				// Two subtleties, both load-bearing for CRLF documents.
				//
				// The `\r?` is what makes them match at all: under `m`, `$` matches
				// before the LF and leaves the CR sitting in the line.
				//
				// It is a LOOKAHEAD rather than a consumed character so the match —
				// and therefore the section's span — stops before the CR. A match
				// that consumed it would put the CR inside the span while the
				// canonical render emits none, so every reconciliation would strip
				// one CR and the document would never reach a fixed point.
				regex: new RegExp(
					`^${escapeRegex(style.prefix)}${GAP}---${GAP}(BEGIN|END)${GAP}${KEY_CAPTURE}${GAP}${phrase}${GAP}---${tail}[ \\t]*(?=\r?$)`,
					"gm",
				),
			};
		});
		matcherCache.set(this, compiled);
		return compiled;
	}

	private marker(kind: "BEGIN" | "END", id: SectionId): string {
		const tail = id.commentStyle.suffix === undefined ? "" : ` ${id.commentStyle.suffix}`;
		return `${id.commentStyle.prefix} --- ${kind} ${id.key} ${this.phrase} ---${tail}`;
	}
}
