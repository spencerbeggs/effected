// The one JSON-text decoder the package's untyped reads share: the event
// payload and JSON-valued action inputs. Each caller maps the `SchemaError` to
// its own error.

import { Schema } from "effect";

/**
 * Parse JSON text to an unknown value, failing with a `SchemaError` on text that is not JSON.
 *
 * @internal
 */
export const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
