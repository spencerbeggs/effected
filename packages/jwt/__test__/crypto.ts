// Core's `Signature` service over WebCrypto, which every signing and
// verifying path in this package requires.
import { Layer } from "effect";
import { SecureRandom, Signature } from "effect/crypto";

export const CryptoLive: Layer.Layer<Signature.Signature> = Signature.layerWebCrypto.pipe(
	Layer.provide(SecureRandom.layerWebCrypto),
);
