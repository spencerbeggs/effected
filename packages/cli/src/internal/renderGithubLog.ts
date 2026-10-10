import { CommandNeutralizer, WorkflowCommand } from "@effected/github-commands";
import type { Block, Document } from "../Doc.js";
import { sanitize } from "../Fmt.js";
import type { RenderContext } from "../Render.js";
import { plainInline, renderPlainLines } from "./renderPlain.js";

/** Plain lines, neutralized; a block that draws nothing, such as an empty table, gives no line at all. */
const plainLines = (blocks: ReadonlyArray<Block>, ctx: RenderContext): ReadonlyArray<string> =>
	renderPlainLines(blocks, ctx).flatMap((line) => CommandNeutralizer.lines(line));

/**
 * A command's data, with every `##[` neutralized and its line breaks kept as they were. `WorkflowCommand` escapes the
 * breaks, so the command stays one line, but the runner's legacy parser reads `##[` ANYWHERE in a line, including in
 * a command's message and property values (it is tried when the V2 parser rejects the line), so each `##[` gets the
 * neutralizer's marker before its `[`. The V2 rule does not apply: no part of the data starts a line of the log, so
 * each part is neutralized behind a one-character lead that cannot start a command and is cut off again, which keeps
 * a part that begins `::` as it was. The command itself is not neutralized: only the data that goes into it.
 */
const commandData = (text: string): string =>
	text
		.split(/(\r\n|\r|\n)/)
		.map((part, index) => (index % 2 === 0 ? CommandNeutralizer.text(`.${part}`).slice(1) : part))
		.join("");

/**
 * An annotation as the kit's own command, on the trusted path: escaped by `WorkflowCommand`, and its message, title
 * and file neutralized as data (the line and the columns are numbers, which carry nothing).
 */
const annotationLine = (block: Extract<Block, { readonly _tag: "Annotation" }>): string =>
	WorkflowCommand[block.level](commandData(sanitize(block.message)), {
		...(block.title === undefined ? {} : { title: commandData(sanitize(block.title)) }),
		...(block.file === undefined ? {} : { file: commandData(sanitize(block.file)) }),
		...(block.line === undefined ? {} : { startLine: block.line }),
		...(block.endLine === undefined ? {} : { endLine: block.endLine }),
		...(block.col === undefined ? {} : { startColumn: block.col }),
		...(block.endColumn === undefined ? {} : { endColumn: block.endColumn }),
	});

/** A group's body: plain text, except an annotation, which is still a command inside a group. */
const bodyLines = (blocks: ReadonlyArray<Block>, ctx: RenderContext): ReadonlyArray<string> =>
	blocks.flatMap((block) => (block._tag === "Annotation" ? [annotationLine(block)] : plainLines([block], ctx)));

const blockLines = (block: Block, ctx: RenderContext): ReadonlyArray<string> => {
	switch (block._tag) {
		case "Annotation":
			return [annotationLine(block)];
		case "Collapsible": {
			// The title is a command's data, so its line breaks are escaped (a raw one would end the command) and a `##[`
			// in it is neutralized, as in an annotation's message.
			const title = commandData(
				plainInline(block.title, ctx)
					.map((span) => span.text)
					.join(""),
			);
			// Groups do not nest: inside this one a collapsible is plain text, its title and its indented body.
			return [WorkflowCommand.group(title), ...bodyLines(block.body, ctx), WorkflowCommand.endGroup()];
		}
		case "Section": {
			// A section's children start a line, so they may be groups. Everything else is plain text.
			const groups: Array<ReadonlyArray<string>> = [
				...(block.title === undefined ? [] : [plainLines([{ _tag: "Heading", level: 1, content: block.title }], ctx)]),
				...block.children.map((child) => blockLines(child, ctx)),
			];
			return groups.flatMap((group, index) => (index === 0 ? group : ["", ...group]));
		}
		default:
			return plainLines([block], ctx);
	}
};

/**
 * Render a document for a GitHub Actions log: plain text, with a top-level collapsible as a group.
 *
 * @internal
 */
export const renderGithubLog = (doc: Document, ctx: RenderContext): string =>
	doc.flatMap((block) => blockLines(block, ctx)).join("\n");
