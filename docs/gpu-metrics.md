# NVIDIA GPU meters

The web HUD reads NVIDIA VRAM through NVML (`libnvidia-ml.so.1`) using Bun FFI. It does not launch `nvidia-smi` or create a CUDA context. The NVIDIA driver supplies the library; neither the CUDA toolkit nor an additional package is required.

## Sampling and availability

One lazy, unreferenced Bun worker owns the library and native buffers. All `SystemMetricsSampler` instances share its cache. Requests return immediately, including the first request before GPU discovery finishes. Sampling is demand-driven, at most once every two seconds, with one request in flight. No polling runs when no caller requests meter GPU metrics. General UI-status polling opts out of both GPU collectors and neither renews demand nor clears the retained VRAM history.

A successful sample sums physical-device memory; one failed device invalidates the whole aggregate rather than publishing a misleading partial total. Device handles are reacquired each sample. The reader bounds device enumeration to 64 devices and validates byte counts and percentages before publishing them.

| Condition | Behaviour |
|---|---|
| Unsupported OS/architecture | No worker; GPU metrics unavailable. |
| Missing library, failed initialisation, permission error | Unavailable; retry after 60 seconds. |
| No card or a lost card | Release NVML state; unavailable; rediscover after 60 seconds. |
| Missing/unsupported memory-v2 API | Fall back to memory-v1; expose the accounting difference through `gpu_provider`. |
| Invalid values or incompatible native calls | Discard the sample; release state and back off. No CLI fallback. |
| Old cached data or a query taking five seconds | Unavailable; never show stale data as zero usage. |
| Native query that never returns | Keep only that single request/worker; do not create replacement workers. |
| Worker construction fails | Retry after 60 seconds. |
| Worker emits an error | Disable GPU sampling for this process; a Piclaw restart resets this circuit. CPU/RAM metrics continue. |

A late response to a query that exceeded five seconds is discarded. A subsequent request may retry after backoff. Shutdown sends a close request; if native code is busy, it releases NVML when it returns. The worker is unreferenced and does not keep Piclaw alive.

The worker keeps synchronous driver calls off the web-server event loop. **It is not native crash isolation**: a segfault inside a loaded library can still terminate the process, and JavaScript cannot interrupt a stuck native call. No driver reset, hot-unplug or native-crash experiment is performed by this feature. A separate long-lived process would be required for stronger isolation.

## Memory accounting

The existing `vram_*` JSON fields and HUD layout are unchanged. These values measure memory occupancy, not GPU compute utilisation.

- `gpu_provider: "nvml"`: memory-v2 allocated bytes, excluding driver-reserved memory.
- `gpu_provider: "nvml-v1"`: legacy used bytes, which include reserved memory. The HUD's existing provider tooltip exposes this fallback.
- `gpu_provider: null`, `vram_percent: null`: unavailable; byte fields retain their existing zero defaults and the VRAM series is cleared.

V2 fallback is allowed only for missing symbols, `NOT_SUPPORTED`, `FUNCTION_NOT_FOUND` or `ARGUMENT_VERSION_MISMATCH`. Permission, device-loss and unknown errors do not select a different accounting method. If a later device requires v1, aggregation restarts using v1 for every device. Each aggregation pass queries physical handles once; a compatibility fallback restarts enumeration under uniform v1 semantics. MIG instances are not separately enumerated or double-counted.

The binding uses the Linux x64/arm64 NVML layouts: 24-byte v1 memory structure and 40-byte versioned v2 structure. The live smoke check was on Linux x64; arm64 and multi-GPU behaviour have synthetic coverage only.

## Validation

Synthetic tests cover loader/init failure, absent devices, lost devices, byte validation, multiple GPUs, mixed-version fallback, native buffer layout, balanced disposal, backoff, stale/late messages and worker failure. Existing system-metrics tests continue to inject a GPU reader without loading a driver.

A read-only RTX 3060 worker smoke check received 39 available samples from 40 cache reads over four seconds using one worker. The largest cached read after startup was about 0.055 ms on that host. No workload was generated and no device settings changed. This is a feasibility measurement, not a driver latency guarantee.
