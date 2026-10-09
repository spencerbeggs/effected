/** A lowercase hex SHA-256 digest: the shape of every image cache key, and the only name a directory backend writes. */
export const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
