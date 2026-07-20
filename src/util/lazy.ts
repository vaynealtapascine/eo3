export function lazy<T>(callback: () => Promise<{ default: T }>): () => Promise<T> {
    let cached: T | null = null;
    return async function lazy() {
        if (!cached) {
            cached = (await callback()).default;
        }
        return cached;
    };
}
