export class CleanupError extends Error {
  constructor(cause: unknown) {
    super("Worker resource cleanup failed; resources remain reserved.", { cause });
    this.name = "CleanupError";
  }
}
export async function cleanup<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw error instanceof CleanupError ? error : new CleanupError(error);
  }
}
