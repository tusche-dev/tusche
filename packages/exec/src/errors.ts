/**
 * An error the agent caused: a bad argument, an unknown path, a forbidden edit.
 * It crosses into the VM as an exception of the snippet and rolls the call back.
 */
export class ExecError extends Error {
  /** What to do instead; shown as `hint:` in the response. */
  readonly hint: string | undefined;

  constructor(message: string, options: { name?: string; hint?: string } = {}) {
    super(message);
    this.name = options.name ?? 'Error';
    this.hint = options.hint;
  }
}

/** A mistake in the arguments of an API function (wrong type or shape). */
export const argumentError = (message: string, hint?: string): ExecError =>
  new ExecError(message, hint === undefined ? { name: 'TypeError' } : { name: 'TypeError', hint });

/** The error as it is passed into the VM. */
export interface WireError {
  name: string;
  message: string;
  hint?: string;
}

export function toWireError(error: unknown): WireError {
  if (error instanceof ExecError) {
    const wire: WireError = { name: error.name, message: error.message };
    if (error.hint !== undefined) wire.hint = error.hint;
    return wire;
  }
  // A bug on the host side: still roll back, but say it is ours.
  const message = error instanceof Error ? error.message : String(error);
  return { name: 'InternalError', message: `Tusche: ${message}` };
}
