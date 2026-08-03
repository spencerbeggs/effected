import { assert, describe, it } from "@effect/vitest";
import type { DateTime, Schema as SchemaNs } from "effect";
import { Schema } from "effect";
import type {
	Envelope as EnvelopeType,
	EnvelopeUnion,
	EnvelopeWithTag,
	JsonlEvent as JsonlEventType,
} from "../src/index.js";
import { Envelope, JsonlEvent } from "../src/index.js";

/**
 * The assertions in this file are COMPILE-TIME. `types:check` is what runs
 * them; the single runtime test at the bottom exists so the file registers as
 * a test and its failure mode is visible in the suite rather than only in the
 * build. A `@ts-expect-error` that stops erroring FAILS the typecheck, so each
 * one is a live assertion, not a comment.
 */

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <_Expected extends true>(): void => {};

// ── the registry under test ─────────────────────────────────────────────────

const MailReceived = JsonlEvent.make("mail-received", {
	data: Schema.Struct({ round: Schema.Number, from: Schema.String }),
});
const Unlinked = JsonlEvent.make("unlinked", { data: Schema.Void, terminal: true });
const Relinked = JsonlEvent.make("relinked", { data: Schema.Struct({ reason: Schema.String }), reopen: true });
const registry = [MailReceived, Unlinked, Relinked] as const;
type Registry = typeof registry;

// ── the DataSchema bound: a service-requiring payload must fail AT make ─────

interface SomeService {
	readonly _: unique symbol;
}
/** A payload schema that needs a service to decode — the thing the bound forbids. */
declare const NeedsAService: SchemaNs.Codec<number, string, SomeService, never>;

/** Never called; it exists so the `@ts-expect-error` below is type-checked. */
const boundIsLoadBearing = (): void => {
	// @ts-expect-error — a payload schema requiring services must be rejected at
	// REGISTRATION. If this line ever stops erroring, the DataSchema bound has
	// silently stopped binding and the sync core's no-runtime guarantee is gone.
	JsonlEvent.make("needs-a-service", { data: NeedsAService });
};

// ── the derived union ───────────────────────────────────────────────────────

assertType<
	Equals<
		EnvelopeUnion<Registry>,
		| EnvelopeType<"mail-received", { readonly round: number; readonly from: string }>
		| EnvelopeType<"unlinked", void>
		| EnvelopeType<"relinked", { readonly reason: string }>
	>
>();

assertType<Equals<JsonlEventType.Tag<Registry>, "mail-received" | "unlinked" | "relinked">>();
assertType<Equals<JsonlEventType.Data<Registry, "mail-received">, { readonly round: number; readonly from: string }>>();
assertType<Equals<JsonlEventType.Data<Registry, "unlinked">, void>>();

// terminal / reopen survive onto the derived types
assertType<Equals<JsonlEventType.TerminalTags<Registry>, "unlinked">>();
assertType<Equals<JsonlEventType.ReopenTags<Registry>, "relinked">>();

assertType<
	Equals<
		EnvelopeWithTag<Registry, "mail-received">,
		EnvelopeType<"mail-received", { readonly round: number; readonly from: string }>
	>
>();

// ── encodeResult is typed per tag ───────────────────────────────────────────

declare const at: DateTime.Utc;

const encodeIsTyped = (): void => {
	// @ts-expect-error — the payload must match the schema registered for the tag.
	Envelope.encodeResult(registry, { event: "mail-received", data: { round: "seven", from: "x" }, at });

	// @ts-expect-error — the tag must be one the registry defines.
	Envelope.encodeResult(registry, { event: "not-in-registry", data: undefined, at });

	// @ts-expect-error — a payload belonging to a DIFFERENT tag is rejected.
	Envelope.encodeResult(registry, { event: "relinked", data: { round: 1, from: "x" }, at });
};

describe("Envelope type-level contract", () => {
	it("is enforced by types:check, not by this assertion", () => {
		// The real assertions above are compile-time. This body only proves the
		// module loaded; if the type contract broke, `types:check` goes red and the
		// build gate fails before this ever runs.
		assert.isFunction(boundIsLoadBearing);
		assert.isFunction(encodeIsTyped);
		assert.isFunction(assertType);
	});
});

// ── P4: typed narrowing on the read surfaces ────────────────────────────────
//
// Runtime filtering and type narrowing are different properties: a surface can
// filter correctly while typing its stream as the full union, and every runtime
// test would still pass. These assertions are the only thing that catches that.

declare const readJournal: import("../src/index.js").JournalShape<Registry>;

/**
 * Never called — it exists so the assertions inside are type-checked without
 * evaluating `readJournal`, which is a `declare const` and does not exist at
 * runtime. Written at top level, these expressions threw on import.
 */
const readSurfacesAreNarrowed = (): void => {
	const narrowedQuery = readJournal.query({ events: ["mail-received"] });
	assertType<
		Equals<
			import("effect").Stream.Success<typeof narrowedQuery>,
			EnvelopeType<"mail-received", { readonly round: number; readonly from: string }>
		>
	>();

	const narrowedChanges = readJournal.changes({ events: ["unlinked"] });
	assertType<Equals<import("effect").Stream.Success<typeof narrowedChanges>, EnvelopeType<"unlinked", void>>>();

	const twoTags = readJournal.changes({ events: ["mail-received", "relinked"] });
	assertType<
		Equals<
			import("effect").Stream.Success<typeof twoTags>,
			| EnvelopeType<"mail-received", { readonly round: number; readonly from: string }>
			| EnvelopeType<"relinked", { readonly reason: string }>
		>
	>();

	// Omitting the slice — or omitting `events` — yields the FULL union.
	const unsliced = readJournal.query();
	assertType<Equals<import("effect").Stream.Success<typeof unsliced>, EnvelopeUnion<Registry>>>();
	const scopedOnly = readJournal.changes({ scopes: ["mailbox-a"] });
	assertType<Equals<import("effect").Stream.Success<typeof scopedOnly>, EnvelopeUnion<Registry>>>();

	// A projection over a slice sees only that slice's variants.
	const projected = readJournal.projection(0, (total, envelope) => total + envelope.data.round, {
		events: ["mail-received"],
	});
	assertType<Equals<import("effect").Stream.Success<typeof projected>, number>>();
};
void readSurfacesAreNarrowed;
