/** A promise-chain mutex. Used for single-flight HCS submits (TRD §6.1) and per-signer nonces (TRD §7.3). */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export const hcsQueue = new Mutex();

const signerLocks = new Map<string, Mutex>();
export function signerMutex(role: string): Mutex {
  let m = signerLocks.get(role);
  if (!m) signerLocks.set(role, (m = new Mutex()));
  return m;
}
