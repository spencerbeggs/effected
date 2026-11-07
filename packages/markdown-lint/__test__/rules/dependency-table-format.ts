// CSH005, ported from savvy-web/systems as ONE definition over kit trees. The
// two systems engines disagreed on this rule (the kit rule surfaced Schema
// decode messages and anchored every finding at the table; the markdownlint
// rule checks each cell itself and anchors row findings at the row). This
// port follows the markdownlint engine
// (src/changesets/markdownlint/rules/dependency-table-format.ts; MIT,
// Copyright (c) 2026 Savvy Web Systems), and the golden test pins exactly
// which fixtures that choice moves. An example rule, not public API.

import type { TableRow } from "@effected/markdown";
import { Mdast } from "@effected/markdown";
import { LintRule } from "../../src/LintRule.js";
import { RULE_DOCS, VERSION_RE } from "./docs.js";

const EM_DASH = "—";
const VALID_TYPES = [
	"dependency",
	"devDependency",
	"peerDependency",
	"optionalDependency",
	"workspace",
	"config",
	"runtime",
	"packageManager",
];
const VALID_ACTIONS = ["added", "updated", "removed"];
const EXPECTED_HEADERS = ["dependency", "type", "action", "from", "to"];

const cellsOf = (row: TableRow): Array<string> => row.children.map((cell) => Mdast.toText(cell).trim());

export const DependencyTableFormat = LintRule.make({
	names: ["changeset-dependency-table-format", "CSH005"],
	description: "Dependencies section must contain a valid dependency table",
	tags: ["changeset"],
	check: (context, report) => {
		const children = context.root.children;
		children.forEach((node, index) => {
			if (node.type !== "heading" || node.depth !== 2) return;
			if (Mdast.toText(node).toLowerCase() !== "dependencies") return;

			let table: (typeof children)[number] | undefined;
			for (let next = index + 1; next < children.length; next++) {
				const candidate = children[next];
				if (candidate === undefined || candidate.type === "heading") break;
				if (candidate.type === "table") {
					table = candidate;
					break;
				}
			}
			if (table === undefined || table.type !== "table") {
				report(
					context.diagnostic({
						at: node,
						detail: `Dependencies section must contain a table, not a list or paragraph. See: ${RULE_DOCS.CSH005}`,
					}),
				);
				return;
			}

			const [header, ...rows] = table.children;
			if (header === undefined) {
				report(
					context.diagnostic({
						at: table,
						detail: `Dependencies table is missing a header row. See: ${RULE_DOCS.CSH005}`,
					}),
				);
				return;
			}
			const headers = cellsOf(header).map((cell) => cell.toLowerCase());
			if (
				headers.length !== EXPECTED_HEADERS.length ||
				!headers.every((cell, column) => cell === EXPECTED_HEADERS[column])
			) {
				report(
					context.diagnostic({
						at: header,
						detail: `Dependencies table must have columns: Dependency, Type, Action, From, To. Got: ${headers.join(", ")}. See: ${RULE_DOCS.CSH005}`,
					}),
				);
				return;
			}
			if (rows.length === 0) {
				report(
					context.diagnostic({
						at: table,
						detail: `Dependencies table must have at least one data row. See: ${RULE_DOCS.CSH005}`,
					}),
				);
				return;
			}

			for (const row of rows) {
				const cells = cellsOf(row);
				const at = (detail: string) => report(context.diagnostic({ at: row, detail }));
				if (cells.length < 5) {
					at(`Dependencies table row has too few columns (expected 5, got ${cells.length}). See: ${RULE_DOCS.CSH005}`);
					continue;
				}
				const [dependency = "", type = "", action = "", from = "", to = ""] = cells;
				if (dependency === "") at(`Dependencies table row has an empty 'Dependency' cell. See: ${RULE_DOCS.CSH005}`);
				if (!VALID_TYPES.includes(type)) {
					at(`Invalid dependency type '${type}'. Valid types are: ${VALID_TYPES.join(", ")}. See: ${RULE_DOCS.CSH005}`);
				}
				if (!VALID_ACTIONS.includes(action)) {
					at(
						`Invalid dependency action '${action}'. Valid actions are: ${VALID_ACTIONS.join(", ")}. See: ${RULE_DOCS.CSH005}`,
					);
				}
				if (from !== "" && !VERSION_RE.test(from)) {
					at(
						`Invalid 'from' value '${from}'. Must be a semver string or em dash (${EM_DASH}). See: ${RULE_DOCS.CSH005}`,
					);
				}
				if (to !== "" && !VERSION_RE.test(to)) {
					at(`Invalid 'to' value '${to}'. Must be a semver string or em dash (${EM_DASH}). See: ${RULE_DOCS.CSH005}`);
				}
				if (action === "added" && from !== EM_DASH) {
					at(`'from' must be '${EM_DASH}' when action is 'added' (got '${from}'). See: ${RULE_DOCS.CSH005}`);
				}
				if (action === "removed" && to !== EM_DASH) {
					at(`'to' must be '${EM_DASH}' when action is 'removed' (got '${to}'). See: ${RULE_DOCS.CSH005}`);
				}
			}
		});
	},
});
