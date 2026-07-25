import { Data } from "effect";
import type { Section, SectionId } from "./Section.js";

/**
 * What a sync did to one declared section.
 *
 * @remarks
 * `Updated` carries **both sides** rather than a diff. The model this replaces
 * computed a set difference over lines, which deduplicated, ignored order, and
 * reported a pure line reordering as no change at all — a diff that could say
 * "nothing changed" about changed content. Every consumer of that model read
 * only the tag, so the honest primitive is the pair; a caller wanting a
 * rendering diffs `before.content` against `after.content` with the diff
 * library of its choice.
 *
 * @public
 */
export type SyncOutcome = Data.TaggedEnum<{
	/** The section was not in the document and has been added. */
	readonly Created: { readonly section: Section };
	/** The section was present with different content and has been rewritten. */
	readonly Updated: { readonly before: Section; readonly after: Section };
	/** The section was already exactly as declared. */
	readonly Unchanged: { readonly section: Section };
}>;

/**
 * Constructors and matchers for {@link SyncOutcome} — e.g.
 * `SyncOutcome.Created({ section })`, `SyncOutcome.$is("Updated")`.
 *
 * @public
 */
export const SyncOutcome = Data.taggedEnum<SyncOutcome>();

/**
 * What a check found, without touching the document.
 *
 * @remarks
 * Three flat variants rather than the `Found({ isUpToDate, diff })` +
 * `NotFound` pair they replace: a boolean beside a diff that already encodes
 * the same fact is two sources of truth for one question, and it forces every
 * caller through a nested branch.
 *
 * @public
 */
export type CheckOutcome = Data.TaggedEnum<{
	/** No section with this identity is in the document. */
	readonly Absent: { readonly id: SectionId };
	/** The document already says exactly what was declared. */
	readonly UpToDate: { readonly section: Section };
	/** The document has this section, with different content. */
	readonly Drifted: { readonly onDisk: Section; readonly expected: Section };
}>;

/**
 * Constructors and matchers for {@link CheckOutcome} — e.g.
 * `CheckOutcome.Absent({ id })`, `CheckOutcome.$is("Drifted")`.
 *
 * @public
 */
export const CheckOutcome = Data.taggedEnum<CheckOutcome>();
