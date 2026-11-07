// Just enough of vitest to run systems' rule tests for their inputs: every
// test body runs (assertions are inert), with beforeEach/afterEach honoured.
const stack = [{ before: [], after: [] }];
const queue = [];
const inert = new Proxy(() => {}, { get: (_target, key) => (key === "then" ? undefined : inert), apply: () => inert });

export const expect = inert;
export const vi = inert;
export function describe(_name, body) {
	stack.push({ before: [], after: [] });
	body();
	stack.pop();
}
export function beforeEach(hook) {
	stack[stack.length - 1].before.push(hook);
}
export function afterEach(hook) {
	stack[stack.length - 1].after.push(hook);
}
export function it(name, body) {
	const before = stack.flatMap((scope) => scope.before);
	const after = stack.flatMap((scope) => scope.after);
	const file = globalThis.__currentFile;
	queue.push({
		name,
		file,
		run: async () => {
			for (const hook of before) await hook();
			try {
				await body();
			} catch {
				// Assertions are inert; a throwing body still recorded its input.
			} finally {
				for (const hook of after) await hook();
			}
		},
	});
}
export const test = it;
export async function drain() {
	while (queue.length > 0) {
		const next = queue.shift();
		globalThis.__currentTest = next.name;
		globalThis.__currentFile = next.file;
		await next.run();
	}
}
