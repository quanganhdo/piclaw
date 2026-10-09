import { expect, test } from "bun:test";

import {
  NVML_ERROR_FUNCTION_NOT_FOUND,
  NVML_ERROR_GPU_IS_LOST,
  NvmlError,
  createNvmlController,
  createNvmlReader,
  type NvmlBinding,
} from "../../../../src/channels/web/agent/nvml-reader.js";

test("createNvmlReader rethrows native binding creation failures", () => {
  expect(() => createNvmlReader({
    bindingFactory: () => {
      throw new Error("libnvidia-ml.so.1 unavailable");
    },
  })).toThrow("libnvidia-ml.so.1 unavailable");
});

test("createNvmlReader returns an inert reader when no native binding is available", () => {
  const reader = createNvmlReader({ binding: null });

  expect(reader.read()).toBeNull();
  expect(() => reader.close()).not.toThrow();
  expect(() => reader.close()).not.toThrow();
});

test("createNvmlController returns null when NVML reports zero devices", () => {
  let handleCalls = 0;
  const reader = createNvmlController({
    memoryInfoV2Available: true,
    getDeviceCount: () => 0,
    getDeviceHandle: () => {
      handleCalls += 1;
      return null;
    },
    getMemoryInfoV1: () => ({ totalBytes: 0, freeBytes: 0, usedBytes: 0 }),
    getMemoryInfoV2: () => ({ totalBytes: 0, reservedBytes: 0, freeBytes: 0, usedBytes: 0 }),
    close: () => {},
  });

  expect(reader.read()).toBeNull();
  expect(handleCalls).toBe(0);
});

test("createNvmlController aggregates multi-GPU v2 memory using allocated used bytes", () => {
  const gpu0 = { index: 0 };
  const gpu1 = { index: 1 };
  const calls = { v1: 0, v2: 0 };
  const reader = createNvmlController({
    memoryInfoV2Available: true,
    getDeviceCount: () => 2,
    getDeviceHandle: (index) => (index === 0 ? gpu0 : index === 1 ? gpu1 : null),
    getMemoryInfoV1: () => {
      calls.v1 += 1;
      return { totalBytes: 1, freeBytes: 0, usedBytes: 1 };
    },
    getMemoryInfoV2: (device) => {
      calls.v2 += 1;
      if (device === gpu0) {
        return { totalBytes: 100, reservedBytes: 10, freeBytes: 60, usedBytes: 30 };
      }
      return { totalBytes: 300, reservedBytes: 20, freeBytes: 200, usedBytes: 80 };
    },
    close: () => {},
  });

  expect(reader.read()).toEqual({
    totalBytes: 400,
    usedBytes: 110,
    percent: 27.5,
    provider: "nvml",
  });
  expect(calls.v1).toBe(0);
  expect(calls.v2).toBe(2);
});

test("createNvmlController returns null on invalid per-device memory values instead of partial totals", () => {
  const gpu0 = { index: 0 };
  const gpu1 = { index: 1 };
  const reader = createNvmlController({
    memoryInfoV2Available: true,
    getDeviceCount: () => 2,
    getDeviceHandle: (index) => (index === 0 ? gpu0 : index === 1 ? gpu1 : null),
    getMemoryInfoV1: () => ({ totalBytes: 1, freeBytes: 0, usedBytes: 1 }),
    getMemoryInfoV2: (device) => {
      if (device === gpu0) {
        return { totalBytes: 100, reservedBytes: 10, freeBytes: 60, usedBytes: 30 };
      }
      return { totalBytes: 200, reservedBytes: -1, freeBytes: 150, usedBytes: 50 };
    },
    close: () => {},
  });

  expect(reader.read()).toBeNull();
});

test("createNvmlController falls back to v1 only for allowed v2 compatibility errors and latches the fallback", () => {
  const gpu0 = { index: 0 };
  const calls = { v1: 0, v2: 0 };
  const reader = createNvmlController({
    memoryInfoV2Available: true,
    getDeviceCount: () => 1,
    getDeviceHandle: () => gpu0,
    getMemoryInfoV1: () => {
      calls.v1 += 1;
      return { totalBytes: 256, freeBytes: 96, usedBytes: 160 };
    },
    getMemoryInfoV2: () => {
      calls.v2 += 1;
      throw new NvmlError(NVML_ERROR_FUNCTION_NOT_FOUND, "nvmlDeviceGetMemoryInfo_v2");
    },
    close: () => {},
  });

  expect(reader.read()).toEqual({
    totalBytes: 256,
    usedBytes: 160,
    percent: 62.5,
    provider: "nvml-v1",
  });
  expect(reader.read()).toEqual({
    totalBytes: 256,
    usedBytes: 160,
    percent: 62.5,
    provider: "nvml-v1",
  });
  expect(calls.v2).toBe(1);
  expect(calls.v1).toBe(2);
});

test("createNvmlController rethrows GPU loss and re-enumerates on the next read", () => {
  const gpu0 = { index: 0 };
  let gpuLost = true;
  const calls = { count: 0, handle: 0, v1: 0, v2: 0 };
  const reader = createNvmlController({
    memoryInfoV2Available: true,
    getDeviceCount: () => {
      calls.count += 1;
      return 1;
    },
    getDeviceHandle: () => {
      calls.handle += 1;
      return gpu0;
    },
    getMemoryInfoV1: () => {
      calls.v1 += 1;
      return { totalBytes: 1, freeBytes: 0, usedBytes: 1 };
    },
    getMemoryInfoV2: () => {
      calls.v2 += 1;
      if (gpuLost) throw new NvmlError(NVML_ERROR_GPU_IS_LOST, "nvmlDeviceGetMemoryInfo_v2");
      return { totalBytes: 512, reservedBytes: 32, freeBytes: 352, usedBytes: 128 };
    },
    close: () => {},
  });

  let thrown: unknown;
  try {
    reader.read();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(NvmlError);
  expect((thrown as NvmlError).code).toBe(NVML_ERROR_GPU_IS_LOST);

  gpuLost = false;
  expect(reader.read()).toEqual({
    totalBytes: 512,
    usedBytes: 128,
    percent: 25,
    provider: "nvml",
  });
  expect(calls.count).toBe(2);
  expect(calls.handle).toBe(2);
  expect(calls.v1).toBe(0);
  expect(calls.v2).toBe(2);
});

test("createNvmlReader closes the injected binding at most once", () => {
  let closeCalls = 0;
  const binding: NvmlBinding = {
    memoryInfoV2Available: false,
    getDeviceCount: () => 0,
    getDeviceHandle: () => null,
    getMemoryInfoV1: () => ({ totalBytes: 0, freeBytes: 0, usedBytes: 0 }),
    getMemoryInfoV2: () => ({ totalBytes: 0, reservedBytes: 0, freeBytes: 0, usedBytes: 0 }),
    close: () => {
      closeCalls += 1;
    },
  };

  const reader = createNvmlReader({ binding });
  reader.close();
  reader.close();

  expect(closeCalls).toBe(1);
  expect(reader.read()).toBeNull();
});

test("fallback on a later device restarts the aggregate with uniform v1 semantics", () => {
  const controller = createNvmlController({
    memoryInfoV2Available: true, getDeviceCount: () => 2, getDeviceHandle: i => i + 1,
    getMemoryInfoV2: device => { if (device === 2) throw new NvmlError(NVML_ERROR_FUNCTION_NOT_FOUND, 'v2'); return { totalBytes: 100, freeBytes: 70, usedBytes: 10, reservedBytes: 20 }; },
    getMemoryInfoV1: () => ({ totalBytes: 100, freeBytes: 70, usedBytes: 30 }), close() {},
  });
  expect(controller.read()).toEqual({ totalBytes: 200, usedBytes: 60, percent: 30, provider: 'nvml-v1' });
});

test("native loader is optional, balances failed initialization, and omits optional v2 safely", async () => {
  const { createNativeNvmlBinding } = await import('../../../../src/channels/web/agent/nvml-reader.js');
  const { ptr, toArrayBuffer } = await import('bun:ffi');
  expect(createNativeNvmlBinding((() => { throw Error('must not load'); }) as any, 'darwin', 'arm64')).toBeNull();
  expect(() => createNativeNvmlBinding((() => { throw Error('missing library'); }) as any, 'linux', 'x64')).toThrow('missing library');
  let closes = 0, shutdowns = 0;
  const failure = (() => ({ symbols: { nvmlInit_v2: () => 9, nvmlShutdown: () => { shutdowns++; } }, close: () => { closes++; } })) as any;
  expect(() => createNativeNvmlBinding(failure, 'linux', 'x64')).toThrow('status 9');
  expect(closes).toBe(2); expect(shutdowns).toBe(0);
  const handles = new Uint8Array(8);
  const load = ((_path: string, symbols: any) => {
    if (symbols.nvmlDeviceGetMemoryInfo_v2) throw Error('old driver');
    return { symbols: {
      nvmlInit_v2: () => 0, nvmlShutdown: () => { shutdowns++; return 0; },
      nvmlDeviceGetCount_v2: (p: any) => { new DataView(toArrayBuffer(p, 0, 4)).setUint32(0, 1, true); return 0; },
      nvmlDeviceGetHandleByIndex_v2: (_i: number, p: any) => { new DataView(toArrayBuffer(p, 0, 8)).setBigUint64(0, BigInt(ptr(handles)), true); return 0; },
      nvmlDeviceGetMemoryInfo: (_d: any, p: any) => { const v = new BigUint64Array(toArrayBuffer(p, 0, 24)); v.set([100n, 70n, 30n]); return 0; },
    }, close: () => { closes++; } };
  }) as any;
  const binding = createNativeNvmlBinding(load, 'linux', 'x64')!;
  const controller = createNvmlController(binding);
  expect(controller.read()).toEqual({ totalBytes: 100, usedBytes: 30, percent: 30, provider: 'nvml-v1' });
  controller.close(); controller.close(); expect(shutdowns).toBe(1); expect(closes).toBe(3);
});

test("native v2 buffer has versioned 64-bit layout and keeps reserved separate", async () => {
  const { createNativeNvmlBinding } = await import('../../../../src/channels/web/agent/nvml-reader.js');
  const { ptr, toArrayBuffer } = await import('bun:ffi');
  const handle = new Uint8Array(8);
  const load = ((_path: string, requested: any) => ({ close() {}, symbols: requested.nvmlDeviceGetMemoryInfo_v2 ? {
    nvmlDeviceGetMemoryInfo_v2: (_d: any, p: any) => {
      const v = new DataView(toArrayBuffer(p, 0, 40));
      expect(v.getUint32(0, true)).toBe(40 | (2 << 24));
      v.setBigUint64(8, 1000n, true); v.setBigUint64(16, 100n, true);
      v.setBigUint64(24, 600n, true); v.setBigUint64(32, 300n, true); return 0;
    },
  } : {
    nvmlInit_v2: () => 0, nvmlShutdown: () => 0,
    nvmlDeviceGetCount_v2: (p: any) => { new DataView(toArrayBuffer(p, 0, 4)).setUint32(0, 1, true); return 0; },
    nvmlDeviceGetHandleByIndex_v2: (_i: number, p: any) => { new DataView(toArrayBuffer(p, 0, 8)).setBigUint64(0, BigInt(ptr(handle)), true); return 0; },
    nvmlDeviceGetMemoryInfo: () => { throw Error('unexpected v1 fallback'); },
  } })) as any;
  const c = createNvmlController(createNativeNvmlBinding(load, 'linux', 'x64')!);
  try { expect(c.read()).toEqual({ totalBytes: 1000, usedBytes: 300, percent: 30, provider: 'nvml' }); } finally { c.close(); }
});

test("compatibility errors alone permit v1; permissions and unknown errors do not", () => {
  for (const status of [3, 13, 25, 4, 999]) {
    let fallback = 0;
    const c = createNvmlController({ memoryInfoV2Available: true,
      getDeviceCount: () => 1, getDeviceHandle: () => 1,
      getMemoryInfoV2: () => { throw new NvmlError(status, 'memory_v2'); },
      getMemoryInfoV1: () => { fallback++; return { totalBytes: 100, usedBytes: 30, freeBytes: 70 }; }, close() {},
    });
    if ([3,13,25].includes(status)) { expect(c.read()?.provider).toBe('nvml-v1'); expect(fallback).toBe(1); }
    else { expect(() => c.read()).toThrow(); expect(fallback).toBe(0); }
  }
});
