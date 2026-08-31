import { describe, expect, it } from 'vitest';
import { formatWebmcpStatus } from './status';

describe('formatWebmcpStatus', () => {
	it('shows connected state with the full tool count when WebMCP connects', () => {
		const result = formatWebmcpStatus({ connected: true, toolCount: 11 });
		expect(result).toBe('WebMCP connected · 11 tools available');
	});

	it('shows unavailability rather than a misleading connected state when the browser lacks document.modelContext', () => {
		const result = formatWebmcpStatus({ connected: false, toolCount: 11 });
		expect(result.toLowerCase()).not.toContain('connected');
	});

	it('reflects the full defined tool surface passed in, not a capped or rounded value', () => {
		const result = formatWebmcpStatus({ connected: true, toolCount: 42 });
		expect(result).toContain('42');
	});
});
