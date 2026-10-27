// CliUi.routeStream's Node shell: a real Writable, the original's terminal facts delegated, the printer fed.
import { Writable } from "node:stream";
import { assert, describe, it } from "@effect/vitest";
import { CliUi } from "../../src/ui.js";

const sink = (extra: Record<string, unknown> = {}) => {
	const chunks: Array<string> = [];
	const stream = new Writable({
		write(chunk: Buffer | string, _encoding, callback) {
			chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
			callback();
		},
	});
	Object.assign(stream, extra);
	return { stream, text: () => chunks.join("") };
};

const ended = (writable: Writable): Promise<void> =>
	new Promise((resolve, reject) => {
		writable.end((error?: Error | null) => (error ? reject(error) : resolve()));
	});

describe("CliUi.routeStream", () => {
	it("routes whole lines to the printer and the declined ones to the original", async () => {
		const original = sink();
		const printed: Array<string> = [];
		let mounted = true;
		const routed = CliUi.routeStream(original.stream, (_stream, line) => mounted && printed.push(line) > 0, {
			stream: "stdout",
		});
		routed.writable.write("above\npart");
		mounted = false;
		routed.writable.write("ial\n");
		routed.writable.write(Buffer.from("bytes\n"));
		await ended(routed.writable);
		assert.deepStrictEqual(printed, ["above"]);
		assert.strictEqual(original.text(), "partial\nbytes\n");
	});

	it("end() flushes a last line with no line break: to the printer, or to the original when it declines", async () => {
		const printed: Array<string> = [];
		const routed = CliUi.routeStream(sink().stream, (_s, line) => printed.push(line) > 0, { stream: "stderr" });
		routed.writable.write("first\nlast words");
		await ended(routed.writable);
		assert.deepStrictEqual(printed, ["first", "last words"]);
		const original = sink();
		const declined = CliUi.routeStream(original.stream, () => false, { stream: "stderr" });
		declined.writable.write("no newline");
		await ended(declined.writable);
		assert.strictEqual(original.text(), "no newline");
	});

	it("delegates the original's terminal facts, and only those it has", () => {
		const tty = sink({ isTTY: true, columns: 120, getColorDepth: () => 24 });
		const routed = CliUi.routeStream(tty.stream, () => false, { stream: "stderr" });
		const writable = routed.writable as unknown as Record<string, unknown>;
		assert.strictEqual(writable.isTTY, true);
		assert.strictEqual(writable.columns, 120);
		assert.strictEqual((writable.getColorDepth as () => number)(), 24);
		assert.isFalse("rows" in routed.writable, "the original has no rows, so the routed stream claims none");
		Object.assign(tty.stream, { columns: 90 });
		assert.strictEqual(writable.columns, 90, "read live, not copied");
	});

	it("passes an escape-only write through to the original as written", async () => {
		const original = sink();
		const printed: Array<string> = [];
		const routed = CliUi.routeStream(original.stream, (_s, line) => printed.push(line) > 0, { stream: "stdout" });
		routed.writable.write("\u001b[?25l");
		await ended(routed.writable);
		assert.strictEqual(original.text(), "\u001b[?25l");
		assert.deepStrictEqual(printed, []);
	});

	it("fails the write when the printer throws", async () => {
		const original = sink();
		const routed = CliUi.routeStream(
			original.stream,
			() => {
				throw new Error("printer broke");
			},
			{ stream: "stdout" },
		);
		const failed = new Promise<Error>((resolve) => routed.writable.once("error", resolve));
		routed.writable.write("x\n");
		assert.strictEqual((await failed).message, "printer broke");
	});

	it("refuses a maxHeld that is not a non-negative integer", () => {
		const original = sink();
		assert.throws(() => CliUi.routeStream(original.stream, () => false, { stream: "stdout", maxHeld: -1 }), RangeError);
		assert.throws(
			() => CliUi.routeStream(original.stream, () => false, { stream: "stdout", maxHeld: 1.5 }),
			RangeError,
		);
	});
});
