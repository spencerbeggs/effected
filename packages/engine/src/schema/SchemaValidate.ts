// `effected schema validate`: does THIS payload conform to the published
// document it names? The schema reference resolves against the config's derived
// identities (`$id`, frozen `$id`/`url`, catalog `url`), so the payload's
// `$schema` names the local committed document and no network is involved. Each
// finding carries the payload file, line and column of the value it points at.

import type { JsoncNode } from "@effected/jsonc";
import { Jsonc } from "@effected/jsonc";
import type { InstanceValidatorError, SchemastoreConfig } from "@effected/schemastore";
import { InstanceValidator } from "@effected/schemastore";
import { LineIndex } from "@effected/source";
import type { PlatformError } from "effect";
import { Effect, FileSystem, JsonPointer, Option, Path, Predicate, Result, Schema } from "effect";
import { AjvInstanceValidator } from "./AjvInstanceValidator.js";
import type { ConfigLoadError, ConfigNotFoundError } from "./ConfigLoader.js";
import { ConfigLoader } from "./ConfigLoader.js";
import type { SchemaRunDeps } from "./SchemaRun.js";
import { VersionCheck, VersionMismatch, VersionMismatchError } from "./VersionCheck.js";

/**
 * The payload file could not be read or parsed: it does not exist, the
 * filesystem refused it, or its contents are not JSON. Nothing was validated.
 *
 * @public
 */
export class PayloadError extends Schema.TaggedError<PayloadError>()("PayloadError", {
	path: Schema.String,
	reason: Schema.String,
}) {
	override get message(): string {
		return `Failed to read payload ${this.path}: ${this.reason}`;
	}
}

/**
 * The payload names no schema and none was given, so there is nothing to
 * validate against. A usage error: the remedy is in how it was invoked.
 *
 * @public
 */
export class MissingSchemaRefError extends Schema.TaggedError<MissingSchemaRefError>()("MissingSchemaRefError", {
	path: Schema.String,
}) {
	override get message(): string {
		return `Payload ${this.path} has no "$schema" property; pass --schema <path|$id> to name the document to validate against.`;
	}
}

/**
 * The schema reference resolved to no readable document: it is neither an
 * existing file nor an identity any config schema derives (`$id`, a frozen
 * `$id`/`url`, a catalog `url`), or the document it names could not be read or
 * parsed.
 *
 * @public
 */
export class SchemaResolutionError extends Schema.TaggedError<SchemaResolutionError>()("SchemaResolutionError", {
	$ref: Schema.String,
	reason: Schema.String,
}) {
	override get message(): string {
		return `Failed to resolve schema "${this.$ref}": ${this.reason}`;
	}
}

/**
 * A place in a file. `line` and `column` are one-based, and `column` counts
 * UTF-16 code units, as an editor does.
 *
 * @public
 */
export class SourcePoint extends Schema.Class<SourcePoint>("SourcePoint")({
	file: Schema.String,
	line: Schema.Number,
	column: Schema.Number,
}) {}

/**
 * One way a payload fails its document, with where the offending value sits.
 *
 * @remarks
 * `location` is omitted when the payload's tree could not be built. A pointer
 * that does not resolve, such as a missing required property's parent chain
 * ending early, points at the deepest node that does.
 *
 * @public
 */
export class LocatedFinding extends Schema.Class<LocatedFinding>("LocatedFinding")({
	/** A JSON pointer into the payload; `""` is the root. */
	path: Schema.String,
	message: Schema.String,
	keyword: Schema.optionalKey(Schema.String),
	location: Schema.optionalKey(SourcePoint),
}) {}

/**
 * The answer to one `validate`. A payload that does not conform is
 * `valid: false`, an ordinary result.
 *
 * @public
 */
export class ValidateReport extends Schema.Class<ValidateReport>("ValidateReport")({
	/** The payload's resolved path. */
	payload: Schema.String,
	/** The schema reference that was resolved. */
	$ref: Schema.String,
	/** The resolved path of the document the payload was validated against. */
	source: Schema.String,
	valid: Schema.Boolean,
	findings: Schema.Array(LocatedFinding),
	/** Present when the config's values came from another `@effected/schemastore` and the run went on. */
	versionMismatch: Schema.optionalKey(VersionMismatch),
}) {}

/**
 * What one `validate` was asked to do.
 *
 * @public
 */
export interface SchemaValidateInput {
	/** The payload file, resolved against `cwd`. */
	readonly payload: string;
	/** An explicit config path; used only when the reference is an identity, not a file. */
	readonly config?: string;
	/** The document: a file path or a config-derived identity; absent, the payload's own `$schema`. */
	readonly schema?: string;
	/** `"fail"` refuses a version mismatch; `"warn"` runs and carries it on the report. */
	readonly versionMismatch: "fail" | "warn";
}

// A JSON file that could not be read or parsed. Internal plumbing: each call
// site re-marks it as the subject-specific public error.
class ReadJsonError extends Schema.TaggedError<ReadJsonError>()("ReadJsonError", {
	path: Schema.String,
	reason: Schema.String,
}) {}

// A leading BOM is not content: the editor counts no column for it, and
// `JSON.parse` refuses it. Dropped once, so every offset below agrees.
const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

const readText = (file: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return stripBom(
			yield* fs
				.readFileString(file)
				.pipe(Effect.mapError((cause) => new ReadJsonError({ path: file, reason: cause.message }))),
		);
	});

const parseJson = (file: string, text: string) =>
	Effect.try({
		try: () => JSON.parse(text) as unknown,
		catch: (cause) => new ReadJsonError({ path: file, reason: cause instanceof Error ? cause.message : String(cause) }),
	});

// Every identity a config schema derives, mapped to the local document that
// carries it. First registration wins; `defineConfig` already rejects two
// schemas deriving one output path.
const identityMap = (config: SchemastoreConfig): Map<string, { readonly name: string; readonly path: string }> => {
	const identities = new Map<string, { name: string; path: string }>();
	const add = (identity: string | undefined, name: string, path: string): void => {
		if (identity !== undefined && !identities.has(identity)) {
			identities.set(identity, { name, path });
		}
	};
	for (const schema of config.schemas) {
		add(schema.target.$id, schema.name, schema.target.path);
		for (const frozen of schema.frozen) {
			add(frozen.$id, schema.name, frozen.path);
			add(frozen.url, schema.name, frozen.path);
		}
		add(schema.catalog?.url, schema.name, schema.target.path);
	}
	return identities;
};

// The payload's own `$schema`: a string property on a JSON object. Anything
// else means "names nothing".
const schemaPropertyOf = (payload: unknown): string | undefined =>
	Predicate.isObject(payload) && typeof payload.$schema === "string" ? payload.$schema : undefined;

// Resolve one local `#/$defs/<name>` pointer against the document's pool,
// decoding the token the same way the kit's document lint decodes refs.
const defsTarget = (document: Record<string, unknown>, ref: string): Record<string, unknown> | undefined => {
	if (!ref.startsWith("#/")) {
		return undefined;
	}
	let name: string;
	try {
		const tokens = ref
			.slice(2)
			.split("/")
			.map((token) => JsonPointer.unescapeToken(decodeURIComponent(token)));
		if (tokens.length !== 2 || tokens[0] !== "$defs") {
			return undefined;
		}
		name = tokens[1] as string;
	} catch {
		return undefined;
	}
	const defs = document.$defs;
	if (!Predicate.isObject(defs) || !Object.hasOwn(defs, name)) {
		return undefined;
	}
	const entry = defs[name];
	return Predicate.isObject(entry) ? entry : undefined;
};

// Does the resolved document declare `$schema` as a root property? The
// HostedSchema pattern lets the source struct carry `$schema`, so the document
// lists it in `properties` and `required`. The declaring properties are not
// always on the literal root: a `Schema.Class` source emits a bare `$ref` root,
// an `identifier`-annotated struct emits `#/$defs/<Name>`, and a shared entry
// under `rootAnnotations` emits `allOf: [{ $ref }]`. Follow local `$defs`
// pointers and `allOf` members through a visited set.
const declaresSchemaProperty = (document: Record<string, unknown>): boolean => {
	const declares = (node: Record<string, unknown>): boolean => {
		const properties = node.properties;
		return Predicate.isObject(properties) && "$schema" in properties;
	};
	const seen = new Set<string>();
	const queue: Array<Record<string, unknown>> = [document];
	for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
		if (declares(node)) {
			return true;
		}
		if (typeof node.$ref === "string" && !seen.has(node.$ref)) {
			seen.add(node.$ref);
			const target = defsTarget(document, node.$ref);
			if (target !== undefined) {
				queue.push(target);
			}
		}
		if (Array.isArray(node.allOf)) {
			for (const member of node.allOf) {
				if (Predicate.isObject(member)) {
					queue.push(member);
				}
			}
		}
	}
	return false;
};

// The payload's `$schema` is the pointer this command consumed to find the
// document, not contract data, but only when the document does not declare
// `$schema` itself: a closed generated document would otherwise fail EVERY
// payload that names it. A document that declares it sees the payload verbatim.
const withoutSchemaRef = (payload: unknown, document: Record<string, unknown>): unknown => {
	if (schemaPropertyOf(payload) === undefined || declaresSchemaProperty(document)) {
		return payload;
	}
	const rest: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
	delete rest.$schema;
	return rest;
};

// The value node a pointer names, or the deepest node on the way to it. A
// property resolves to its value, so a type error points at the value itself.
// Duplicate keys resolve to the last, as `JSON.parse` does.
const nodeAt = (root: JsoncNode, pointer: string): JsoncNode => {
	if (pointer === "") {
		return root;
	}
	let current = root;
	for (const raw of pointer.slice(1).split("/")) {
		const token = JsonPointer.unescapeToken(raw);
		let next: JsoncNode | undefined;
		if (current.type === "object") {
			next = current.children?.findLast((child) => child.type === "property" && child.children?.[0]?.value === token)
				?.children?.[1];
		} else if (current.type === "array" && /^(0|[1-9]\d*)$/.test(token)) {
			next = current.children?.[Number(token)];
		}
		if (next === undefined) {
			return current;
		}
		current = next;
	}
	return current;
};

const locator = (file: string, text: string): ((pointer: string) => SourcePoint | undefined) | undefined => {
	const tree = Jsonc.parseTreeResult(text);
	if (Result.isFailure(tree) || Option.isNone(tree.success)) {
		return undefined;
	}
	const root = tree.success.value;
	const index = LineIndex.make(text);
	return (pointer) => {
		const { line, character } = index.positionAt(nodeAt(root, pointer).offset);
		return SourcePoint.make({ file, line: line + 1, column: character + 1 });
	};
};

/**
 * Validates one payload against a published schema document.
 *
 * @remarks
 * The reference (`schema`, else the payload's `$schema`) resolves file-first, then
 * against the config's derived identities, so only an identity loads the config
 * and only then is the version checked: `"fail"` refuses a mismatch and `"warn"`
 * carries it on the report. A `Started` event is told to `deps.onProgress` once
 * the config loads, carrying the mismatch, so a warn that is followed by a failure
 * can still be shown. A top-level string `$schema` on the payload is stripped
 * before validating unless the document declares it, and the rest goes verbatim.
 * Findings that do not conform are `valid: false`, never a failure. A leading BOM
 * is ignored, and `column` counts UTF-16 code units.
 *
 * @public
 */
export class SchemaValidate {
	private constructor() {}

	static readonly run: (
		input: SchemaValidateInput,
		deps: SchemaRunDeps,
	) => Effect.Effect<
		ValidateReport,
		| PayloadError
		| MissingSchemaRefError
		| SchemaResolutionError
		| ConfigNotFoundError
		| ConfigLoadError
		| VersionMismatchError
		| InstanceValidatorError
		| PlatformError.PlatformError,
		FileSystem.FileSystem | Path.Path
	> = Effect.fn("SchemaValidate.run")(function* (input: SchemaValidateInput, deps: SchemaRunDeps) {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const payloadPath = path.resolve(deps.cwd, input.payload);
		const text = yield* readText(payloadPath).pipe(
			Effect.catchTag("ReadJsonError", ({ reason }) => Effect.fail(new PayloadError({ path: payloadPath, reason }))),
		);
		const payload = yield* parseJson(payloadPath, text).pipe(
			Effect.catchTag("ReadJsonError", ({ reason }) => Effect.fail(new PayloadError({ path: payloadPath, reason }))),
		);
		const $ref = input.schema ?? schemaPropertyOf(payload);
		if ($ref === undefined) {
			return yield* new MissingSchemaRefError({ path: payloadPath });
		}
		const unresolved = (reason: string) => Effect.fail(new SchemaResolutionError({ $ref, reason }));

		let mismatch: Option.Option<VersionMismatch> = Option.none();
		let source: string;
		let parsed: unknown;
		const candidate = path.resolve(deps.cwd, $ref);
		if (yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))) {
			source = candidate;
			parsed = yield* readText(candidate).pipe(
				Effect.flatMap((documentText) => parseJson(candidate, documentText)),
				Effect.catchTag("ReadJsonError", ({ reason }) => unresolved(reason)),
			);
		} else {
			const loaded = yield* ConfigLoader.load({
				cwd: deps.cwd,
				...(input.config !== undefined ? { explicit: input.config } : {}),
				...(deps.importModule !== undefined ? { importModule: deps.importModule } : {}),
			});
			mismatch = VersionCheck.inspect(loaded.config);
			if (Option.isSome(mismatch) && input.versionMismatch === "fail") {
				const { tool, found, message } = mismatch.value;
				return yield* new VersionMismatchError({ tool, found, message });
			}
			yield* deps.onProgress?.({
				_tag: "Started",
				names: loaded.config.schemas.map((schema) => schema.name),
				...(Option.isSome(mismatch) ? { versionMismatch: mismatch.value } : {}),
			}) ?? Effect.void;
			const match = identityMap(loaded.config).get($ref);
			if (match === undefined) {
				return yield* unresolved("not an existing file, and no schema in the config derives this $id or url");
			}
			source = match.path;
			parsed = yield* readText(match.path).pipe(
				Effect.flatMap((documentText) => parseJson(match.path, documentText)),
				Effect.catchTag("ReadJsonError", ({ reason }) =>
					unresolved(`schema "${match.name}" resolves to ${match.path}, which ${reason}`),
				),
			);
		}
		if (!Predicate.isObject(parsed)) {
			return yield* unresolved(`${source} is not a JSON object`);
		}
		const document = parsed as Record<string, unknown>;
		const found = yield* Effect.gen(function* () {
			const validator = yield* InstanceValidator;
			return yield* validator.validate(document, withoutSchemaRef(payload, document));
		}).pipe(Effect.provide(deps.instanceValidator ?? AjvInstanceValidator.layer));
		const locate = locator(payloadPath, text);
		return ValidateReport.make({
			payload: payloadPath,
			$ref,
			source,
			valid: found.length === 0,
			findings: found.map((finding) => {
				const location = locate?.(finding.path);
				return LocatedFinding.make({
					path: finding.path,
					message: finding.message,
					...(finding.keyword !== undefined ? { keyword: finding.keyword } : {}),
					...(location !== undefined ? { location } : {}),
				});
			}),
			...(Option.isSome(mismatch) ? { versionMismatch: mismatch.value } : {}),
		});
	});
}
