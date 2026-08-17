/** An error's message, for anything that has to print one it did not throw. */
export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
