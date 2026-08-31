/// <reference types="vitest/config" />
import adapter from '@sveltejs/adapter-static';
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
			// T-1001-8: static output for Cloudflare Workers (static assets).
			// Every route already disables SSR (see src/routes/+layout.ts --
			// there's no backend session to render against), so this is a pure
			// client-side SPA: no route declares `prerender = true`, so
			// `fallback` builds one shell (build/index.html) that Cloudflare
			// serves for any path not matching a static asset -- see
			// wrangler.jsonc's `not_found_handling`.
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: 'index.html',
				strict: true
			})
		})
	],
	test: {
		// jsdom gives the workspace store a real Storage/window to persist against,
		// matching what it runs on in the actual browser (see src/lib/workspace/store.ts).
		environment: 'jsdom',
		include: ['src/**/*.test.ts']
	}
});
