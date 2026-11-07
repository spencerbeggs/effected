// Records every text systems' parse helpers receive, then delegates.
const target = decodeURIComponent(new URL(import.meta.url).searchParams.get("target"));
const real = await import(`${target}?real`);
const record = (via, text) =>
	globalThis.__records.push({ via, text, file: globalThis.__currentFile, test: globalThis.__currentTest });

export const emitKitMarkdown = real.emitKitMarkdown;
export function parseKitMarkdown(text) {
	record("parseKitMarkdown", text);
	return real.parseKitMarkdown(text);
}
export function parseKitMarkdownBody(text) {
	record("parseKitMarkdownBody", text);
	return real.parseKitMarkdownBody(text);
}
