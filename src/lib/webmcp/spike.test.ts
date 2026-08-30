import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerSpikeTool, spikePing } from './spike';
import type { ModelContext, ModelContextToolDescriptor } from './types';

const SAMPLE_RESPONSE = {
	message: 'pong from a live FastAPI backend',
	sample: {
		ticker: 'MOCK01',
		date: '2023-01-03',
		open: 100,
		high: 101,
		low: 99,
		close: 100.5,
		volume: 1000
	}
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('spikePing', () => {
	it('fetches the local backend and returns its JSON body', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => SAMPLE_RESPONSE,
			text: async () => ''
		});
		vi.stubGlobal('fetch', fetchMock);

		const result = await spikePing();

		expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/api/spike/ping');
		expect(result).toEqual(SAMPLE_RESPONSE);
	});

	it('throws with the response status and body when the backend errors', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'panel missing' })
		);

		await expect(spikePing()).rejects.toThrow(/503/);
	});
});

describe('registerSpikeTool', () => {
	it('returns false without registering when WebMCP is unsupported', async () => {
		const registered = await registerSpikeTool(undefined);
		expect(registered).toBe(false);
	});

	it('registers a spikePing tool descriptor whose execute() calls the backend', async () => {
		let descriptor: ModelContextToolDescriptor | undefined;
		const mc: ModelContext = {
			registerTool: vi.fn(async (tool) => {
				descriptor = tool;
			})
		};

		const registered = await registerSpikeTool(mc);

		expect(registered).toBe(true);
		expect(mc.registerTool).toHaveBeenCalledOnce();
		expect(descriptor?.name).toBe('spikePing');

		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue({ ok: true, json: async () => SAMPLE_RESPONSE, text: async () => '' })
		);
		const result = await descriptor!.execute({});
		expect(result.isError).toBeUndefined();
		expect(JSON.parse(result.content[0]!.text)).toEqual(SAMPLE_RESPONSE);
	});

	it('returns an error tool result when the backend call fails', async () => {
		let descriptor: ModelContextToolDescriptor | undefined;
		const mc: ModelContext = {
			registerTool: vi.fn(async (tool) => {
				descriptor = tool;
			})
		};
		await registerSpikeTool(mc);

		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
		const result = await descriptor!.execute({});

		expect(result.isError).toBe(true);
		expect(JSON.parse(result.content[0]!.text).error).toBe('network down');
	});
});
