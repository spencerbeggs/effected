// A long-running bin for CliTest.spawn: it follows until SIGINT, as a `logs --follow` does.
// `chatty` first writes far more to stderr than an OS pipe buffers, and starts following
// only once that write has been taken off its hands, so its first stdout line arrives only
// when the harness drains the stream nobody reads.
const follow = () => {
	process.stdout.write("following\r\n");
	process.stdout.write("tick 1\n");
	const timer = setInterval(() => process.stdout.write("tick\n"), 1000);
	process.on("SIGINT", () => {
		clearInterval(timer);
		process.stdout.write("stopped", () => process.exit(0));
	});
};
if (process.argv[2] === "chatty") process.stderr.write(`${"x".repeat(1023)}\n`.repeat(512), follow);
else follow();
