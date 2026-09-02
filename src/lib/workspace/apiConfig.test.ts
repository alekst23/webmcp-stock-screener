import { describe, expect, it } from 'vitest';
import { DEV_API_BASE_URL, resolveApiBaseUrl } from './apiConfig';

describe('backend address resolution', () => {
	it('test_a_configured_address_is_used_as_given', () => {
		expect(resolveApiBaseUrl('https://api.example.com')).toBe('https://api.example.com');
	});

	// A deployment console or a .env line trivially introduces a trailing
	// space; embedded in a URL it becomes %20 inside the HOST, so the browser
	// fails DNS instead of reporting a bad configuration.
	it('test_surrounding_whitespace_is_ignored', () => {
		for (const padded of [
			'https://api.example.com ',
			' https://api.example.com',
			'  https://api.example.com  ',
			'\thttps://api.example.com\n'
		]) {
			expect(resolveApiBaseUrl(padded), `failed to trim ${JSON.stringify(padded)}`).toBe(
				'https://api.example.com'
			);
		}
	});

	it('test_an_absent_address_falls_back_to_the_dev_default', () => {
		expect(resolveApiBaseUrl(undefined)).toBe(DEV_API_BASE_URL);
	});

	it('test_an_empty_or_whitespace_only_address_falls_back_to_the_dev_default', () => {
		for (const blank of ['', '   ', '\t\n']) {
			expect(resolveApiBaseUrl(blank), `did not fall back for ${JSON.stringify(blank)}`).toBe(
				DEV_API_BASE_URL
			);
		}
	});

	it('test_the_dev_default_is_a_usable_local_address', () => {
		expect(DEV_API_BASE_URL).toBe('http://localhost:8000');
	});
});
