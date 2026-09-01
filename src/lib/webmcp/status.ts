export interface WebmcpStatus {
	toolCount: number;
}

// Renders WebmcpStatus into the header string. Always shows the tool
// count -- no connection-state branching (hotfix/webmcp-tools-always-visible).
export function formatWebmcpStatus(status: WebmcpStatus): string {
	return `${status.toolCount} tools available`;
}
