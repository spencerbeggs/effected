import { CommandNeutralizer, WorkflowCommand } from "@effected/github-commands";
import type { Block, Document } from "../Doc.js";
import type { RenderContext } from "../Render.js";
import { plainInline, renderPlain } from "./renderPlain.js";

const plainLines = (blocks: ReadonlyArray<Block>, ctx: RenderContext): ReadonlyArray<string> =>
	blocks.length === 0 ? [] : CommandNeutralizer.lines(renderPlain(blocks, ctx));

const blockLines = (block: Block, ctx: RenderContext): ReadonlyArray<string> => {
	switch (block._tag) {
		case "Collapsible": {
			// The title is a command's data, so its line breaks are escaped: a raw one would end the command.
			const title = plainInline(block.title, ctx)
				.map((span) => span.text)
				.join("");
			// Groups do not nest: inside this one a collapsible is plain text, its title and its indented body.
			return [WorkflowCommand.group(title), ...plainLines(block.body, ctx), WorkflowCommand.endGroup()];
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
