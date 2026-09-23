#!/usr/bin/env node
// Hand-written for McpProcess.test.ts and McpProbe.test.ts; see README.md.
const flags = new Set(process.argv.slice(2));
const delayFlag = process.argv.find((arg) => arg.startsWith("--delay-ms="));
const delay = delayFlag === undefined ? 0 : Number(delayFlag.slice("--delay-ms=".length));
let frames = 0;
const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

if (flags.has("--noise")) process.stdout.write("this line is not json-rpc\n");

let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffered += chunk;
	let newline = buffered.indexOf("\n");
	while (newline !== -1) {
		const line = buffered.slice(0, newline);
		buffered = buffered.slice(newline + 1);
		if (line.trim() !== "") handle(JSON.parse(line));
		newline = buffered.indexOf("\n");
	}
});
process.stdin.on("end", () => {
	if (flags.has("--count-on-end")) write({ jsonrpc: "2.0", method: "count", params: { frames } });
	process.exit(0);
});

function handle(message) {
	frames++;
	if (flags.has("--exit-early")) {
		process.stderr.write("fatal: config missing\n");
		process.exit(3);
	}
	if (message.id === undefined) return;
	const respond = () => {
		if (message.method === "initialize") {
			write({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
			write({
				jsonrpc: "2.0",
				id: message.id,
				result: {
					protocolVersion: message.params?.protocolVersion ?? "2025-11-25",
					capabilities: { tools: {} },
					serverInfo: { name: "fake", version: "0.0.0" },
				},
			});
		} else if (message.method === "server/discover") {
			write({
				jsonrpc: "2.0",
				id: message.id,
				result: { supportedVersions: ["2026-07-28"], capabilities: {}, serverInfo: { name: "fake", version: "0.0.0" } },
			});
		} else {
			write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
		}
	};
	if (delay > 0) setTimeout(respond, delay);
	else respond();
}
