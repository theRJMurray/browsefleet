import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * `catch (err)` gives `unknown`, which is correct: a throw site can throw anything, and
 * `catch (err: any)` only hides that by turning every downstream `err.message` into an
 * unchecked property read that returns `undefined` when something threw a string.
 *
 * These two helpers are the whole ceremony needed to handle it honestly.
 */

/** The message of a thrown value, whatever it turned out to be. Never throws, always a string. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === 'string') return message;
  }
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

/**
 * The HTTP status a thrown value asks for, when it carries one. `getOwnedSession` throws
 * `{ status }` to mean 403 rather than 404, and route handlers need to read that back without
 * asserting the shape.
 *
 * Anything outside the 4xx and 5xx range is ignored rather than forwarded. A thrown object
 * carrying `status: 200` is a bug somewhere upstream, and turning a failure into a success
 * response is the worst possible way to surface it.
 */
export function errorStatus(err: unknown): ContentfulStatusCode | undefined {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599) {
      return status as ContentfulStatusCode;
    }
  }
  return undefined;
}
