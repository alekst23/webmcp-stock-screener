// Resolving the backend address is a plain function rather than an inline
// `env.PUBLIC_API_BASE_URL ?? '...'` at each call site: it was spelled out in
// three places, and it needs to survive a value that a deployment console or
// a .env line has padded with whitespace.
//
// Padding is not cosmetic. Concatenated into a request URL, a trailing space
// is encoded as %20 *inside the host name*, so the browser fails DNS
// resolution and the app reports an unhelpful "Failed to fetch" rather than a
// bad configuration.

export const DEV_API_BASE_URL = 'http://localhost:8000';

export function resolveApiBaseUrl(configured: string | undefined): string {
	return configured?.trim() || DEV_API_BASE_URL;
}
