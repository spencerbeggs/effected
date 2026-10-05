#!/usr/bin/env node
// Hand-written for LspProbe.test.ts and LspProcess.test.ts; see README.md. Deliberately shares no code
// with src/: its Content-Length parser and writer are its own, so a framing bug
// in LspFrame cannot agree with itself here.
const flags = new Set(process.argv.slice(2));
const received = [];
let initialized = false;
let shutdown = false;
let buffered = Buffer.alloc(0);

const write = (message) => {
	const body = Buffer.from(JSON.stringify(message), "utf8");
	const frame = Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
	if (!flags.has("--split")) return void process.stdout.write(frame);
	// Three bytes at a time, so headers, bodies and multi-byte characters straddle writes.
	for (let i = 0; i < frame.length; i += 3) process.stdout.write(frame.subarray(i, i + 3));
};

if (flags.has("--noise")) process.stdout.write("server starting\n");

process.stdin.on("data", (chunk) => {
	buffered = Buffer.concat([buffered, chunk]);
	while (true) {
		const end = buffered.indexOf("\r\n\r\n");
		if (end === -1) return;
		const match = /Content-Length: (\d+)/i.exec(buffered.subarray(0, end).toString("ascii"));
		if (match === null) {
			process.stderr.write("fake-lsp: frame without Content-Length\n");
			process.exit(2);
		}
		const length = Number(match[1]);
		if (buffered.length < end + 4 + length) return;
		const message = JSON.parse(buffered.subarray(end + 4, end + 4 + length).toString("utf8"));
		buffered = buffered.subarray(end + 4 + length);
		handle(message);
	}
});
// Only --ignore-exit stops at EOF; every other mode exits on `exit` alone.
process.stdin.on("end", () => {
	if (flags.has("--ignore-exit")) process.exit(0);
});

function handle(message) {
	received.push(message.method);
	if (flags.has("--exit-early")) {
		process.stderr.write("fatal: config missing\n");
		process.exit(3);
	}
	if (flags.has("--never-answer")) return;
	switch (message.method) {
		case "initialize":
			if (flags.has("--truncate")) {
				// Half a frame, then exit: the stream ends inside it.
				process.stdout.write("Content-Length: 40\r\n\r\n{\"jsonrpc\":", () => process.exit(4));
				return;
			}
			if (flags.has("--not-jsonrpc")) {
				write([1, 2, 3]);
				return;
			}
			if (flags.has("--fail-initialize")) {
				write({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: "cannot initialize" } });
				return;
			}
			write({ jsonrpc: "2.0", method: "window/logMessage", params: { type: 3, message: "booting ✓" } });
			write({
				jsonrpc: "2.0",
				id: message.id,
				result: {
					capabilities: { textDocumentSync: 1 },
					// Multi-byte on purpose: a char-counted Content-Length is wrong by four bytes here.
					serverInfo: { name: "fake-lsp ✓ 🚀", version: "0.0.0" },
					echoed: message.params,
				},
			});
			if (flags.has("--noise-between")) process.stdout.write("stray between frames\n");
			return;
		case "initialized":
			initialized = true;
			// A report on a later tick than any response, for stderrUntil.
			if (flags.has("--stderr-late")) setTimeout(() => process.stderr.write("late report\n"), 200);
			// A server-to-client request the probe must record and never answer.
			write({ jsonrpc: "2.0", id: "register-1", method: "client/registerCapability", params: { registrations: [] } });
			return;
		case "shutdown":
			write({ jsonrpc: "2.0", method: "fixture/received", params: { methods: [...received] } });
			if (!initialized && !flags.has("--fail-initialize")) {
				write({ jsonrpc: "2.0", id: message.id, error: { code: -32002, message: "server not initialized" } });
				return;
			}
			shutdown = true;
			write({ jsonrpc: "2.0", id: message.id, result: null });
			return;
		case "exit":
			if (flags.has("--ignore-exit")) return;
			if (flags.has("--noise-after")) {
				process.stdout.write("bye\n", () => process.exit(shutdown ? 0 : 1));
				return;
			}
			process.exit(shutdown ? 0 : 1);
	}
}
