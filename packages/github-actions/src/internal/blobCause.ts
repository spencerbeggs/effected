// The signed blob url, with its credential fields redacted, for keeping on a
// failure.
//
// The results backend hands back a shared-access-signature url: `sig` and the
// user-delegation fields in its query are credentials, and a url is never
// logged, annotated on a span or carried on an error unredacted.

import { HttpRedaction } from "@effected/crypto";
import { UrlParams } from "effect/http";

// The shared-access-signature fields that sign, scope or identify: the
// signature itself, the expiry and start, the permissions, and the user
// delegation key's object, tenant and validity. `sv`, `sr`, `spr`, `sks` and
// `skv` stay, because they are what tells a human which kind of url it was.
const SAS_NAMES: ReadonlyArray<string> = [
	"sig",
	"se",
	"st",
	"sp",
	"sip",
	"skoid",
	"sktid",
	"skt",
	"ske",
	"saoid",
	"suoid",
	"scid",
];

/** A signed blob url with its SAS credential fields and userinfo redacted. */
export const blobUrl = (raw: string): string => UrlParams.redactUrl(HttpRedaction.url(raw), SAS_NAMES);
