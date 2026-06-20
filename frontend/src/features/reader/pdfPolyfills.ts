// pdfjs-dist 6.x uses the TC39 "upsert" Map methods which Wails' bundled
// WebKit does not yet ship. Polyfill them before pdfjs evaluates.

declare global {
  interface Map<K, V> {
    getOrInsertComputed(key: K, callbackfn: (key: K) => V): V;
    getOrInsert(key: K, value: V): V;
  }
}

if (typeof Map.prototype.getOrInsertComputed !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsertComputed", {
    value: function getOrInsertComputed<K, V>(
      this: Map<K, V>,
      key: K,
      callbackfn: (key: K) => V,
    ): V {
      if (this.has(key)) {
        return this.get(key) as V;
      }
      const value = callbackfn(key);
      this.set(key, value);
      return value;
    },
    writable: true,
    configurable: true,
  });
}

if (typeof Map.prototype.getOrInsert !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsert", {
    value: function getOrInsert<K, V>(this: Map<K, V>, key: K, value: V): V {
      if (this.has(key)) {
        return this.get(key) as V;
      }
      this.set(key, value);
      return value;
    },
    writable: true,
    configurable: true,
  });
}

// pdfjs iterates streams via `for await (const value of stream)`, which
// requires `Symbol.asyncIterator` on ReadableStream — also missing in
// Wails' WebKit.
if (
  typeof ReadableStream !== "undefined" &&
  !(Symbol.asyncIterator in ReadableStream.prototype)
) {
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
    value: function asyncIterator<R>(
      this: ReadableStream<R>,
      { preventCancel = false }: { preventCancel?: boolean } = {},
    ): AsyncIterableIterator<R> {
      const reader = this.getReader();
      return {
        async next() {
          try {
            const result = await reader.read();
            if (result.done) {
              reader.releaseLock();
            }
            return result as IteratorResult<R>;
          } catch (error) {
            reader.releaseLock();
            throw error;
          }
        },
        async return(value?: R) {
          if (!preventCancel) {
            const cancelPromise = reader.cancel(value);
            reader.releaseLock();
            await cancelPromise;
          } else {
            reader.releaseLock();
          }
          return { value, done: true } as IteratorResult<R>;
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
    writable: true,
    configurable: true,
  });
}

export {};
