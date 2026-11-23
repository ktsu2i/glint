import { describe, expect, it, vi } from "vitest";

describe("PDF compatibility polyfills", () => {
  it("installs and exercises PDF.js compatibility methods", async () => {
    const computedDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, "getOrInsertComputed");
    const insertDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, "getOrInsert");
    const weakComputedDescriptor = Object.getOwnPropertyDescriptor(
      WeakMap.prototype,
      "getOrInsertComputed",
    );
    const weakInsertDescriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, "getOrInsert");
    const toHexDescriptor = Object.getOwnPropertyDescriptor(Uint8Array.prototype, "toHex");
    Reflect.deleteProperty(Map.prototype, "getOrInsertComputed");
    Reflect.deleteProperty(Map.prototype, "getOrInsert");
    Reflect.deleteProperty(WeakMap.prototype, "getOrInsertComputed");
    Reflect.deleteProperty(WeakMap.prototype, "getOrInsert");
    Reflect.deleteProperty(Uint8Array.prototype, "toHex");

    class TestReadableStream<R> {
      constructor(private readonly reader: object) {}
      getReader() {
        return this.reader;
      }
    }

    vi.stubGlobal("ReadableStream", TestReadableStream);
    vi.resetModules();
    await import("./pdfPolyfills");

    try {
      const map = new Map<string, number>();
      const compute = vi.fn(() => 3);
      expect(map.getOrInsertComputed("a", compute)).toBe(3);
      expect(map.getOrInsertComputed("a", compute)).toBe(3);
      expect(compute).toHaveBeenCalledOnce();
      expect(map.getOrInsert("b", 4)).toBe(4);
      expect(map.getOrInsert("b", 5)).toBe(4);

      const weakMap = new WeakMap<object, number>();
      const weakKey = {};
      const weakCompute = vi.fn(() => 6);
      expect(weakMap.getOrInsertComputed(weakKey, weakCompute)).toBe(6);
      expect(weakMap.getOrInsertComputed(weakKey, weakCompute)).toBe(6);
      expect(weakCompute).toHaveBeenCalledOnce();
      const otherWeakKey = {};
      expect(weakMap.getOrInsert(otherWeakKey, 7)).toBe(7);
      expect(weakMap.getOrInsert(otherWeakKey, 8)).toBe(7);
      expect(new Uint8Array([0, 15, 16, 255]).toHex()).toBe("000f10ff");

      const reader = {
        read: vi.fn()
          .mockResolvedValueOnce({ value: "first", done: false })
          .mockResolvedValueOnce({ value: undefined, done: true }),
        releaseLock: vi.fn(),
        cancel: vi.fn(async () => undefined),
      };
      const stream = new TestReadableStream(reader) as unknown as ReadableStream<string>;
      const iterator = stream[Symbol.asyncIterator]();
      expect(iterator[Symbol.asyncIterator]()).toBe(iterator);
      await expect(iterator.next()).resolves.toEqual({ value: "first", done: false });
      await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
      expect(reader.releaseLock).toHaveBeenCalledOnce();

      const returnReader = {
        read: vi.fn(),
        releaseLock: vi.fn(),
        cancel: vi.fn(async () => undefined),
      };
      const returnIterator = (
        new TestReadableStream(returnReader) as unknown as ReadableStream<string>
      )[Symbol.asyncIterator]();
      await expect(returnIterator.return?.()).resolves.toEqual({ value: undefined, done: true });
      expect(returnReader.cancel).toHaveBeenCalledWith(undefined);

      const retainedReader = {
        read: vi.fn(),
        releaseLock: vi.fn(),
        cancel: vi.fn(),
      };
      const retainedIterator = (
        ReadableStream.prototype[Symbol.asyncIterator] as unknown as (
          this: ReadableStream<string>,
          options: { preventCancel: boolean },
        ) => AsyncIterableIterator<string>
      ).call(
        new TestReadableStream(retainedReader) as unknown as ReadableStream<string>,
        { preventCancel: true },
      );
      await retainedIterator.return?.();
      expect(retainedReader.cancel).not.toHaveBeenCalled();
      expect(retainedReader.releaseLock).toHaveBeenCalledOnce();

      const failedReader = {
        read: vi.fn(async () => Promise.reject(new Error("read failed"))),
        releaseLock: vi.fn(),
        cancel: vi.fn(),
      };
      const failedIterator = (
        new TestReadableStream(failedReader) as unknown as ReadableStream<string>
      )[Symbol.asyncIterator]();
      await expect(failedIterator.next()).rejects.toThrow("read failed");
      expect(failedReader.releaseLock).toHaveBeenCalledOnce();

      vi.resetModules();
      await import("./pdfPolyfills");
      vi.stubGlobal("ReadableStream", undefined);
      vi.resetModules();
      await import("./pdfPolyfills");
    } finally {
      if (computedDescriptor) {
        Object.defineProperty(Map.prototype, "getOrInsertComputed", computedDescriptor);
      } else {
        Reflect.deleteProperty(Map.prototype, "getOrInsertComputed");
      }
      if (insertDescriptor) {
        Object.defineProperty(Map.prototype, "getOrInsert", insertDescriptor);
      } else {
        Reflect.deleteProperty(Map.prototype, "getOrInsert");
      }
      for (const [name, descriptor] of [
        ["getOrInsertComputed", weakComputedDescriptor],
        ["getOrInsert", weakInsertDescriptor],
      ] as const) {
        if (descriptor) {
          Object.defineProperty(WeakMap.prototype, name, descriptor);
        } else {
          Reflect.deleteProperty(WeakMap.prototype, name);
        }
      }
      if (toHexDescriptor) {
        Object.defineProperty(Uint8Array.prototype, "toHex", toHexDescriptor);
      } else {
        Reflect.deleteProperty(Uint8Array.prototype, "toHex");
      }
    }
  });
});
