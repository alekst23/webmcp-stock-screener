export interface WebmcpStatus {
	connected: boolean;
	toolCount: number;
}

// Renders WebmcpStatus into the header string an AC1/AC2 relies on.
// Stub: implemented in /at-ticket-start.
export function formatWebmcpStatus(status: WebmcpStatus): string {
	throw new Error('not implemented');
}
