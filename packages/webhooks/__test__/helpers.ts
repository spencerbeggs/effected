import { createHmac } from "node:crypto";
import { DateTime, Option, Redacted } from "effect";
import type { WebhookRequest } from "../src/WebhookRequest.js";

/** UTF-8 bytes of a string. */
export const bytes = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "utf8"));

/** A request over a plain header record, looked up case-insensitively as an HTTP server would. */
export const request = (
	headers: Readonly<Record<string, string>>,
	body: Uint8Array,
	secret: string,
	receivedAt: number,
): WebhookRequest => {
	const lower = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
	return {
		header: (name) => Option.fromUndefinedOr(lower.get(name.toLowerCase())),
		body,
		receivedAt: DateTime.makeUnsafe(receivedAt),
		secret: Redacted.make(secret),
	};
};

/** An HMAC-SHA256 over `parts` concatenated, computed with node:crypto, never the code under test. */
export const hmac = (
	key: string | Uint8Array,
	parts: ReadonlyArray<string | Uint8Array>,
	encoding: "hex" | "base64" | "base64url",
): string => {
	const mac = createHmac("sha256", key);
	for (const part of parts) mac.update(part);
	return mac.digest(encoding);
};
