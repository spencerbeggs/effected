import { Option, Order, Schema } from "effect";

/**
 * A git release as `major.minor.patch`, parsed from `git version` output.
 *
 * @remarks
 * Vendor suffixes (`(Apple Git-154)`, `.windows.1`) and any further numeric
 * components are ignored: only the first three dot-separated numbers count.
 *
 * @public
 */
export class GitVersion extends Schema.Class<GitVersion>("GitVersion")({
	major: Schema.Int,
	minor: Schema.Int,
	patch: Schema.Int,
}) {
	/**
	 * Parses the output of `git version` (`git version 2.56.0`,
	 * `git version 2.39.5 (Apple Git-154)`, `git version 2.47.1.windows.1`).
	 * `Option.none()` when the text is not a git version line.
	 */
	static readonly parse = (output: string): Option.Option<GitVersion> => {
		const prefix = "git version ";
		const line = output.trim().split("\n")[0]?.trim() ?? "";
		if (!line.startsWith(prefix)) {
			return Option.none();
		}
		const token = line.slice(prefix.length).trim().split(" ")[0] ?? "";
		const parts = token.split(".");
		const numbers: Array<number> = [];
		for (const part of parts.slice(0, 3)) {
			if (part === "" || !/^[0-9]+$/.test(part)) {
				break;
			}
			numbers.push(Number(part));
		}
		const [major, minor, patch] = numbers;
		if (major === undefined || minor === undefined) {
			return Option.none();
		}
		return Option.some(new GitVersion({ major, minor, patch: patch ?? 0 }));
	};

	/** Orders versions by major, then minor, then patch. */
	static readonly compare: Order.Order<GitVersion> = Order.combine(
		Order.mapInput(Order.Number, (v: GitVersion) => v.major),
		Order.combine(
			Order.mapInput(Order.Number, (v: GitVersion) => v.minor),
			Order.mapInput(Order.Number, (v: GitVersion) => v.patch),
		),
	);

	/** Whether `version` is the same as or newer than `floor`. */
	static readonly atLeast = (version: GitVersion, floor: GitVersion): boolean =>
		GitVersion.compare(version, floor) >= 0;

	override toString(): string {
		return `${this.major}.${this.minor}.${this.patch}`;
	}
}
