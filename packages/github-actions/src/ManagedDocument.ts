import { CommentStyle, SectionDialect, SectionDocument, SectionId } from "@effected/templates";
import { Effect, Option, Result, Schema } from "effect";

/**
 * The grammar shared by a document's `namespace`, its `key` and every region
 * key.
 *
 * @remarks
 * Letters, digits, dashes and underscores, starting alphanumeric. Dots are
 * excluded deliberately: the three parts are joined with `.` into the marker
 * key written to the wire (`namespace.key.region`), and a dot inside a part
 * would make two different documents spell the same marker.
 */
const NamePart = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]*$/));

/**
 * The marker vocabulary every managed document is written with: HTML comments
 * — the one comment style GitHub renders invisibly — and a phrase distinct
 * from `@effected/templates`' default, so a document that also carries
 * ordinary `MANAGED SECTION` blocks never has them mistaken for regions.
 */
const REGION_DIALECT: SectionDialect = SectionDialect.make({
	phrase: "MANAGED REGION",
	styles: [CommentStyle.html],
});

/**
 * Raised when a managed document cannot be read or regenerated without
 * guessing.
 *
 * @remarks
 * The four structural kinds (`unterminatedRegion`, `orphanedEnd`,
 * `overlappingRegions`, `duplicateRegion`) surface at parse time and name an
 * ambiguity whose silent resolution would corrupt content a human wrote by
 * hand. The two declaration kinds surface when regions are applied:
 * `markerInContent` refuses region content that itself contains a line the
 * scanner would read as a region marker, and `duplicateDeclaration` refuses
 * one call that states two intentions for the same region.
 *
 * @public
 */
export class ManagedDocumentError extends Schema.TaggedError<ManagedDocumentError>()("ManagedDocumentError", {
	/** Which ambiguity or refusal was found. */
	kind: Schema.Literals([
		"unterminatedRegion",
		"orphanedEnd",
		"overlappingRegions",
		"duplicateRegion",
		"markerInContent",
		"duplicateDeclaration",
	]),
	/** 1-based line of the offending marker, for the structural kinds. */
	line: Schema.optionalKey(Schema.Number),
	/** The region key involved, when the failure names one. */
	key: Schema.optionalKey(Schema.String),
}) {
	override get message(): string {
		const which = this.key === undefined ? "" : ` for region "${this.key}"`;
		const where = this.line === undefined ? "" : ` at line ${this.line}`;
		return `${KIND_PROSE[this.kind]}${which}${where}`;
	}
}

const KIND_PROSE: Record<ManagedDocumentError["kind"], string> = {
	unterminatedRegion: "Managed region is never closed",
	orphanedEnd: "Region end marker closes no open region",
	overlappingRegions: "Managed region opens inside another",
	duplicateRegion: "Managed region appears twice",
	markerInContent: "Region content contains a managed-region marker",
	duplicateDeclaration: "Region was declared twice in one call",
};

/** Map a templates scan failure onto this surface's vocabulary. */
const STRUCTURAL_KIND = {
	unterminatedSection: "unterminatedRegion",
	orphanedEnd: "orphanedEnd",
	overlappingSections: "overlappingRegions",
	duplicateSection: "duplicateRegion",
} as const;

/**
 * Options identifying a managed document inside a text that may not carry one
 * yet.
 *
 * @public
 */
export interface ManagedDocumentSource {
	/** Whose document this is, e.g. your action's name. */
	readonly namespace: string;
	/** Which document, within that namespace. */
	readonly key: string;
	/**
	 * The current text — a fetched comment body, a PR description — or absent
	 * when there is nothing yet. An absent text and an empty one mean the same
	 * thing: a fresh document.
	 */
	readonly text?: string | undefined;
}

/**
 * A marker-delimited document: named regions a tool owns, inside text a human
 * may also edit.
 *
 * @remarks
 * The one primitive behind both the sticky PR comment and the managed PR
 * description. A sentinel HTML comment (`<!-- namespace:key -->`) identifies
 * the document; each region is delimited by HTML-comment markers keyed
 * `namespace.key.region`; and everything outside the managed regions is
 * preserved byte-for-byte on regeneration. Regions are **replaced from
 * current state, never appended** — applying the same region twice yields one
 * region carrying the latest content, which is what makes a check that
 * resolves many times safe to re-render.
 *
 * The region engine is `@effected/templates`' pure `SectionDocument` —
 * reused, not reinvented — fixed to the HTML comment style and a
 * region-specific phrase. Everything here is string → string; the GitHub
 * write path composes this with `PullRequestComment` (whose `CommentMarker`
 * renders the *same* sentinel for the same namespace and key) or a PR-body
 * update in `@effected/github`.
 *
 * Construct with {@link ManagedDocument.parseResult} — create-or-update in
 * one call, so the consumer never branches on whether the document exists
 * yet. `ManagedDocument.make` is the raw schema constructor and performs no
 * structural validation.
 *
 * @example
 * ```ts
 * import { ManagedDocument } from "@effected/github-actions";
 * import { Result } from "effect";
 *
 * const doc = ManagedDocument.parseResult({ namespace: "my-action", key: "release", text: fetched });
 * if (Result.isSuccess(doc)) {
 *   const next = doc.success.withRegionsResult([
 *     ["header", "## Validating Release"],
 *     ["footer", "generated by my-action"],
 *   ]);
 * }
 * ```
 *
 * @public
 */
export class ManagedDocument extends Schema.Class<ManagedDocument>("ManagedDocument")({
	/** Whose document this is. */
	namespace: NamePart,
	/** Which document, within that namespace. */
	key: NamePart,
	/** The document's full text, sentinel and regions included. */
	text: Schema.String,
}) {
	/**
	 * Read a document out of existing text, or begin a fresh one.
	 *
	 * @remarks
	 * The synchronous primitive; {@link ManagedDocument.parse} derives from it.
	 * Absent text, empty text and text that carries no sentinel are all legal —
	 * the sentinel and regions are added by the first
	 * {@link ManagedDocument.withRegionsResult}. Only a *structurally corrupt*
	 * region layout fails, because every structural ambiguity is a case where
	 * a silent choice would destroy content a human wrote.
	 */
	static parseResult(source: ManagedDocumentSource): Result.Result<ManagedDocument, ManagedDocumentError> {
		const text = source.text ?? "";
		const scanned = SectionDocument.parseResult(text, REGION_DIALECT);
		if (Result.isFailure(scanned)) {
			const failure = scanned.failure;
			return Result.fail(
				new ManagedDocumentError({
					kind: STRUCTURAL_KIND[failure.reason],
					line: failure.line,
					...(failure.key === undefined ? {} : { key: failure.key }),
				}),
			);
		}
		return Result.succeed(ManagedDocument.make({ namespace: source.namespace, key: source.key, text }));
	}

	/**
	 * Read a document out of existing text, in `Effect`.
	 *
	 * @remarks
	 * Defined in terms of {@link ManagedDocument.parseResult} — synchronous
	 * callers can use that variant directly.
	 */
	static readonly parse = Effect.fn("ManagedDocument.parse")((source: ManagedDocumentSource) =>
		Effect.fromResult(ManagedDocument.parseResult(source)),
	);

	/** The HTML comment identifying this document, `<!-- namespace:key -->`. */
	get sentinel(): string {
		return `<!-- ${this.namespace}:${this.key} -->`;
	}

	/** Does this text carry the document's sentinel? */
	matches(text: string): boolean {
		return text.includes(this.sentinel);
	}

	/** The content of one region, if the document carries it. */
	region(key: string): Option.Option<string> {
		const found = this.ownRegions().find((entry) => entry.key === key);
		return found === undefined ? Option.none() : Option.some(found.content);
	}

	/** Every region this document carries, in document order. */
	get regions(): ReadonlyArray<{ readonly key: string; readonly content: string }> {
		return this.ownRegions();
	}

	/**
	 * The document with these regions replaced from current state.
	 *
	 * @remarks
	 * The synchronous primitive; {@link ManagedDocument.withRegions} derives
	 * from it. Each entry pairs a region key with its full new content. A
	 * region already present is **replaced in place**; a region not present
	 * yet is added; regions not named are left exactly as they are; and every
	 * byte outside a managed region survives untouched. Applying entries that
	 * change nothing returns byte-identical text, which is what lets a caller
	 * compare-and-skip instead of issuing a write.
	 *
	 * Region keys share the name grammar `namespace` and `key` obey; a key
	 * outside it is a wiring error and throws at construction rather than
	 * surfacing in the typed channel.
	 */
	withRegionsResult(
		entries: ReadonlyArray<readonly [key: string, content: string]>,
	): Result.Result<ManagedDocument, ManagedDocumentError> {
		const parsed = SectionDocument.parseResult(this.text, REGION_DIALECT);
		if (Result.isFailure(parsed)) {
			const failure = parsed.failure;
			return Result.fail(
				new ManagedDocumentError({
					kind: STRUCTURAL_KIND[failure.reason],
					line: failure.line,
					...(failure.key === undefined ? {} : { key: failure.key }),
				}),
			);
		}
		const declared = entries.map(([key, content]) =>
			SectionId.make({ key: this.wireKey(key), commentStyle: CommentStyle.html }).section(content),
		);
		const reconciled = parsed.success.reconcile(declared);
		if (Result.isFailure(reconciled)) {
			const failure = reconciled.failure;
			if (failure.reason === "unknownCommentStyle") {
				// Structurally unreachable: every declared section above is built
				// with the one style the module's own dialect recognizes.
				throw new Error("ManagedDocument: the region dialect rejected its own comment style");
			}
			return Result.fail(new ManagedDocumentError({ kind: failure.reason, key: this.regionKeyOf(failure.key) }));
		}
		const withSentinel = this.ensureSentinel(reconciled.success.text, parsed.success.eol);
		return Result.succeed(ManagedDocument.make({ namespace: this.namespace, key: this.key, text: withSentinel }));
	}

	/**
	 * The document with these regions replaced, in `Effect`.
	 *
	 * @remarks
	 * Defined in terms of {@link ManagedDocument.withRegionsResult} —
	 * synchronous callers can use that variant directly.
	 */
	withRegions(
		entries: ReadonlyArray<readonly [key: string, content: string]>,
	): Effect.Effect<ManagedDocument, ManagedDocumentError> {
		return Effect.fromResult(this.withRegionsResult(entries));
	}

	/** The marker key a region is written under: `namespace.key.region`. */
	private wireKey(region: string): string {
		return `${this.namespace}.${this.key}.${region}`;
	}

	/** The region key back out of a wire key, for error reporting. */
	private regionKeyOf(wireKey: string): string {
		const prefix = `${this.namespace}.${this.key}.`;
		return wireKey.startsWith(prefix) ? wireKey.slice(prefix.length) : wireKey;
	}

	/**
	 * This document's own regions, in document order.
	 *
	 * @remarks
	 * A document a human already edited can be structurally corrupt, and a
	 * read has no error channel worth having — a corrupt document simply has
	 * no readable regions; {@link ManagedDocument.parseResult} is where
	 * corruption fails typed. Regions belonging to a *different* document in
	 * the same text (another namespace or key) are not this document's and are
	 * never reported.
	 */
	private ownRegions(): ReadonlyArray<{ readonly key: string; readonly content: string }> {
		const parsed = SectionDocument.parseResult(this.text, REGION_DIALECT);
		if (Result.isFailure(parsed)) {
			return [];
		}
		const prefix = `${this.namespace}.${this.key}.`;
		return parsed.success.sections
			.filter((placed) => placed.section.key.startsWith(prefix))
			.map((placed) => ({ key: placed.section.key.slice(prefix.length), content: placed.section.content }));
	}

	/**
	 * Append the sentinel when the text does not carry it yet.
	 *
	 * @remarks
	 * Appended at the end — the same position `PullRequestComment.upsert`
	 * writes its marker to — so a document rendered here and a comment written
	 * there agree about where the identity line lives.
	 */
	private ensureSentinel(text: string, eol: "\n" | "\r\n"): string {
		if (text.includes(this.sentinel)) {
			return text;
		}
		if (text.trim() === "") {
			return `${this.sentinel}${eol}`;
		}
		return `${text.replace(/(?:\r?\n)+$/, "")}${eol}${eol}${this.sentinel}${eol}`;
	}
}
