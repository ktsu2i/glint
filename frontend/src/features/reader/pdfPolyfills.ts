// pdfjs-dist 6.x uses the TC39 "upsert" Map methods which Wails' bundled
// WebKit does not yet ship. Polyfill them before pdfjs evaluates.

declare global {
  interface Map<K, V> {
    getOrInsertComputed(key: K, callbackfn: (key: K) => V): V;
    getOrInsert(key: K, value: V): V;
  }

  interface WeakMap<K extends WeakKey, V> {
    getOrInsertComputed(key: K, callbackfn: (key: K) => V): V;
    getOrInsert(key: K, value: V): V;
  }

  interface Uint8Array {
    toHex(): string;
  }
}

// pdfjs-dist 6.x also uses Uint8Array#toHex, which is not available in
// Node.js 24 or Wails' current WebKit.
if (typeof Uint8Array.prototype.toHex !== "function") {
  Object.defineProperty(Uint8Array.prototype, "toHex", {
    value: function toHex(this: Uint8Array): string {
      let result = "";
      for (const byte of this) {
        result += byte.toString(16).padStart(2, "0");
      }
      return result;
    },
    writable: true,
    configurable: true,
  });
}

type UpsertMap<K, V> = {
  has(key: K): boolean;
  get(key: K): V | undefined;
  set(key: K, value: V): unknown;
};

// pdfjs-dist 6.5+ also calls these methods on WeakMap instances (e.g. the
// canvas path cache), so install them on both prototypes.
function installUpsertMethods(prototype: object): void {
  if (!("getOrInsertComputed" in prototype)) {
    Object.defineProperty(prototype, "getOrInsertComputed", {
      value: function getOrInsertComputed<K, V>(
        this: UpsertMap<K, V>,
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

  if (!("getOrInsert" in prototype)) {
    Object.defineProperty(prototype, "getOrInsert", {
      value: function getOrInsert<K, V>(this: UpsertMap<K, V>, key: K, value: V): V {
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
}

installUpsertMethods(Map.prototype);
installUpsertMethods(WeakMap.prototype);

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
