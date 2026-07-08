// Block/flow scalar folding helpers: rendering multi-line string values as
// block-literal (`|`), block-folded (`>`) and fold-encoded single-quoted
// scalars, plus the whitespace analyses that decide when block styles cannot
// represent a value faithfully.

/**
 * C0 control characters (except TAB) that must be escaped in double-quoted scalars.
 */
export function isControlChar(code: number): boolean {
	return (code >= 0x00 && code <= 0x08) || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f);
}

/**
 * Returns true when the value has whitespace immediately before a newline AND
 * the value contains a non-trailing newline. Equivalent to the regex pair
 * `/[\t ]\n/.test(s) && s.replace(/\n+$/, "").includes("\n")` but uses linear
 * imperative scans to avoid polynomial-time regex behaviour on adversarial
 * inputs containing many trailing newlines.
 */
export function hasInteriorTrailingWhitespace(s: string): boolean {
	let firstWsBeforeNl = -1;
	for (let i = 1; i < s.length; i++) {
		if (s.charCodeAt(i) === 0x0a) {
			const prev = s.charCodeAt(i - 1);
			if (prev === 0x20 || prev === 0x09) {
				firstWsBeforeNl = i;
				break;
			}
		}
	}
	if (firstWsBeforeNl < 0) return false;
	let trailingStart = s.length;
	while (trailingStart > 0 && s.charCodeAt(trailingStart - 1) === 0x0a) trailingStart--;
	// Confirm the whitespace-before-newline is not purely in the trailing newline
	// block. If firstWsBeforeNl >= trailingStart the whitespace sits on the last
	// content line only, which block style handles correctly via the chomp
	// indicator — only an INTERIOR newline followed by content matters here.
	for (let i = 0; i < trailingStart; i++) {
		if (s.charCodeAt(i) === 0x0a) return true;
	}
	return false;
}

/**
 * Returns true when the value contains a newline followed by one or more
 * spaces and then a tab — mixed leading whitespace on a continuation line
 * that block style cannot represent unambiguously.
 */
export function hasNewlineSpacesTab(s: string): boolean {
	for (let i = 0; i < s.length - 2; i++) {
		if (s.charCodeAt(i) !== 0x0a) continue;
		let j = i + 1;
		while (j < s.length && s.charCodeAt(j) === 0x20) j++;
		if (j > i + 1 && j < s.length && s.charCodeAt(j) === 0x09) return true;
	}
	return false;
}

/**
 * Renders a multi-line value as a single-quoted scalar with proper fold encoding.
 *
 * Single-quoted scalars use line folding rules (YAML 1.2 §7.4): bare newlines
 * between non-empty lines fold to a space; empty lines preserve as literal
 * newlines. To round-trip a value with N consecutive literal newlines, the
 * source needs N+1 consecutive source newlines (i.e., one extra to account
 * for the bare newline that would otherwise fold to a space).
 *
 * Continuation lines are prefixed with the given indent. Leading whitespace
 * on continuation lines after the indent is preserved as part of the content
 * because empty lines precede them, suppressing the fold-to-space rule.
 *
 * Returns null if the content cannot safely be represented as single-quoted
 * (carriage returns or non-tab control characters).
 */
export function renderSingleQuotedMultiline(s: string, indent: string): string | null {
	// CR or non-tab control chars cannot be represented in single-quoted
	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i);
		if (code === 0x0d || isControlChar(code)) return null;
	}
	const escaped = s.replace(/'/g, "''");
	let result = "";
	let i = 0;
	let firstSegment = true;
	while (i < escaped.length) {
		let segEnd = i;
		while (segEnd < escaped.length && escaped[segEnd] !== "\n") segEnd++;
		const segment = escaped.slice(i, segEnd);
		if (firstSegment) {
			result += segment;
			firstSegment = false;
		} else {
			result += `${indent}${segment}`;
		}
		i = segEnd;
		let nlEnd = i;
		while (nlEnd < escaped.length && escaped[nlEnd] === "\n") nlEnd++;
		const nlCount = nlEnd - i;
		if (nlCount > 0) {
			// Each literal newline in value requires one extra source newline
			result += "\n".repeat(nlCount + 1);
		}
		i = nlEnd;
	}
	return `'${result}'`;
}

/**
 * Renders a string scalar using block literal style (pipe `|`).
 *
 * @param explicitChomp - Original chomp indicator from the AST, when known.
 * `keep` (`+`) and `strip` (`-`) preserve trailing-newline semantics that
 * cannot be inferred from the resolved value alone.
 */
export function renderBlockLiteral(
	s: string,
	indent: string,
	explicitChomp?: "strip" | "clip" | "keep",
	parentPosition?: "block-map-value" | "block-seq-item",
): string {
	// Compute chomp indicator from the value's trailing-newline structure.
	// `+` (keep) is required when the value retains more than one trailing
	// newline OR when the value consists solely of newlines (otherwise `|`
	// with empty content would parse as the empty string, losing the trailing
	// newline). `-` (strip) is required when the value has no trailing
	// newline. Default (clip `|`) preserves exactly one trailing newline.
	let chomp = "";
	const onlyNewlines = s.length > 0 && /^\n+$/.test(s);
	if (s.endsWith("\n\n") || (onlyNewlines && explicitChomp === "keep")) {
		chomp = "+";
	} else if (!s.endsWith("\n")) {
		chomp = "-";
	}
	const lines = s.split("\n");
	// If the string ends with \n, the last element is empty — drop it for rendering
	if (s.endsWith("\n")) {
		lines.pop();
	}
	// Explicit indent indicator needed when:
	// - First content line starts with space (reader would misdetect indent)
	// - Value starts with empty lines AND has actual content (reader can't
	//   auto-detect indent from leading blanks).
	// - Newline-only body with keep-chomp under a block-map value (K858):
	//   libyaml's canonical emitter emits `|2+` here since the parent's value
	//   indent is already established by sibling pairs and the empty body is
	//   ambiguous without an explicit indicator. Block-seq items (JEF9) do
	//   not get the indicator — there the `-` already anchors the entry.
	let indentIndicator = "";
	const firstContent = lines.find((l) => l !== "");
	const hasContent = firstContent !== undefined;
	if (firstContent?.startsWith(" ") || (lines.length > 0 && lines[0] === "" && hasContent)) {
		indentIndicator = String(indent.length);
	} else if (!hasContent && chomp === "+" && parentPosition === "block-map-value" && indent.length > 0) {
		indentIndicator = String(indent.length);
	}
	return `|${indentIndicator}${chomp}\n${lines.map((l) => (l === "" ? "" : `${indent}${l}`)).join("\n")}`;
}

/**
 * Renders a string scalar using block folded style (greater-than `>`).
 *
 * In folded block scalars, a single newline between content lines is folded
 * into a space by the reader. To preserve a literal newline in the value,
 * the output must contain an empty line (double newline). Each empty line
 * in the value already produces the correct number of blank lines.
 */
export function renderBlockFolded(s: string, indent: string): string {
	let chomp = "";
	if (s.endsWith("\n\n")) {
		chomp = "+";
	} else if (!s.endsWith("\n")) {
		chomp = "-";
	}

	// Split the value into lines and build folded output.
	// In folded scalars, the reader folds bare newlines between same-indent
	// content lines into spaces. To preserve a literal \n in the value:
	// - Between two "normal" (non-indented) lines → insert empty line
	// - Before a "more-indented" line (starts with space/tab) → no extra line
	//   needed, the reader preserves newlines before more-indented lines
	// - Empty lines in the value → emit as-is (already preserved by reader)
	const valueLines = s.split("\n");
	if (s.endsWith("\n")) {
		valueLines.pop();
	}

	// Explicit indent indicator needed when first content line starts with
	// space, or when the value starts with two-or-more empty lines and has
	// actual content. A single leading blank line is fine without the
	// indicator because the next non-empty content line still establishes
	// the indent, but multiple leading blanks introduce enough ambiguity
	// that libyaml's canonical form emits the explicit indicator.
	let indentIndicator = "";
	const firstContent = valueLines.find((l) => l !== "");
	if (
		firstContent?.startsWith(" ") ||
		(valueLines.length >= 2 && valueLines[0] === "" && valueLines[1] === "" && firstContent !== undefined)
	) {
		indentIndicator = String(indent.length);
	}

	// Build folded output from the resolved value lines.
	//
	// Folded scalar reading rules (YAML 1.2 §8.2.1):
	// - Bare newline between same-indent content lines → folded to space
	// - Empty line (blank line) → preserves the newline
	// - The line break BEFORE an empty line or more-indented line is also
	//   preserved (not folded)
	//
	// To reverse this for rendering:
	// - Between consecutive non-empty, non-more-indented lines: insert an
	//   empty line (prevents the reader from folding to space)
	// - When a non-empty line is followed by empty line(s): the line break
	//   after the content is preserved by the reader, so we need an extra
	//   empty line in the output to account for it
	const outputLines: string[] = [];
	let prevNonEmpty = false;
	let prevMoreIndented = false;
	for (let i = 0; i < valueLines.length; i++) {
		const line = valueLines[i];
		if (line === "") {
			// If the previous line was non-empty, non-more-indented content,
			// the \n after it is preserved (not folded) because it's followed
			// by an empty line. Emit an extra empty line for that preserved \n.
			// Exception: if the next non-empty content is more-indented, the
			// reader already preserves the linebreak, so skip the extra line.
			if (prevNonEmpty && !prevMoreIndented) {
				// Look ahead to find the next non-empty line
				let nextContentMoreIndented = false;
				for (let j = i + 1; j < valueLines.length; j++) {
					if (valueLines[j] !== "") {
						nextContentMoreIndented = valueLines[j].startsWith(" ") || valueLines[j].startsWith("\t");
						break;
					}
				}
				if (!nextContentMoreIndented) {
					outputLines.push("");
				}
			}
			outputLines.push("");
			prevNonEmpty = false;
			prevMoreIndented = false;
		} else {
			const isMoreIndented = line.startsWith(" ") || line.startsWith("\t");
			if (prevNonEmpty && !isMoreIndented) {
				// Fold break: insert empty line between consecutive content lines
				outputLines.push("");
			}
			outputLines.push(`${indent}${line}`);
			prevNonEmpty = true;
			prevMoreIndented = isMoreIndented;
		}
	}

	return `>${indentIndicator}${chomp}\n${outputLines.join("\n")}`;
}
