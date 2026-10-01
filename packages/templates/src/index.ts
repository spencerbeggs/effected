/**
 * Managed sections in files: marker-delimited blocks a tool owns inside a file
 * whose surrounding content belongs to the user. `SectionDocument` is the pure
 * string-to-string core, `ManagedSection` the `FileSystem`-backed service, and
 * `CommentStyle` and `SectionDialect` describe how markers are written and
 * scanned.
 *
 * @packageDocumentation
 */

export { CommentStyle } from "./CommentStyle.js";
export {
	ManagedSection,
	type ManagedSectionOptions,
	type ManagedSectionShape,
	SectionFileError,
} from "./ManagedSection.js";
export { PlacedSection, Section, SectionId, SectionKey } from "./Section.js";
export { type Eol, SectionDialect, SectionRenderError } from "./SectionDialect.js";
export { SectionDocument, SectionParseError, type SectionReconciliation } from "./SectionDocument.js";
export { CheckOutcome, SyncOutcome } from "./SectionOutcome.js";
