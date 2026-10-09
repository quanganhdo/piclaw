import { dlopen, ptr, read as ffiRead, type Pointer } from "bun:ffi";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
const log = createLogger("nvml-reader");

export const NVML_SUCCESS = 0;
export const NVML_ERROR_NOT_SUPPORTED = 3;
export const NVML_ERROR_FUNCTION_NOT_FOUND = 13;
export const NVML_ERROR_GPU_IS_LOST = 15;
export const NVML_ERROR_ARGUMENT_VERSION_MISMATCH = 25;

const NVML_LIBRARY = "libnvidia-ml.so.1";
const MAX_NVML_DEVICES = 64;
const NVML_MEMORY_INFO_V2_STRUCT_SIZE = 40;
const NVML_MEMORY_INFO_V2_VERSION = NVML_MEMORY_INFO_V2_STRUCT_SIZE | (2 << 24);

export interface NvmlReadSnapshot {
  totalBytes: number;
  usedBytes: number;
  percent: number;
  /**
   * nvml     => nvmlMemory_v2.used (allocated device memory; reserved excluded)
   * nvml-v1  => nvmlMemory_t.used from v1 fallback, which may include reserved memory
   *             because v1 exposes no reserved field.
   */
  provider: "nvml" | "nvml-v1";
}

export interface NvmlReader {
  read(): NvmlReadSnapshot | null;
  close(): void;
}

export interface NvmlMemoryInfoV1 {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}

export interface NvmlMemoryInfoV2 extends NvmlMemoryInfoV1 {
  reservedBytes: number;
}

export interface NvmlBinding {
  readonly memoryInfoV2Available: boolean;
  getDeviceCount(): number;
  getDeviceHandle(index: number): unknown | null;
  getMemoryInfoV1(device: unknown): NvmlMemoryInfoV1;
  getMemoryInfoV2(device: unknown): NvmlMemoryInfoV2;
  close(): void;
}

export interface CreateNvmlReaderOptions {
  binding?: NvmlBinding | null;
  bindingFactory?: () => NvmlBinding | null;
}

export class NvmlError extends Error {
  constructor(
    readonly code: number,
    readonly call: string,
  ) {
    super(`${call} failed with NVML status ${code}`);
    this.name = "NvmlError";
  }
}

function isSupportedNativeNvmlPlatform(platform: string, arch: string): boolean {
  return platform === "linux" && (arch === "x64" || arch === "arm64");
}

function assertNvmlStatus(status: number, call: string): void {
  if (status !== NVML_SUCCESS) throw new NvmlError(status, call);
}

function isV2FallbackStatus(error: unknown): boolean {
  return error instanceof NvmlError && (
    error.code === NVML_ERROR_NOT_SUPPORTED ||
    error.code === NVML_ERROR_FUNCTION_NOT_FOUND ||
    error.code === NVML_ERROR_ARGUMENT_VERSION_MISMATCH
  );
}

function createNullNvmlReader(): NvmlReader {
  return {
    read: () => null,
    close: () => {},
  };
}

function roundPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function isValidByteCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isNullDeviceHandle(handle: unknown): boolean {
  return handle == null || handle === 0 || handle === 0n;
}

function isValidMemoryInfoV1(info: NvmlMemoryInfoV1): boolean {
  return isValidByteCount(info.totalBytes) &&
    info.totalBytes > 0 &&
    isValidByteCount(info.freeBytes) &&
    isValidByteCount(info.usedBytes) &&
    info.freeBytes <= info.totalBytes &&
    info.usedBytes <= info.totalBytes;
}

function isValidMemoryInfoV2(info: NvmlMemoryInfoV2): boolean {
  return isValidMemoryInfoV1(info) &&
    isValidByteCount(info.reservedBytes) &&
    info.reservedBytes <= info.totalBytes;
}

/** Linux 64-bit NVML ABI. Optional loader/platform injection keeps failure tests hardware-independent. */
export function createNativeNvmlBinding(
  load: typeof dlopen = dlopen,
  platform: string = process.platform,
  arch: string = process.arch,
): NvmlBinding | null {
  if (!isSupportedNativeNvmlPlatform(platform, arch)) return null;

  let requiredLibrary: { close(): void; symbols: Record<string, (...args: any[]) => unknown> } | null = null;
  let optionalLibrary: { close(): void; symbols: Record<string, (...args: any[]) => unknown> } | null = null;
  let initialized = false;

  const cleanup = (): void => {
    if (initialized && requiredLibrary) {
      initialized = false;
      try {
        const shutdown = requiredLibrary.symbols.nvmlShutdown;
        if (typeof shutdown === "function") shutdown();
      } catch (error) { debugSuppressedError(log, "NVML shutdown failed after driver loss.", error, {}); }
    }

    try {
      optionalLibrary?.close();
    } catch (error) { debugSuppressedError(log, "Optional NVML library close failed.", error, {}); }
    try {
      requiredLibrary?.close();
    } catch (error) { debugSuppressedError(log, "NVML library close failed.", error, {}); }

    optionalLibrary = null;
    requiredLibrary = null;
  };

  try {
    requiredLibrary = load(NVML_LIBRARY, {
      nvmlInit_v2: { args: [], returns: "i32" },
      nvmlShutdown: { args: [], returns: "i32" },
      nvmlDeviceGetCount_v2: { args: ["ptr"], returns: "i32" },
      nvmlDeviceGetHandleByIndex_v2: { args: ["u32", "ptr"], returns: "i32" },
      nvmlDeviceGetMemoryInfo: { args: ["ptr", "ptr"], returns: "i32" },
    });

    try {
      optionalLibrary = load(NVML_LIBRARY, {
        nvmlDeviceGetMemoryInfo_v2: { args: ["ptr", "ptr"], returns: "i32" },
      });
    } catch {
      optionalLibrary = null;
    }

    const requiredSymbols = requiredLibrary.symbols;
    const optionalSymbols = optionalLibrary?.symbols ?? {};

    assertNvmlStatus(Number(requiredSymbols.nvmlInit_v2()), "nvmlInit_v2");
    initialized = true;

    const countBuffer = new Uint32Array(1);
    const countPointer = ptr(countBuffer);
    const handleBuffer = new BigUint64Array(1);
    const handlePointer = ptr(handleBuffer);
    const memoryV1Buffer = new BigUint64Array(3);
    const memoryV1Pointer = ptr(memoryV1Buffer);
    const memoryV2Buffer = new BigUint64Array(5);
    const memoryV2View = new DataView(memoryV2Buffer.buffer);
    const memoryV2Pointer = ptr(memoryV2Buffer);

    let closed = false;

    const ensureOpen = (): void => {
      if (closed) throw new Error("NVML binding is closed");
    };

    return {
      memoryInfoV2Available: typeof optionalSymbols.nvmlDeviceGetMemoryInfo_v2 === "function",
      getDeviceCount(): number {
        ensureOpen();
        countBuffer[0] = 0;
        assertNvmlStatus(Number(requiredSymbols.nvmlDeviceGetCount_v2(countPointer)), "nvmlDeviceGetCount_v2");
        return countBuffer[0] ?? 0;
      },
      getDeviceHandle(index: number): unknown | null {
        ensureOpen();
        handleBuffer[0] = 0n;
        assertNvmlStatus(Number(requiredSymbols.nvmlDeviceGetHandleByIndex_v2(index >>> 0, handlePointer)), "nvmlDeviceGetHandleByIndex_v2");
        return ffiRead.ptr(handlePointer) as Pointer | null;
      },
      getMemoryInfoV1(device: unknown): NvmlMemoryInfoV1 {
        ensureOpen();
        memoryV1Buffer.fill(0n);
        assertNvmlStatus(Number(requiredSymbols.nvmlDeviceGetMemoryInfo(device as Pointer, memoryV1Pointer)), "nvmlDeviceGetMemoryInfo");
        return {
          totalBytes: Number(memoryV1Buffer[0]),
          freeBytes: Number(memoryV1Buffer[1]),
          usedBytes: Number(memoryV1Buffer[2]),
        };
      },
      getMemoryInfoV2(device: unknown): NvmlMemoryInfoV2 {
        ensureOpen();
        const getMemoryInfoV2 = optionalSymbols.nvmlDeviceGetMemoryInfo_v2;
        if (typeof getMemoryInfoV2 !== "function") {
          throw new NvmlError(NVML_ERROR_FUNCTION_NOT_FOUND, "nvmlDeviceGetMemoryInfo_v2");
        }
        memoryV2Buffer.fill(0n);
        memoryV2View.setUint32(0, NVML_MEMORY_INFO_V2_VERSION, true);
        memoryV2View.setUint32(4, 0, true);
        assertNvmlStatus(Number(getMemoryInfoV2(device as Pointer, memoryV2Pointer)), "nvmlDeviceGetMemoryInfo_v2");
        return {
          totalBytes: Number(memoryV2Buffer[1]),
          reservedBytes: Number(memoryV2Buffer[2]),
          freeBytes: Number(memoryV2Buffer[3]),
          usedBytes: Number(memoryV2Buffer[4]),
        };
      },
      close(): void {
        if (closed) return;
        closed = true;
        cleanup();
      },
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

export function createNvmlController(binding: NvmlBinding): NvmlReader {
  let closed = false;
  let useV1Only = !binding.memoryInfoV2Available;

  return {
    read(): NvmlReadSnapshot | null {
      if (closed) return null;

      const deviceCount = binding.getDeviceCount();
      if (!Number.isSafeInteger(deviceCount) || deviceCount < 0 || deviceCount > MAX_NVML_DEVICES) {
        return null;
      }
      if (deviceCount === 0) return null;

      let totalBytes = 0;
      let usedBytes = 0;
      let provider: NvmlReadSnapshot["provider"] = useV1Only ? "nvml-v1" : "nvml";

      for (let index = 0; index < deviceCount; index += 1) {
        const device = binding.getDeviceHandle(index);
        if (isNullDeviceHandle(device)) return null;

        let infoTotalBytes: number;
        let infoUsedBytes: number;

        if (!useV1Only) {
          try {
            const info = binding.getMemoryInfoV2(device);
            if (!isValidMemoryInfoV2(info)) return null;
            infoTotalBytes = info.totalBytes;
            infoUsedBytes = info.usedBytes;
          } catch (error) {
            if (!isV2FallbackStatus(error)) throw error;
            useV1Only = true;
            provider = "nvml-v1";
            // Restart aggregation so earlier devices do not retain v2 (reserved-excluded) semantics.
            totalBytes = 0;
            usedBytes = 0;
            index = -1;
            continue;
          }
        } else {
          const info = binding.getMemoryInfoV1(device);
          if (!isValidMemoryInfoV1(info)) return null;
          infoTotalBytes = info.totalBytes;
          infoUsedBytes = info.usedBytes;
        }

        const nextTotalBytes = totalBytes + infoTotalBytes;
        const nextUsedBytes = usedBytes + infoUsedBytes;
        if (!Number.isSafeInteger(nextTotalBytes) || !Number.isSafeInteger(nextUsedBytes)) return null;
        totalBytes = nextTotalBytes;
        usedBytes = nextUsedBytes;
      }

      if (totalBytes <= 0 || usedBytes < 0 || usedBytes > totalBytes) return null;
      return {
        totalBytes,
        usedBytes,
        percent: roundPercent((usedBytes / totalBytes) * 100),
        provider,
      };
    },
    close(): void {
      if (closed) return;
      closed = true;
      binding.close();
    },
  };
}

export function createNvmlReader(options: CreateNvmlReaderOptions = {}): NvmlReader {
  let binding: NvmlBinding | null | undefined;
  if (Object.prototype.hasOwnProperty.call(options, "binding")) {
    binding = options.binding;
  } else if (options.bindingFactory) {
    binding = options.bindingFactory();
  } else {
    binding = createNativeNvmlBinding();
  }

  if (!binding) return createNullNvmlReader();
  return createNvmlController(binding);
}
