// In-memory Storage so each test gets an isolated backing store, mirroring
// src/lib/workspace/testSupport.ts's memoryStorage. Kept as its own copy
// rather than an import so the new workbench surface stays independent of
// the shipping workspace module it lives alongside (per this epic's
// coexistence rule).
export function memoryStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key) => (data.has(key) ? (data.get(key) ?? null) : null),
		setItem: (key, value) => void data.set(key, String(value)),
		removeItem: (key) => void data.delete(key),
		clear: () => data.clear(),
		key: (index) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	};
}
