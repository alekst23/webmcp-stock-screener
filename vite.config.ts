/// <reference types="vitest/config" />
import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// adapter-auto only supports some environments; swap for a specific
			// adapter once a deploy target is chosen (see T-1001-8).
			adapter: adapter()
		})
	],
	test: {
		// jsdom gives the workspace store a real Storage/window to persist against,
		// matching what it runs on in the actual browser (see src/lib/workspace/store.ts).
		environment: 'jsdom',
		include: ['src/**/*.test.ts']
	}
});
