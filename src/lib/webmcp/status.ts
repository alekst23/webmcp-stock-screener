export interface WebmcpStatus {
	connected: boolean;
	toolCount: number;
}

// Renders WebmcpStatus into the header string an AC1/AC2 relies on.
export function formatWebmcpStatus(status: WebmcpStatus): string {
	if (!status.connected) {
		return "WebMCP isn't available in this browser";
	}
	return `WebMCP connected · ${status.toolCount} tools available`;
}
