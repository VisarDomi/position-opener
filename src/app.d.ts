declare global {
	namespace App {
		interface Locals {
			/** Authenticated username, set by src/hooks.server.ts (undefined in the showcase profile). */
			user?: string;
		}
	}
}

export {};
