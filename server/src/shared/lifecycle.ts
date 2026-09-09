/**
 * Process lifecycle flag, shared between the HTTP layer and the shutdown
 * sequence in `server.ts`. Lives in `shared/` so neither has to import the
 * other.
 */
let draining = false;

/** True once a shutdown signal has been received. */
export function isDraining(): boolean {
  return draining;
}

/** Marks the process as draining. Called once, by the shutdown handler. */
export function beginDraining(): void {
  draining = true;
}

/** Test-only: restore the initial state. */
export function resetDrainingForTests(): void {
  draining = false;
}
