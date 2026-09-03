// In-memory Storage so each test gets an isolated backing store instead of
// depending on (and leaking state through) jsdom's shared global
// localStorage. Was kept as its own copy of the (now T-1015-6-deleted)
// src/lib/workspace/testSupport.ts's memoryStorage, rather than an import,
// so the new workbench surface stayed independent of the legacy workspace
// module while both shipped side by side.
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
