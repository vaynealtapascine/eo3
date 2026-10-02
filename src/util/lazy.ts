export function lazy<T>(callback: () => Promise<{ default: T }>): () => Promise<T> {
    let pending: Promise<T> | undefined;
    return function lazy() {
        return (pending ??= Promise.resolve()
            .then(callback)
            .then((module) => module.default)
            .catch((error) => {
                pending = undefined;
                throw error;
            }));
    };
}
