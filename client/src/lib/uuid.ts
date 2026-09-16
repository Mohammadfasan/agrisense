import { v4 as uuidV4 } from 'uuid';

/**
 * A UUID v4, for the identifiers this client mints itself.
 *
 * Plots carry a client-generated `_id` (`docs/architecture.md`, ADR 001), so a
 * plot has an address before the server has ever heard of it and `PUT` is the
 * create. That makes this the first step of every create, not a detail of it:
 * the id is chosen here, then the request is sent to it.
 *
 * `crypto.randomUUID` is the right implementation and is not always there.
 * It needs a secure context and Chrome 92 / Safari 15.4, which rules out the
 * older Android WebViews this app is expected to run in -- and over plain
 * HTTP it is absent even on a current browser. The `uuid` package (already a
 * dependency, used for `X-Request-Id`) is the fallback: it is the same v4
 * shape drawn from `crypto.getRandomValues`, which those WebViews do have.
 *
 * No `Math.random` tier below that. The server validates v4 specifically, and
 * a guessable id is a probe waiting to happen -- see `plotIdSchema`. A device
 * with no CSPRNG at all is one this app cannot safely create records on, and
 * the throw from `uuid` says so rather than papering over it.
 */
export function newUuid(): string {
  // `lib.dom` types `globalThis.crypto` as always present, and on the devices
  // this exists for it is not -- it is absent over plain HTTP and in some
  // older WebViews. The assertion re-admits the `undefined` the type hides, so
  // that the check below is a real feature test rather than a formality.
  const webCrypto = globalThis.crypto as Crypto | undefined;
  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  return uuidV4();
}
