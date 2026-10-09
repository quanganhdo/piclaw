#!/usr/bin/env bun
/**
 * Validate an already-installed, standalone consumer of the Earendil package family.
 *
 * This check is deliberately read-only: it does not install packages, rewrite pins,
 * activate the harness, or call a model provider. The supplied git head is retained
 * as caller-provided registry/release metadata because npm tarballs may omit gitHead.
 */

import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";

export const LEGACY_FAMILY_PACKAGES = [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "@earendil-works/pi-telemetry",
  "@earendil-works/chord",
] as const;

export const FAMILY_PACKAGES = [
  ...LEGACY_FAMILY_PACKAGES,
  "@earendil-works/pi-mcp",
  "@earendil-works/pi-codemode",
] as const;

export const CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";
export const MCP_PACKAGE = "@earendil-works/pi-mcp";
export const AI_PACKAGE = "@earendil-works/pi-ai";
export const SERVER_PACKAGE = "@earendil-works/pi-server";
export const SOURCE_ONLY_DEEP_PATHS = ["./client", "./experimental/plugin"] as const;
export const MODERN_PRIVATE_IMPORTS = [
  `${MCP_PACKAGE}/dist/client.js`,
  `${AI_PACKAGE}/dist/auth/oauth/openai-chatgpt.js`,
] as const;
export const REMOVED_100_IMPORTS = [
  "@earendil-works/pi-agent-core/node",
  "@earendil-works/pi-agent-core/harness/context",
  "@earendil-works/pi-agent-core/harness/env/nodejs",
  "@earendil-works/pi-agent-core/harness/session",
  "@earendil-works/pi-agent-core/harness/session/testing",
  "@earendil-works/pi-agent-core/session/testing",
  "@earendil-works/pi-agent-core/experimental/pico3",
  "@earendil-works/pi-agent-core/experimental/pico3/testing",
] as const;
const REMOVED_100_EXPORTS = ["AgentHarness", "ExecutionEnv", "Result", "MemorySessionRepo", "JsonlSessionRepo", "NodeExecutionEnv"] as const;
export const MODERN_CODING_AGENT_EXPORTS = [
  "createAgentSession", "createAgentSessionRuntime", "ModelRuntime",
  "createMcpExtension", "createToolSearchExtension", "createCodemodeExtension",
] as const;
export const MCP_ROOT_EXPORTS = ["McpClient", "StdioTransport", "StreamableHttpTransport"] as const;
export const MCP_OAUTH_EXPORTS = [
  "OAuthCallbackServer", "buildAuthorizationServerDiscoveryUrls", "discoverAuthorizationServerMetadata",
  "discoverOAuthServerInfo", "discoverProtectedResourceMetadata", "parseWwwAuthenticate",
  "resourceUrlFromServerUrl", "selectResource", "McpOAuthAuthorizationRequiredError", "OAuthError",
  "OAuthInsecureEndpointError", "OAuthIssuerMismatchError", "OAuthRegistrationError", "adaptOAuthProvider",
  "authorizeMcp", "exchangeAuthorizationCode", "refreshAuthorization", "registerClient", "startAuthorization",
  "McpOAuthProvider", "MemoryOAuthStateStore",
] as const;

const MODERN_CONTRACT_VERSION = "0.99.0";
const EXACT_0991_VERSION = "0.99.1";
const EXACT_0991_GIT_HEAD = "d86654abb8862e201933517d6f1fce9f88dd117f";
const EXACT_0991_PROVIDER_RECEIPT_SHA256 = "09a7c902f5b7c8bd69f92b5416d496bfe1ba7d09447c6dd3fa6f236851faaea7";
const EXACT_100_VERSION = "1.0.0";
const EXACT_100_GIT_HEAD = "a13d35a742c6ef8462812a28fbe1d8c8b7431c32";
const EXACT_100_PROVIDER_RECEIPT_SHA256 = "4c66f1e7d9276bc39207fb508bca0e0a17b09d71969753d5611ca42982a85e4d";
const EXACT_101_VERSION = "1.0.1";
const EXACT_101_GIT_HEAD = "a7229ddc21810d6245105978033b7df645ecc2f7";
const EXACT_101_PROVIDER_RECEIPT_SHA256 = "b56b0bdd98ebbdca8c178e922b85a00601c4c6e966df430a22fa34f99adb5f16";
const EXACT_102_VERSION = "1.0.2";
const EXACT_102_GIT_HEAD = "cd32f7725fdbddbaecdff5b1e68491563394e0ca";
const EXACT_102_PROVIDER_RECEIPT_SHA256 = "3b09ca73dbb70a64646f57809bb2129e4b01b235da06d895966580d91a39553c";
const EXACT_103_VERSION = "1.0.3";
const EXACT_103_GIT_HEAD = "d78dc83d633229d12f8b79631384c4c2717c399f";
const EXACT_103_PROVIDER_RECEIPT_SHA256 = "1f5ef502f89d8aa0db2784149e18168ed6ec62ed37a231ba78812124b0b1176d";
const EXACT_103_REGISTRY = {
  "@earendil-works/chord": [
    "8e9e2a9b52729db7383d421084f9e6d92526a3ad",
    "sha512-H5pKMs3S1z2q4V7NkDGKDFzOMW+OkzdsnGxxj5wNJUANG03VKj29UVmc1xnnnf0FAc03COHYNxwgNApO0nt0fg=="
  ],
  "@earendil-works/pi-agent-core": [
    "300388ec6ae56d402b1a85c61fefafff5ee8f3e7",
    "sha512-lnvi2PJYaq8mDLzwWBttNqfxrLS63SSMONUJnTCypdvt/flmNJchXwWXsXUOJ5Yhe/mN+iHkrXu696lWZZ8o+w=="
  ],
  "@earendil-works/pi-ai": [
    "31463068aa4f979db0f066aa8c1b79b57d310e35",
    "sha512-p+/EUrbmfT0xWOtL/NJRtWOsyzcKKFSyiivHLDBMG0DUVpHdaIykd5jFibq0YZDFGBN/nv61zdOelMb+ylPfSg=="
  ],
  "@earendil-works/pi-codemode": [
    "0daeb93e109558d7d0dd5d99a73f214926690015",
    "sha512-/rgWAXA9PhuFm0+j6N5FVvvWrAwt1LnhmbjA3Hy5+Q033XUHgh0YCMGAmU76S90ocr0Vfxm50ddYT/O76T5OGQ=="
  ],
  "@earendil-works/pi-coding-agent": [
    "de643ce8049ed7182517bbc5620dacf2b68314c6",
    "sha512-t2lb0dw4y/jr5a2PRo6eTHGTZOPB3/YAMVyhhYFC1W3Hl5xE+462I/gMWjF4gCLuhGipNEfuNqONFmdqLFz4SQ=="
  ],
  "@earendil-works/pi-mcp": [
    "0138f6a96c06c21edca86172c0270007ed1d183f",
    "sha512-ZAhL/g0rpjyKtcKzD0jSDk7sFIrMCQocmKtpAE1F9eRnI5fGGVWUyiZwALG/Tn1sagzxFbSqtc29zGx5OvDDGA=="
  ],
  "@earendil-works/pi-telemetry": [
    "cc53177d242769f3792650eedf0d71ee2d84a903",
    "sha512-Li4YamN09x9zzCquPbtEL2AQmwqv3Vn3sNOYqG0DRg24fjiMfntCsb7QKbejCXZssTAyaN+hutLl6O0UnJDrfg=="
  ],
  "@earendil-works/pi-tui": [
    "512c622ff113c809964217212ab6267c79081177",
    "sha512-C7b8Y+7iz+/oPEZUJubv6NPm3M/4ziq0hjQ2jhqMNpBwcXeqDMYKL2FYP90t2b5S1IoGc2io47dj5ZlIC1IZWg=="
  ]
} as const satisfies Record<(typeof FAMILY_PACKAGES)[number], readonly [string, string]>;

const EXACT_104_VERSION = "1.0.4";
const EXACT_104_GIT_HEAD = "7c10bd4337495ee613f2224843ecdf349b80d1df";
const EXACT_104_PROVIDER_RECEIPT_SHA256 = "014e39f6bb0551f9488d5ff832a91a71531ad513a01b1da766605934713541dd";
const EXACT_104_REGISTRY = {
  "@earendil-works/chord": [
    "6b5b0ee6c5fa5933813b27c263cce37bfa4d2985",
    "sha512-d2JZw2utoa/reoSmL07O71wsXiMDhIlnnxTb4LCNV+Oq8Evj2rGLvjVuYrlXZGbXUr0IDNfvd1RT/utCY1UhkQ=="
  ],
  "@earendil-works/pi-agent-core": [
    "3a52d338895a16e5a7e4eecd0f55919c7fa474af",
    "sha512-/xGICE+N/+G9N7KfYFSxlE8G8fQcBlLHKiY+j1Ehz9vvb1zhvGneWosFK56d2qmA5oteafeG7yKr2nqU4ed9ig=="
  ],
  "@earendil-works/pi-ai": [
    "f398aa4469437bfa0c6326bcb61f7bc4f25840e6",
    "sha512-/Eu5R0gfor6wcmRcVyOmulUiZmsHJ0bKu5wXXnpCoSHF3y4FnW4fgnjRlLjNza8NJWXdvW5Uew90Zukx7Sh2rw=="
  ],
  "@earendil-works/pi-codemode": [
    "128ed3dcc7c60adba83cf3c9233d72cd19b17556",
    "sha512-e198pjBsdEQJ/RCjJ9ZeYIjRaQYWUgtoZbPCmJ57auuOsiRsBXeSZ1aiWtTah0/7gx97WIOD1XqHvgRU0gOXtg=="
  ],
  "@earendil-works/pi-coding-agent": [
    "878235d4ecc2ad3ac6fad0adfeffcf233b8159d7",
    "sha512-+956nfMFHr5lDUVY/2Q4k+YzojzBuCaBXFgj0eSlXVGr7QVliVddKdc1Pz6yVg1dOlJQmb67doOVrlMsIcIdaw=="
  ],
  "@earendil-works/pi-mcp": [
    "73aa5fa6c988211b71775d443ad1124e64f81935",
    "sha512-I6SqOqrKED+XrjkkFIXY7Ze38QtXtjojPJlQsJ2v5soCPV4QI1bNxXDwQaqzZ2a+6pNN8meWrRw1qkSMbPy9QQ=="
  ],
  "@earendil-works/pi-telemetry": [
    "de93bb1dca0a41d11fb8763b2c5c783b53c44236",
    "sha512-DL2eXXtnL5/VQkuQd97fL57GXTG1/zKHtMmDsrv8tGeJ5EgYYTWvzy44dqbYL0lD0Z22v/NOwqU3PHO75HVrqA=="
  ],
  "@earendil-works/pi-tui": [
    "7d3c2baf15f6132573b69b43e4b703b57334f3c6",
    "sha512-TgvDJohtxvG3XWQID5w6bwEyBocywdG0F9yHZtP+Ywvtiq9RgeSMbeB8quUobk7/4ko6IvFOQo45AqIqNVr8Rg=="
  ]
} as const satisfies Record<(typeof FAMILY_PACKAGES)[number], readonly [string, string]>;

const NODE_ENGINE = ">=22.19.0";
const EXACT_0991_REGISTRY = {
  "@earendil-works/chord": ["7f6ba945b705a5ab48d25dbed39b253afcec68df", "sha512-4xyn0IBzJ+Xu/iOGi2hjXJGAR61QEhEWZsIqTDqr+GmItdquYwBO5jYFnqGiBaTqlY12/EpM7QHoEKSHbyvOug=="],
  "@earendil-works/pi-agent-core": ["e918b147f4d3ae1c8c5d435229a2d56d76a3191c", "sha512-zywvWnj5FujeuFI/x/CJHwwxhcLIQgjqseTA+bQgX4O8gJTcgjRd/I8SZnQDqJvxC9QcV12ujiGLviv6EgwcCg=="],
  "@earendil-works/pi-ai": ["2945bf014fbb314bd37b919e83317560e0a8fa1d", "sha512-4nV9JKc94iPX8bwdGPc2nTuVPKIPsffhnp3WoN9NYCNqbtoOF8LhYcIs/+Sn/alroqJK/5QRu6/Z6Ck+n0hyBA=="],
  "@earendil-works/pi-codemode": ["f9965078e21d744fe1b018959359aed1a664f17d", "sha512-oh8TMsBI3SWTN3xTQtX8u5n+BKhnVXcFagroWumfn6/WWfBnDYL/LmeQtjLb83WRTb9rcu+ZdK8rFa4vggvCJg=="],
  "@earendil-works/pi-coding-agent": ["00e7e6c668d67d0825fc8814d80097eb07ec44e0", "sha512-cWUrTOqA5M73cOYMgsh9PlhDrsBhavd+n5kVY6F7BGbGl1RjqCteVCoeVMVqhngoGACVDyw1tbLjajL8l9jrHg=="],
  "@earendil-works/pi-mcp": ["c2002b819a5d75d9cfa8091171580f794c205042", "sha512-YCFGPkmDzLwQuIzwfbP6Vuk/g/ukKpZhwTpbcfzomuI1Fkiu6hHRkOGwAqsO3G8cTkZWkM8vmOkFJjStQNC4qA=="],
  "@earendil-works/pi-telemetry": ["37b1fb0ce8c0ca2fe04363035a4b7aea29a9e8cb", "sha512-9PBPjGk+TXRtuMianpqBbHBpYpyKusESF6rwdmgD0WTZSTUQXhcKEO0hAINRLuSwy4V7yPvXV+EVV0ONY7mbpQ=="],
  "@earendil-works/pi-tui": ["f6f82a4792fabb4aabf310e082743d87accc90cc", "sha512-gZp0Guat96Fr1AuC/xqVz5B2lulZakp/PxD1lXx3lSgBdjiqmwYhJbcQ0HRrGAfy0WtMGn9b05RJr5qJf7oIuw=="],
} as const satisfies Record<(typeof FAMILY_PACKAGES)[number], readonly [string, string]>;

const EXACT_100_REGISTRY = {
  "@earendil-works/chord": ["8807eee9a24f6ba4d40165c01ee0d71fe18aeb28", "sha512-BIfWfrByM0pKq6tfKYXuwx0ed2CvaqIM3EDA7Dps+fP+d3CiPWdlHi1cDsJC05llqKJoRz5//G0hz0yQwwjISQ=="],
  "@earendil-works/pi-agent-core": ["85f539d807600de676919cc93d70df84e850a218", "sha512-bHFONjtEBDqiV+g1DmmtkSlfAaqHELr+XO+6I5Nah4gswwZrLJO4yZB/JjsnlI4AKWTayBLfgS6DCbeBBz9e2Q=="],
  "@earendil-works/pi-ai": ["48afaafcffeafdb951bee89b25c69daf4985c725", "sha512-3/W1vdDaVtpeMd23ElvJC12HLA5yS/BGqqcXF+0SK082dN7cbgNcCwguTBRBC258Ke8SzSvUW1B75iAf8w8IxA=="],
  "@earendil-works/pi-codemode": ["ce4cb7c805a0336c0453b80107e564620397e65a", "sha512-LPpFI4+T9NzDnhBDs15izWAolaoM8xnwqdziRd6Zx8BQeoEPvzefD2vMMzSyF0rOtq34TfQqkZ0ki16f6cGdMg=="],
  "@earendil-works/pi-coding-agent": ["ae6346e0d5e2a7e2d1fdd177965cda781aa3c514", "sha512-/FtbxoSQU/mEv1QnichJjRjqteqaIaMWxmhB4G367+MwZfX7/DI5B9YAg5lqbN7nztFskBEtUSZ+FlmMBECtMw=="],
  "@earendil-works/pi-mcp": ["6f08a86735e7a4801d725ccdfd9e6983d8c64aca", "sha512-rYra0aF5iPmJd+fsB+VBuqxWNABGJ3Iiyhg0CqIc/91ta2n7IvQmCp0Cac/YkUTNnvRsVZnjgAiBkRi6+ouWuw=="],
  "@earendil-works/pi-telemetry": ["313db5570991402c73b2229ed9a50770d3cf1435", "sha512-WjNBj5TYIiPZFQEz2WlULcDwPLaKwIlmsKjVeYM+LJSbnSp38kWsHUJysIDGnu23IcLbKoPtywsvYfUJCeZePA=="],
  "@earendil-works/pi-tui": ["5da2e1eb99844c864d3d0a49e7da2515e03b73df", "sha512-JsT7kXnpZA2YOtQu6RyriyxEO0eJIzPyfiH09bH+OLN5+s18HYkwaUD/tBkjhnSfMu6/50CQPRYJagzSP6HdPw=="],
} as const satisfies Record<(typeof FAMILY_PACKAGES)[number], readonly [string, string]>;

const EXACT_101_REGISTRY = {
  "@earendil-works/chord": ["13487f8c9ec01e9716527276c3123f15b9b1c122", "sha512-woq15kjUZ38fUIMqFrFzTeT0fYYM0CfGS2ELCUE5Ufni32tdxfs0Av2+zz8PXFNxyiC3SB1EnyGPp63CLtp8Fg=="],
  "@earendil-works/pi-agent-core": ["6e6542ad7996f5185bc9dff813132ce02034a9b3", "sha512-os85rJM2hgCOOLdtcQ5WxRRhAbQiTNq9+48/pj6dOUU7czJhU8NTdHmDs41hBfAXR/ZQgstIgrjowEICEXimbQ=="],
  "@earendil-works/pi-ai": ["6f3df9843292c0dc9a1f56257906c717fe7c577b", "sha512-eSA53pdfDLuQTTJn3yz1VC8BBmcX33OKkk8WihOXdVBvbgqqC4zuR6Sf+TeeWuAmh8LuqARoK14R1s2HZqVcsw=="],
  "@earendil-works/pi-codemode": ["e2e77bc9a3810f393c634a4fcd1f28b43c6f8988", "sha512-RpZKpdKceYmIODfqKLJtZWUvfkbDGmEHxEEEYN+i21OFm8uY0sTcBMP4oaLf6SkBVBMPae1Z9GtW27+dIRAYPw=="],
  "@earendil-works/pi-coding-agent": ["c43730168f5482f1c55b462ae43193cc6f7c1e13", "sha512-B7FGYpHpBPvS+Ux16CbCuVnE9S4v6c2h6ykocPNarC4msD/4JM/eFrCrO2wbRkedJZ25myFozSWHvCOx4QnN+w=="],
  "@earendil-works/pi-mcp": ["5d45ee65f5b41cd9fffc4d78d4b630ad9771f61f", "sha512-XuhcCpNT9FgsMQTzjmwy2hbakg9CODcDHtC+KeHfr37HjKdj4QsfOrOThxLXYRN4kmC5HDvFyLzthAnHe/T4jw=="],
  "@earendil-works/pi-telemetry": ["2aa53cd944f9e60920d2d648be279af786d1b5a8", "sha512-SuJ/4KyqZ6j6Whlau710DmusWDKMWCxKXpWqZclY/Cl3tGUuX8IFmbTbW2VRoVuoJpZYVMg6DJmt1mwHMUt9uw=="],
  "@earendil-works/pi-tui": ["ea6cbc09db36f0ea6486e7d8e239f11713bcd025", "sha512-Rk/pWLoDKWI7WvywhLxf+DTYppS7XWTN5IacpqlD+QF+CbrT/y5CCnAHqPEoF41y+XtQJKbNjjzUuJE4yq0Dfg=="],
} as const satisfies Record<(typeof FAMILY_PACKAGES)[number], readonly [string, string]>;

const EXACT_102_REGISTRY = {
  "@earendil-works/chord": [
    "481516ce8b3c32c3d3f2175a4e61c46bc91f7f23",
    "sha512-eUXGZjigyEQsFiT/oBJUOaCrzYZRmqf8AgLrlbyuS4u02hjSVhLYRi3xqk1o4UERCgRfjRegqwj/oucawIR7YQ=="
  ],
  "@earendil-works/pi-agent-core": [
    "3c4925221694722007e26762310ee5c5e682dd7a",
    "sha512-VRfewY1R5mbedJzlm01PxdCmqU8QrSXjXXhV50bp6rvVuT8YYQv1inTXRY4YzssmGAYpkC2rXipJKP5BpBFXew=="
  ],
  "@earendil-works/pi-ai": [
    "491b32ed7dd8e333a58a55dfc18ff61e31bc43c9",
    "sha512-JP59xGlSAQ/HhQ6EHN5qmneBlWfDyu6FPPryAvAaSo8A38ubAsEpS9YisCM5Jbbns0srrDffLZonE0OXorHI5A=="
  ],
  "@earendil-works/pi-codemode": [
    "2bb448ee639e7db6317d878798631b91c248bbcd",
    "sha512-tvfDSVz984ra/4y/hIFmYGpP5ojC+C6/ey+DNbjTzfJvbXviW4JYTXwVcm33KAceI0xcOuE+P1yRGLtQgis0/w=="
  ],
  "@earendil-works/pi-coding-agent": [
    "aba0009c736a1de4e045665acceb017cdb791371",
    "sha512-3ZdIghMSELMGV3sKi5iASOb1Jwb696fLjmNu0aezaqDxTLLWWoRpqBYkGxJ1CgAMCbtfqXWEF0lcRrlVXmiEGQ=="
  ],
  "@earendil-works/pi-mcp": [
    "a48b3b1e83281076a1de7e15fd1c8b4a91171782",
    "sha512-ED3+q41xLQkxzdadZIQy68SLYcqCJbve8iGbGkZoWjPJ9OZCPHTKcof24fjMO1LfnbIl1uMfhRBueS6IfdiCbQ=="
  ],
  "@earendil-works/pi-telemetry": [
    "4abc269759cbc6fa434b252d5789003947b828a4",
    "sha512-Ev5h9TE8nEXHCfRKhWj0qpUFhQgVqNteS95vsM2KNGRGm533vOO2ruDPaEwImBKPMBKXy4omz3D6V2cm41gLOQ=="
  ],
  "@earendil-works/pi-tui": [
    "0169e89755e3bc7d9b5df2760032f84991f183e7",
    "sha512-ElfzjnckohEjzHK5Q5iOpqLpQ1YbM/c/XmjBdPVR5k4uoorQPnny5BtT+rvC0cAjVVCUOHWAWppust7FAaEsOQ=="
  ]
} as const satisfies Record<(typeof FAMILY_PACKAGES)[number], readonly [string, string]>;

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
const EXACT_VERSION_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const EXACT_GIT_HEAD_RE = /^[0-9a-f]{40}$/;
const SOURCE_EXPORT_CONDITION = "source";
const PROBE_MARKER = "EAR_ENDIL_PACKAGE_ADMISSION=";

type JsonObject = Record<string, unknown>;

export type AdmissionOptions = {
  readonly consumerRoot: string;
  readonly version: string;
  readonly gitHead: string;
  readonly registryReceiptPath?: string;
  readonly providerReceiptPath?: string;
  readonly tarballDir?: string;
  readonly bunPath: string;
};

export type ProviderAuthReceipt = {
  readonly path: string;
  readonly version: string;
  readonly gitHead: string;
  readonly providers: ReadonlyArray<{ readonly id: string; readonly name: string; readonly apiKey: boolean; readonly oauth: boolean }>;
};

export type ExportTargetReceipt = {
  readonly conditions: readonly string[];
  readonly target: string;
  readonly absolutePath: string;
  readonly exists: boolean;
};

export type InstalledAdmissionReceipt = {
  readonly consumerRoot: string;
  readonly expected: { readonly version: string; readonly gitHead: string };
  readonly directDependency: { readonly name: typeof CODING_AGENT_PACKAGE; readonly specifier: string };
  readonly packages: ReadonlyArray<{
    readonly name: string;
    readonly version: string;
    readonly packageJson: string;
    readonly installedGitHead?: string;
  }>;
  readonly registryReceipt?: {
    readonly path: string;
    readonly nodeEngine: typeof NODE_ENGINE;
    readonly packages: ReadonlyArray<{
      readonly name: (typeof FAMILY_PACKAGES)[number];
      readonly version: string;
      readonly gitHead: string;
      readonly shasum: string;
      readonly integrity: string;
      readonly tarball: string;
    }>;
  };
  readonly providerAuthReceipt?: ProviderAuthReceipt;
  readonly tarballVerification?: ReadonlyArray<{ readonly name: string; readonly tarball: string; readonly shasum: string; readonly integrity: string; readonly installedTreeSha256: string }>;
  readonly gitHeadMetadata: {
    readonly source: "caller-supplied registry/release receipt";
    readonly expected: string;
    readonly installedPackageJsonValues: ReadonlyArray<{ readonly name: string; readonly gitHead: string }>;
    readonly packageMetadataVerification: "matched where present";
    readonly note: string;
  };
  readonly codingAgentExports: {
    readonly root: { readonly admitted: true; readonly targets: readonly ExportTargetReceipt[] };
    readonly sourceOnly: ReadonlyArray<{
      readonly subpath: string;
      readonly admitted: false;
      readonly targets: readonly ExportTargetReceipt[];
    }>;
  };
  readonly modernPublicExports?: ReadonlyArray<{
    readonly packageName: string;
    readonly subpath: string;
    readonly targets: readonly ExportTargetReceipt[];
  }>;
};

export type RuntimeProbeReceipt = {
  readonly requestedRuntime: "node" | "bun";
  readonly requestedExecutable: string;
  readonly actualRuntime: {
    readonly execPath: string;
    readonly release: string;
    readonly version: string;
    readonly node?: string;
    readonly bun?: string;
  };
  readonly rootExports: Record<string, string>;
  readonly mcpRootExports?: Record<string, string>;
  readonly mcpOauthExports?: Record<string, string>;
  readonly bunOauth?: { readonly registerBunOAuthFlows: "function"; readonly called: true };
  readonly sideEffectEnforcement: Readonly<{ readonly mode: "node-permission" | "bun-preload"; readonly networkDenied: true; readonly childProcessDenied: true; readonly networkAttempts: number | null; readonly childProcessAttempts: number | null }>;
  readonly providerAuth?: ReadonlyArray<{ readonly id: string; readonly name: string; readonly apiKey: boolean; readonly oauth: boolean }>;
  readonly sourceOnlyDeepPaths: ReadonlyArray<{
    readonly specifier: string;
    readonly admitted: false;
    readonly status: "rejected";
    readonly error: { readonly name: string; readonly code?: string; readonly message: string };
  }>;
  readonly removedImports?: RuntimeProbeReceipt["privateDeepPaths"];
  readonly removedCoreExports?: Record<string, string>;
  readonly privateDeepPaths?: ReadonlyArray<{
    readonly specifier: string;
    readonly admitted: false;
    readonly status: "rejected";
    readonly error: { readonly name: string; readonly code?: string; readonly message: string };
  }>;
};

export type EarendilPackageAdmissionReceipt = InstalledAdmissionReceipt & {
  readonly admitted: true;
  readonly probeEnvironment: {
    readonly inheritedSecrets: false;
    readonly offlineRequested: true;
    readonly telemetry: "disabled";
    readonly networkSandboxed: false;
  };
  readonly sideEffectEnforcement: ReadonlyArray<{ readonly runtime: "node"|"bun"; readonly mode: "node-permission"|"bun-preload"; readonly networkDenied: true; readonly childProcessDenied: true; readonly networkAttempts: number|null; readonly childProcessAttempts: number|null }>;
  readonly runtimes: readonly RuntimeProbeReceipt[];
};

function usage(): string {
  return [
    "Usage:",
    "  bun scripts/check-earendil-package-admission.ts \\",
    "    --consumer-root <installed-consumer> --version <exact-version> \\",
    "    --git-head <exact-40-char-sha> \\",
    "    --bun <bun-path> [--registry-receipt <json>] [--provider-receipt <json>] [--tarball-dir <dir>]",
    "",
    "The check is Bun-only, read-only and offline. --git-head is a caller-supplied metadata receipt;",
    "packed package.json files are checked when they contain gitHead, but npm commonly omits it.",
    "--registry-receipt and --provider-receipt are required for versions >=0.99.0 and optional for older history.",
  ].join("\n");
}

function takeOptionValue(args: readonly string[], index: number, name: string): { value: string; nextIndex: number } {
  const argument = args[index]!;
  const inlinePrefix = `${name}=`;
  if (argument.startsWith(inlinePrefix)) {
    const value = argument.slice(inlinePrefix.length);
    if (!value) throw new Error(`${name} requires a value`);
    return { value, nextIndex: index };
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return { value, nextIndex: index + 1 };
}

export function parseAdmissionArgs(args: readonly string[]): AdmissionOptions | { readonly help: true } {
  let consumerRoot: string | undefined;
  let version: string | undefined;
  let gitHead: string | undefined;
  let registryReceiptPath: string | undefined;
  let providerReceiptPath: string | undefined;
  let tarballDir: string | undefined;
  let bunPath: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") return { help: true };
    const name = argument.includes("=") ? argument.slice(0, argument.indexOf("=")) : argument;
    if (!["--consumer-root", "--version", "--git-head", "--registry-receipt", "--provider-receipt", "--tarball-dir", "--bun"].includes(name)) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const option = takeOptionValue(args, index, name);
    index = option.nextIndex;
    if (name === "--consumer-root") {
      if (consumerRoot !== undefined) throw new Error("--consumer-root may only be supplied once");
      consumerRoot = option.value;
    } else if (name === "--version") {
      if (version !== undefined) throw new Error("--version may only be supplied once");
      version = option.value;
    } else if (name === "--git-head") {
      if (gitHead !== undefined) throw new Error("--git-head may only be supplied once");
      gitHead = option.value;
    } else if (name === "--registry-receipt") {
      if (registryReceiptPath !== undefined) throw new Error("--registry-receipt may only be supplied once");
      registryReceiptPath = resolve(option.value);
    } else if (name === "--provider-receipt") {
      if (providerReceiptPath !== undefined) throw new Error("--provider-receipt may only be supplied once");
      providerReceiptPath = resolve(option.value);
    } else if (name === "--tarball-dir") {
      if (tarballDir !== undefined) throw new Error("--tarball-dir may only be supplied once");
      tarballDir = resolve(option.value);
    } else {
      if (bunPath !== undefined) throw new Error("--bun may only be supplied once");
      bunPath = option.value;
    }
  }

  if (!consumerRoot) throw new Error("--consumer-root is required");
  if (!version) throw new Error("--version is required");
  if (!EXACT_VERSION_RE.test(version)) throw new Error(`--version must be an exact semantic version, received: ${version}`);
  if (!gitHead) throw new Error("--git-head is required");
  if (!EXACT_GIT_HEAD_RE.test(gitHead)) throw new Error("--git-head must be an exact lowercase 40-character commit SHA");
  if (!bunPath) throw new Error("--bun is required");
  if (modernContractRequired(version) && !registryReceiptPath) {
    throw new Error(`--registry-receipt is required for versions >=${MODERN_CONTRACT_VERSION}`);
  }
  if (modernContractRequired(version) && !providerReceiptPath) {
    throw new Error(`--provider-receipt is required for versions >=${MODERN_CONTRACT_VERSION}`);
  }
  if (modernContractRequired(version) && !tarballDir) {
    throw new Error(`--tarball-dir is required for versions >=${MODERN_CONTRACT_VERSION}`);
  }

  return {
    consumerRoot: resolve(consumerRoot), version, gitHead,
    ...(registryReceiptPath === undefined ? {} : { registryReceiptPath }),
    ...(providerReceiptPath === undefined ? {} : { providerReceiptPath }),
    ...(tarballDir === undefined ? {} : { tarballDir }),
    bunPath,
  };
}

function readJsonObject(path: string, label: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${label} at ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must contain a JSON object: ${path}`);
  return parsed as JsonObject;
}

function versionAtLeast(version: string, minimum: string): boolean {
  const parse = (value: string) => value.split(/[.+-]/, 3).map((part) => Number(part));
  const current = parse(version);
  const required = parse(minimum);
  for (let index = 0; index < 3; index++) {
    if (current[index]! !== required[index]!) return current[index]! > required[index]!;
  }
  return !version.includes("-") || minimum.includes("-");
}

function modernContractRequired(version: string): boolean {
  return versionAtLeast(version, MODERN_CONTRACT_VERSION);
}

function isCurrentLoopVersion(version: string): boolean {
  return version === EXACT_100_VERSION || version === EXACT_101_VERSION || version === EXACT_102_VERSION || version === EXACT_103_VERSION || version === EXACT_104_VERSION;
}

function packagesForVersion(version: string): readonly string[] {
  return modernContractRequired(version) ? FAMILY_PACKAGES : LEGACY_FAMILY_PACKAGES;
}

function expectedTarball(name: string, version: string): string {
  return `https://registry.npmjs.org/${name}/-/${name.slice(name.indexOf("/") + 1)}-${version}.tgz`;
}

export function validateProviderAuthReceipt(pathInput: string, version: string, gitHead: string): ProviderAuthReceipt {
  const path = realpathSync(resolve(pathInput));
  const bytes=readFileSync(path);
  if(version===EXACT_0991_VERSION&&createHash("sha256").update(bytes).digest("hex")!==EXACT_0991_PROVIDER_RECEIPT_SHA256) throw new Error("provider auth receipt hash differs from exact 0.99.1 receipt");
  if(version===EXACT_100_VERSION&&createHash("sha256").update(bytes).digest("hex")!==EXACT_100_PROVIDER_RECEIPT_SHA256) throw new Error("provider auth receipt hash differs from exact 1.0.0 receipt");
  if(version===EXACT_101_VERSION&&createHash("sha256").update(bytes).digest("hex")!==EXACT_101_PROVIDER_RECEIPT_SHA256) throw new Error("provider auth receipt hash differs from exact 1.0.1 receipt");
  if(version===EXACT_102_VERSION&&createHash("sha256").update(bytes).digest("hex")!==EXACT_102_PROVIDER_RECEIPT_SHA256) throw new Error("provider auth receipt hash differs from exact 1.0.2 receipt");
  if(version===EXACT_103_VERSION&&createHash("sha256").update(bytes).digest("hex")!==EXACT_103_PROVIDER_RECEIPT_SHA256) throw new Error("provider auth receipt hash differs from exact 1.0.3 receipt");
  if(version===EXACT_104_VERSION&&createHash("sha256").update(bytes).digest("hex")!==EXACT_104_PROVIDER_RECEIPT_SHA256) throw new Error("provider auth receipt hash differs from exact 1.0.4 receipt");
  const parsed = readJsonObject(path, "provider auth receipt");
  if (parsed.version !== version || parsed.gitHead !== gitHead || !Array.isArray(parsed.providers)) throw new Error("provider auth receipt version/gitHead/providers mismatch");
  const providers = parsed.providers.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`provider auth receipt entry ${index} must be an object`);
    const entry = raw as JsonObject;
    if (typeof entry.id !== "string" || !entry.id || typeof entry.name !== "string" || !entry.name
      || typeof entry.apiKey !== "boolean" || typeof entry.oauth !== "boolean" || (!entry.apiKey && !entry.oauth)
      || Object.keys(entry).some((key) => !["id","name","apiKey","oauth"].includes(key))) throw new Error(`invalid provider auth receipt entry ${index}`);
    return { id: entry.id, name: entry.name, apiKey: entry.apiKey, oauth: entry.oauth };
  });
  const ids=providers.map(provider=>provider.id);
  if (providers.length !== 42 || new Set(ids).size !== providers.length || JSON.stringify(ids) !== JSON.stringify([...ids].sort())) throw new Error("provider auth receipt must contain 42 unique providers sorted by id");
  for (const required of ["openai","openai-codex","github-copilot","anthropic","kimi-coding","openrouter","radius","amazon-bedrock","google","google-vertex",version === EXACT_103_VERSION || version === EXACT_104_VERSION ? "azure" : "azure-openai-responses"]) {
    if (!ids.includes(required)) throw new Error(`provider auth receipt missing ${required}`);
  }
  return { path, version, gitHead, providers };
}

export function validateRegistryReceipt(pathInput: string, version: string, gitHead: string): NonNullable<InstalledAdmissionReceipt["registryReceipt"]> {
  const path = realpathSync(resolve(pathInput));
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read registry receipt at ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!Array.isArray(parsed)) throw new Error(`registry receipt must contain an array: ${path}`);
  const target = version === EXACT_0991_VERSION
    ? { gitHead: EXACT_0991_GIT_HEAD, packages: EXACT_0991_REGISTRY }
    : version === EXACT_100_VERSION
      ? { gitHead: EXACT_100_GIT_HEAD, packages: EXACT_100_REGISTRY }
      : version === EXACT_101_VERSION
        ? { gitHead: EXACT_101_GIT_HEAD, packages: EXACT_101_REGISTRY }
        : version === EXACT_102_VERSION ? { gitHead: EXACT_102_GIT_HEAD, packages: EXACT_102_REGISTRY }
          : version === EXACT_103_VERSION ? { gitHead: EXACT_103_GIT_HEAD, packages: EXACT_103_REGISTRY }
          : version === EXACT_104_VERSION ? { gitHead: EXACT_104_GIT_HEAD, packages: EXACT_104_REGISTRY } : null;
  if (!target) throw new Error(`modern package admission supports exact ${EXACT_0991_VERSION}, ${EXACT_100_VERSION}, ${EXACT_101_VERSION}, ${EXACT_102_VERSION}, ${EXACT_103_VERSION}, or ${EXACT_104_VERSION}, received ${version}`);
  if (gitHead !== target.gitHead) throw new Error(`${version} registry receipt requires gitHead ${target.gitHead}`);

  const seen = new Set<string>();
  const packages = parsed.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`registry receipt entry ${index} must be an object`);
    const entry = value as JsonObject;
    const name = entry.name;
    if (typeof name !== "string" || !FAMILY_PACKAGES.some((candidate) => candidate === name)) {
      throw new Error(`registry receipt has extra package: ${String(name)}`);
    }
    if (seen.has(name)) throw new Error(`registry receipt has duplicate package: ${name}`);
    seen.add(name);
    if (entry.version !== version) throw new Error(`registry receipt ${name} version mismatch`);
    if (entry.gitHead !== gitHead) throw new Error(`registry receipt ${name} gitHead mismatch`);
    const dist = entry.dist;
    if (!dist || typeof dist !== "object" || Array.isArray(dist)) throw new Error(`registry receipt ${name} dist must be an object`);
    const distribution = dist as JsonObject;
    const expected = target.packages[name as keyof typeof target.packages];
    if (distribution.shasum !== expected[0]) throw new Error(`registry receipt ${name} shasum mismatch`);
    if (distribution.integrity !== expected[1]) throw new Error(`registry receipt ${name} integrity mismatch`);
    const tarball = expectedTarball(name, version);
    if (distribution.tarball !== tarball) throw new Error(`registry receipt ${name} tarball mismatch`);
    const engines = entry.engines;
    if (!engines || typeof engines !== "object" || Array.isArray(engines) || (engines as JsonObject).node !== NODE_ENGINE) {
      throw new Error(`registry receipt ${name} must declare Node ${NODE_ENGINE}`);
    }
    return {
      name: name as (typeof FAMILY_PACKAGES)[number], version, gitHead,
      shasum: expected[0], integrity: expected[1], tarball,
    };
  });
  const missing = FAMILY_PACKAGES.filter((name) => !seen.has(name));
  if (missing.length > 0) throw new Error(`registry receipt is missing packages: ${missing.join(", ")}`);
  if (packages.length !== FAMILY_PACKAGES.length) throw new Error(`registry receipt must contain exactly ${FAMILY_PACKAGES.length} packages`);
  return { path, nodeEngine: NODE_ENGINE, packages };
}

function fileDigest(path: string): string { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
export function packagePayloadDigest(rootInput: string): string {
  const root=realpathSync(rootInput), records:string[]=[];
  const walk=(directory:string)=>{for(const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    // Dependency placement is installer-owned; inspectInstalledTree validates
    // its identities/versions separately. Deeper package-owned directories count.
    if(directory===root&&entry.name==="node_modules")continue;
    const absolute=join(directory,entry.name),relative=absolute.slice(root.length+1).split(sep).join("/");
    if(entry.isDirectory())walk(absolute);
    else if(entry.isFile())records.push(`f\t${relative}\t${fileDigest(absolute)}`);
    else if(entry.isSymbolicLink())records.push(`l\t${relative}\t${readlinkSync(absolute)}`);
    else throw new Error(`unsupported package entry type: ${relative}`);
  }};walk(root);return createHash("sha256").update(records.join("\n")).digest("hex");
}
function verifyPublishedTarballs(consumerRoot:string,tarballDirInput:string,registry:NonNullable<InstalledAdmissionReceipt["registryReceipt"]>):NonNullable<InstalledAdmissionReceipt["tarballVerification"]>{
  const tarballDir=realpathSync(resolve(tarballDirInput)),scratch=mkdtempSync(join(tmpdir(),"earendil-published-tarballs-"));
  try{return registry.packages.map(entry=>{
    const filename=`${entry.name.slice(entry.name.indexOf("/")+1)}-${entry.version}.tgz`,tarball=join(tarballDir,filename);
    if(!existsSync(tarball)||!statSync(tarball).isFile())throw new Error(`published tarball missing: ${filename}`);
    const bytes=readFileSync(tarball),shasum=createHash("sha1").update(bytes).digest("hex"),integrity=`sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    if(shasum!==entry.shasum||integrity!==entry.integrity)throw new Error(`published tarball hash mismatch: ${entry.name}`);
    const unpack=join(scratch,filename);mkdirSync(unpack,{recursive:true});
    const result=Bun.spawnSync(["tar","-xzf",tarball,"-C",unpack],{stdout:"pipe",stderr:"pipe",timeout:30_000});
    if(result.exitCode!==0)throw new Error(`cannot extract ${entry.name}: ${result.stderr.toString()}`);
    const published=join(unpack,"package"),installed=packageDirectory(consumerRoot,entry.name);
    const publishedDigest=packagePayloadDigest(published),installedTreeSha256=packagePayloadDigest(installed);
    if(publishedDigest!==installedTreeSha256)throw new Error(`installed package tree differs from published tarball: ${entry.name}`);
    return {name:entry.name,tarball,shasum,integrity,installedTreeSha256};
  });}finally{rmSync(scratch,{recursive:true,force:true});}
}

function packageDirectory(consumerRoot: string, packageName: string): string {
  return join(consumerRoot, "node_modules", ...packageName.split("/"));
}

function packageManifestPath(consumerRoot: string, packageName: string): string {
  return join(packageDirectory(consumerRoot, packageName), "package.json");
}

function validateDirectDependencies(consumerManifest: JsonObject, expectedVersion: string): void {
  const dependencies = consumerManifest.dependencies;
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
    throw new Error(`consumer dependencies must contain only ${CODING_AGENT_PACKAGE} at ${expectedVersion}`);
  }
  const entries = Object.entries(dependencies as JsonObject);
  if (entries.length !== 1 || entries[0]?.[0] !== CODING_AGENT_PACKAGE || entries[0]?.[1] !== expectedVersion) {
    throw new Error(`consumer dependencies must contain only ${CODING_AGENT_PACKAGE}: ${expectedVersion}`);
  }
  for (const field of DEPENDENCY_FIELDS.slice(1)) {
    const value = consumerManifest[field];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const directNames = Object.keys(value as JsonObject);
    if (directNames.length > 0) throw new Error(`consumer ${field} must be empty; coding-agent is the only admitted direct dependency`);
  }
}

function listPackageDirectories(nodeModules: string): string[] {
  if (!existsSync(nodeModules)) return [];
  const directories: string[] = [];
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (entry.name === ".bin") continue;
    const entryPath = join(nodeModules, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
        if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) directories.push(join(entryPath, scopedEntry.name));
      }
    } else if (entry.isDirectory() || entry.isSymbolicLink()) {
      directories.push(entryPath);
    }
  }
  return directories;
}

function inspectInstalledTree(consumerRoot: string, version: string, gitHead: string): void {
  const pending = [join(consumerRoot, "node_modules")];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeModules = pending.pop()!;
    let identity: string;
    try {
      identity = realpathSync(nodeModules);
    } catch {
      continue;
    }
    if (visited.has(identity)) continue;
    visited.add(identity);
    const server = join(nodeModules, ...SERVER_PACKAGE.split("/"));
    if (existsSync(server)) throw new Error(`${SERVER_PACKAGE} must not be installed: ${server}`);
    for (const packageDir of listPackageDirectories(nodeModules)) {
      if (packageDir.endsWith(`${sep}.pnpm`)) {
        for (const container of listPackageDirectories(packageDir)) pending.push(join(container, "node_modules"));
      } else {
        const path = join(packageDir, "package.json");
        if (existsSync(path)) {
          const metadata = readJsonObject(path, "installed dependency");
          if (metadata.name === SERVER_PACKAGE) throw new Error(`${SERVER_PACKAGE} must not be installed: ${packageDir}`);
          if (isCurrentLoopVersion(version) && metadata.name === "@earendil-works/pi-durable") {
            throw new Error("pi-durable is outside current-loop admission and must not be installed");
          }
          if (typeof metadata.name === "string" && FAMILY_PACKAGES.some((name) => name === metadata.name)) {
            if (metadata.version !== version) throw new Error(`nested family version drift: ${metadata.name} at ${packageDir}`);
            if (metadata.gitHead !== undefined && metadata.gitHead !== gitHead) throw new Error(`nested family gitHead drift: ${metadata.name}`);
          }
        }
        pending.push(join(packageDir, "node_modules"));
      }
    }
  }
}

function collectExportTargets(value: unknown, conditions: readonly string[] = []): ExportTargetReceipt[] {
  if (typeof value === "string") return [{ conditions, target: value, absolutePath: "", exists: false }];
  if (Array.isArray(value)) return value.flatMap((entry, index) => collectExportTargets(entry, [...conditions, `[${index}]`]));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as JsonObject).flatMap(([condition, entry]) => collectExportTargets(entry, [...conditions, condition]));
}

function targetAbsolutePath(packageDir: string, target: string): string {
  if (!target.startsWith("./")) throw new Error(`package export target must be relative: ${target}`);
  const absolutePath = resolve(packageDir, target);
  const root = resolve(packageDir);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) throw new Error(`package export target escapes package: ${target}`);
  return absolutePath;
}

function inspectTargets(packageDir: string, value: unknown): ExportTargetReceipt[] {
  return collectExportTargets(value).map((target) => {
    const absolutePath = targetAbsolutePath(packageDir, target.target);
    return { ...target, absolutePath, exists: existsSync(absolutePath) };
  });
}

function inspectCodingAgentExports(packageDir: string, manifest: JsonObject): InstalledAdmissionReceipt["codingAgentExports"] {
  const exportsValue = manifest.exports;
  if (!exportsValue || typeof exportsValue !== "object" || Array.isArray(exportsValue)) {
    throw new Error(`${CODING_AGENT_PACKAGE} must declare package exports`);
  }
  const packageExports = exportsValue as JsonObject;
  const rootTargets = inspectTargets(packageDir, packageExports["."]);
  if (rootTargets.length === 0) throw new Error(`${CODING_AGENT_PACKAGE} root export has no targets`);
  if (!rootTargets.some((target) => target.conditions.includes("import") || target.conditions.length === 0)) {
    throw new Error(`${CODING_AGENT_PACKAGE} root export has no import target`);
  }
  const missingRootTargets = rootTargets.filter((target) => !target.exists);
  if (missingRootTargets.length > 0) {
    throw new Error(`${CODING_AGENT_PACKAGE} root export targets are missing: ${missingRootTargets.map((target) => target.target).join(", ")}`);
  }

  const sourceOnly = SOURCE_ONLY_DEEP_PATHS.map((subpath) => {
    const targets = inspectTargets(packageDir, packageExports[subpath]);
    if (targets.length === 0) throw new Error(`${CODING_AGENT_PACKAGE} must declare ${subpath} as a source-only export`);
    const runtimeTarget = targets.find((target) => !target.conditions.includes(SOURCE_EXPORT_CONDITION));
    if (runtimeTarget) throw new Error(`${CODING_AGENT_PACKAGE} ${subpath} is runtime-admitted by condition ${runtimeTarget.conditions.join("/") || "default"}`);
    return { subpath, admitted: false as const, targets };
  });

  return { root: { admitted: true, targets: rootTargets }, sourceOnly };
}

function inspectRequiredPublicExport(consumerRoot: string, packageName: string, subpath: string): NonNullable<InstalledAdmissionReceipt["modernPublicExports"]>[number] {
  const packageDir = packageDirectory(consumerRoot, packageName);
  const manifest = readJsonObject(join(packageDir, "package.json"), `${packageName} package.json`);
  const exportsValue = manifest.exports;
  if (!exportsValue || typeof exportsValue !== "object" || Array.isArray(exportsValue)) {
    throw new Error(`${packageName} must declare package exports`);
  }
  const value = (exportsValue as JsonObject)[subpath];
  const targets = inspectTargets(packageDir, value);
  for (const condition of ["types", "import"] as const) {
    const target = targets.find((candidate) => candidate.conditions.includes(condition));
    if (!target) throw new Error(`${packageName} ${subpath} has no ${condition} target`);
    if (!target.exists) throw new Error(`${packageName} ${subpath} ${condition} target is missing: ${target.target}`);
  }
  return { packageName, subpath, targets };
}

export function inspectInstalledConsumer(options: Pick<AdmissionOptions, "consumerRoot" | "version" | "gitHead" | "registryReceiptPath" | "providerReceiptPath" | "tarballDir">): InstalledAdmissionReceipt {
  const consumerRoot = realpathSync(resolve(options.consumerRoot));
  const consumerManifest = readJsonObject(join(consumerRoot, "package.json"), "consumer package.json");
  validateDirectDependencies(consumerManifest, options.version);

  inspectInstalledTree(consumerRoot, options.version, options.gitHead);

  const modern = modernContractRequired(options.version);
  if (modern && !options.registryReceiptPath) throw new Error(`registry receipt is required for versions >=${MODERN_CONTRACT_VERSION}`);
  if (modern && !options.providerReceiptPath) throw new Error(`provider receipt is required for versions >=${MODERN_CONTRACT_VERSION}`);
  const registryReceipt = modern
    ? validateRegistryReceipt(options.registryReceiptPath!, options.version, options.gitHead)
    : undefined;
  const providerAuthReceipt = modern
    ? validateProviderAuthReceipt(options.providerReceiptPath!, options.version, options.gitHead)
    : undefined;
  const tarballVerification = modern && options.tarballDir
    ? verifyPublishedTarballs(consumerRoot, options.tarballDir, registryReceipt!)
    : undefined;
  const expectedPackages = packagesForVersion(options.version);
  const installedGitHeads: Array<{ name: string; gitHead: string }> = [];
  const packages = expectedPackages.map((name) => {
    const packageJson = packageManifestPath(consumerRoot, name);
    const manifest = readJsonObject(packageJson, `${name} package.json`);
    if (manifest.name !== name) throw new Error(`installed package identity mismatch at ${packageJson}: expected ${name}`);
    if (manifest.version !== options.version) throw new Error(`${name} version mismatch: expected ${options.version}, found ${String(manifest.version)}`);
    if (modern && (!manifest.engines || typeof manifest.engines !== "object" || Array.isArray(manifest.engines) || (manifest.engines as JsonObject).node !== NODE_ENGINE)) {
      throw new Error(`${name} installed package must declare Node ${NODE_ENGINE}`);
    }
    if (manifest.gitHead !== undefined) {
      if (manifest.gitHead !== options.gitHead) throw new Error(`${name} gitHead mismatch: expected ${options.gitHead}, found ${String(manifest.gitHead)}`);
      installedGitHeads.push({ name, gitHead: options.gitHead });
    }
    return { name, version: options.version, packageJson, ...(manifest.gitHead === undefined ? {} : { installedGitHead: options.gitHead }) };
  });

  const codingAgentDir = packageDirectory(consumerRoot, CODING_AGENT_PACKAGE);
  const codingManifest = readJsonObject(join(codingAgentDir, "package.json"), `${CODING_AGENT_PACKAGE} package.json`);
  const codingAgentExports = inspectCodingAgentExports(codingAgentDir, codingManifest);
  const modernPublicExports = modern ? [
    inspectRequiredPublicExport(consumerRoot, MCP_PACKAGE, "."),
    inspectRequiredPublicExport(consumerRoot, MCP_PACKAGE, "./oauth"),
    inspectRequiredPublicExport(consumerRoot, AI_PACKAGE, "./bun-oauth"),
  ] : undefined;

  return {
    consumerRoot,
    expected: { version: options.version, gitHead: options.gitHead },
    directDependency: { name: CODING_AGENT_PACKAGE, specifier: options.version },
    packages,
    ...(registryReceipt === undefined ? {} : { registryReceipt }),
    ...(providerAuthReceipt === undefined ? {} : { providerAuthReceipt }),
    ...(tarballVerification === undefined ? {} : { tarballVerification }),
    gitHeadMetadata: {
      source: "caller-supplied registry/release receipt",
      expected: options.gitHead,
      installedPackageJsonValues: installedGitHeads,
      packageMetadataVerification: "matched where present",
      note: "npm tarballs may omit gitHead; verify the supplied receipt against registry or release provenance separately",
    },
    codingAgentExports,
    ...(modernPublicExports === undefined ? {} : { modernPublicExports }),
  };
}

function resolveExecutable(path: string, label: string): string {
  const absolutePath = realpathSync(resolve(path));
  const stat = statSync(absolutePath);
  if (!stat.isFile()) throw new Error(`${label} executable is not a file: ${absolutePath}`);
  if (process.platform !== "win32") accessSync(absolutePath, constants.X_OK);
  return absolutePath;
}

function writeProbePreload(scratch:string):string{
  const path=join(scratch,"guard-preload.ts");
  const program=`import {mock} from "bun:test";const state={mode:"bun-preload",networkDenied:true,childProcessDenied:true,networkAttempts:0,childProcessAttempts:0};globalThis.__ADMISSION_ENFORCEMENT__=state;const net=()=>{state.networkAttempts++;throw Error("network disabled by admission preload")};const child=()=>{state.childProcessAttempts++;throw Error("child process disabled by admission preload")};globalThis.fetch=net;for(const name of ["node:http","node:https","node:net","node:tls","node:dgram"]){const m=await import(name);mock.module(name,()=>({...m,default:{...m.default,request:net,get:net,connect:net,createConnection:net,createSocket:net},request:net,get:net,connect:net,createConnection:net,createSocket:net}));}const cp=await import("node:child_process");mock.module("node:child_process",()=>({...cp,default:{...cp.default,spawn:child,spawnSync:child,exec:child,execSync:child,execFile:child,execFileSync:child,fork:child},spawn:child,spawnSync:child,exec:child,execSync:child,execFile:child,execFileSync:child,fork:child}));Bun.spawn=child;Bun.spawnSync=child;Bun.connect=net;Bun.listen=net;Bun.serve=net;Bun.udpSocket=net;globalThis.WebSocket=class{constructor(){net();}};\n`;
  writeFileSync(path,program);return path;
}

function createProbeEnvironment(scratch: string, executable: string): Record<string, string> {
  const home = join(scratch, "home");
  const cache = join(home, ".cache");
  const config = join(home, ".config");
  const data = join(home, ".local", "share");
  const temp = join(scratch, "tmp");
  for (const path of [home, cache, config, data, temp]) mkdirSync(path, { recursive: true });
  return {
    PATH: [dirname(executable), "/usr/local/bin", "/usr/bin", "/bin"].join(delimiter),
    AUTH_PATH: join(scratch, "auth.json"),
    HOME: home,
    XDG_CACHE_HOME: cache,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    CI: "1",
    NO_COLOR: "1",
    DO_NOT_TRACK: "1",
    OTEL_SDK_DISABLED: "true",
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
  };
}

export function probeProgram(version = "0.87.1"): string {
  const modern = modernContractRequired(version);
  const codingExports = modern ? MODERN_CODING_AGENT_EXPORTS : MODERN_CODING_AGENT_EXPORTS.slice(0, 3);
  return `
const serializeError = (error) => ({
  name: error instanceof Error ? error.name : "UnknownError",
  ...(error && typeof error === "object" && "code" in error ? { code: String(error.code) } : {}),
  message: error instanceof Error ? error.message : String(error),
});
const enforcement=globalThis.__ADMISSION_ENFORCEMENT__;
if(!enforcement||!enforcement.mode)throw new Error("admission side-effect enforcement unavailable");
const receipt = {
  sideEffectEnforcement: enforcement,
  actualRuntime: {
    execPath: process.execPath,
    release: process.release?.name ?? "unknown",
    version: process.version,
    ...(process.versions?.node ? { node: process.versions.node } : {}),
    ...(process.versions?.bun ? { bun: process.versions.bun } : {}),
  },
  rootExports: {},
  sourceOnlyDeepPaths: [],
  ...(${JSON.stringify(modern)} ? { mcpRootExports: {}, mcpOauthExports: {}, privateDeepPaths: [], providerAuth: [] } : {}),
};
try {
  const root = await import(${JSON.stringify(CODING_AGENT_PACKAGE)});
  for (const name of ${JSON.stringify(codingExports)}) receipt.rootExports[name] = typeof root[name];
} catch (error) {
  receipt.rootImportError = serializeError(error);
}
for (const specifier of ${JSON.stringify(SOURCE_ONLY_DEEP_PATHS.map((subpath) => `${CODING_AGENT_PACKAGE}${subpath.slice(1)}`))}) {
  try {
    import.meta.resolve(specifier);
    receipt.sourceOnlyDeepPaths.push({ specifier, status: "resolved" });
  } catch (error) {
    receipt.sourceOnlyDeepPaths.push({ specifier, status: "rejected", phase: "resolution", error: serializeError(error) });
  }
}
if (${JSON.stringify(modern)}) {
  try {
    const root = await import(${JSON.stringify(MCP_PACKAGE)});
    for (const name of ${JSON.stringify(MCP_ROOT_EXPORTS)}) receipt.mcpRootExports[name] = typeof root[name];
  } catch (error) {
    receipt.mcpRootImportError = serializeError(error);
  }
  try {
    const oauth = await import(${JSON.stringify(`${MCP_PACKAGE}/oauth`)});
    for (const name of ${JSON.stringify(MCP_OAUTH_EXPORTS)}) receipt.mcpOauthExports[name] = typeof oauth[name];
  } catch (error) {
    receipt.mcpOauthImportError = serializeError(error);
  }
  try {
    const bunOauth = await import(${JSON.stringify(`${AI_PACKAGE}/bun-oauth`)});
    const exportedType = typeof bunOauth.registerBunOAuthFlows;
    if (exportedType === "function") bunOauth.registerBunOAuthFlows();
    receipt.bunOauth = { registerBunOAuthFlows: exportedType, called: exportedType === "function" };
    const modelRuntime = await import(${JSON.stringify(CODING_AGENT_PACKAGE)});
    const runtime = await modelRuntime.ModelRuntime.create({ authPath: process.env.AUTH_PATH, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    receipt.providerAuth = runtime.getProviders().map((provider) => ({ id: provider.id, name: provider.name,
      apiKey: Boolean(provider.auth?.apiKey), oauth: Boolean(provider.auth?.oauth) })).sort((left,right)=>left.id.localeCompare(right.id));
  } catch (error) {
    receipt.bunOauthImportError = serializeError(error);
  }
  for (const specifier of ${JSON.stringify(MODERN_PRIVATE_IMPORTS)}) {
    try {
      import.meta.resolve(specifier);
      receipt.privateDeepPaths.push({ specifier, status: "resolved" });
    } catch (error) {
      receipt.privateDeepPaths.push({ specifier, status: "rejected", phase: "resolution", error: serializeError(error) });
    }
  }
}
if (${JSON.stringify(isCurrentLoopVersion(version))}) {
  const core = await import("@earendil-works/pi-agent-core");
  if (typeof core.Agent !== "function") throw new Error("current-loop Agent export missing");
  receipt.removedCoreExports = Object.fromEntries(${JSON.stringify(REMOVED_100_EXPORTS)}.map(name => [name, typeof core[name]]));
  receipt.removedImports = [];
  for (const specifier of ${JSON.stringify(REMOVED_100_IMPORTS)}) {
    try {
      import.meta.resolve(specifier);
      receipt.removedImports.push({ specifier, status: "resolved" });
    } catch (error) {
      receipt.removedImports.push({ specifier, status: "rejected", phase: "resolution", error: serializeError(error) });
    }
  }
}
console.log(${JSON.stringify(PROBE_MARKER)} + JSON.stringify(receipt));
`;
}

type RawRejectedPath = {
  specifier?: string;
  status?: "resolved" | "rejected";
  phase?: "resolution";
  error?: { name?: string; code?: string; message?: string };
};

export type RawProbeReceipt = {
  actualRuntime?: RuntimeProbeReceipt["actualRuntime"];
  rootExports?: Record<string, string>;
  rootImportError?: { name?: string; code?: string; message?: string };
  mcpRootExports?: Record<string, string>;
  mcpRootImportError?: { name?: string; code?: string; message?: string };
  mcpOauthExports?: Record<string, string>;
  mcpOauthImportError?: { name?: string; code?: string; message?: string };
  bunOauth?: { registerBunOAuthFlows?: string; called?: boolean };
  bunOauthImportError?: { name?: string; code?: string; message?: string };
  sideEffectEnforcement?: { mode?: string; networkDenied?: boolean; childProcessDenied?: boolean; networkAttempts?: number|null; childProcessAttempts?: number|null };
  providerAuth?: Array<{ id?: string; name?: string; apiKey?: boolean; oauth?: boolean }>;
  sourceOnlyDeepPaths?: RawRejectedPath[];
  privateDeepPaths?: RawRejectedPath[];
  removedImports?: RawRejectedPath[];
  removedCoreExports?: Record<string, string>;
};

export function assertProbeRuntime(kind: "node" | "bun", runtime: RuntimeProbeReceipt["actualRuntime"]): void {
  if (kind === "node" && (runtime.bun || runtime.release !== "node" || !runtime.node)) {
    throw new Error("Node admission requires real Node, not a Bun compatibility wrapper");
  }
  if (kind === "bun" && !runtime.bun) throw new Error("Bun admission requires Bun");
}

function assertResolutionRejection(kind: "node" | "bun", entry: RawRejectedPath, label: string): void {
  const expectedCodes = kind === "node" ? ["ERR_PACKAGE_PATH_NOT_EXPORTED"] : ["ERR_MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED"];
  if (entry.status !== "rejected" || entry.phase !== "resolution" || !entry.error?.code || !expectedCodes.includes(entry.error.code)) {
    throw new Error(`${kind} ${label} was not excluded by export resolution: ${String(entry.specifier)}`);
  }
}

export function assertSourceOnlyRejection(kind: "node" | "bun", entry: RawRejectedPath): void {
  assertResolutionRejection(kind, entry, "source-only path");
}

export function assertPrivateImportRejection(kind: "node" | "bun", entry: RawRejectedPath): void {
  assertResolutionRejection(kind, entry, "private import");
}

function checkedRejectedPaths(
  kind: "node" | "bun",
  entries: RawRejectedPath[] | undefined,
  expectedSpecifiers: readonly string[],
  label: "source-only" | "private",
): NonNullable<RuntimeProbeReceipt["privateDeepPaths"]> {
  const paths = entries ?? [];
  if (paths.length !== expectedSpecifiers.length) throw new Error(`${kind} import probe returned incomplete ${label} path results`);
  return paths.map((entry, index) => {
    if (entry.specifier !== expectedSpecifiers[index]) throw new Error(`${kind} unexpected ${label} path receipt`);
    if (label === "source-only") assertSourceOnlyRejection(kind, entry);
    else assertPrivateImportRejection(kind, entry);
    if (!entry.specifier || !entry.error?.name || !entry.error.message) throw new Error(`${kind} ${label} path rejection receipt is incomplete`);
    return {
      specifier: entry.specifier,
      admitted: false as const,
      status: "rejected" as const,
      error: {
        name: entry.error.name,
        ...(entry.error.code === undefined ? {} : { code: entry.error.code }),
        message: entry.error.message,
      },
    };
  });
}

function assertFunctionExports(kind: "node" | "bun", label: string, values: Record<string, string> | undefined, names: readonly string[]): void {
  if (!values) throw new Error(`${kind} could not import ${label}`);
  for (const name of names) {
    if (values[name] !== "function") throw new Error(`${kind} ${label} export ${name} must be a function, found ${String(values[name])}`);
  }
}

function executeRuntimeProbe(kind:"node"|"bun",executableInput:string,consumerRoot:string,scratch:string,version:string):RawProbeReceipt {
  if (kind !== "bun") throw new Error("Package admission execution is Bun-only; Node receipts are historical");
  const executable=resolveExecutable(executableInput,kind);mkdirSync(scratch,{recursive:true});const preload=writeProbePreload(scratch);
  const args=[executable,"--preload",preload,"--eval",probeProgram(version)];
  const result=Bun.spawnSync(args,{cwd:consumerRoot,env:createProbeEnvironment(scratch,executable),stdout:"pipe",stderr:"pipe",timeout:30_000});
  const stdout=result.stdout.toString(),stderr=result.stderr.toString();
  if(result.exitCode!==0)throw new Error(`${kind} import probe failed with exit ${result.exitCode}: ${stderr||stdout}`);
  const marker=stdout.split(/\r?\n/).reverse().find(line=>line.startsWith(PROBE_MARKER));
  if(!marker)throw new Error(`${kind} import probe did not return a receipt: ${stderr||stdout}`);
  return JSON.parse(marker.slice(PROBE_MARKER.length)) as RawProbeReceipt;
}
export function runRawRuntimeProbeForTests(kind:"node"|"bun",executable:string,consumerRoot:string,version:string):RawProbeReceipt {
  const scratch=mkdtempSync(join(tmpdir(),"earendil-raw-probe-"));try{return executeRuntimeProbe(kind,executable,realpathSync(consumerRoot),scratch,version);}finally{rmSync(scratch,{recursive:true,force:true});}
}
function runRuntimeProbe(kind: "bun", executableInput: string, consumerRoot: string, scratch: string, version: string, providerReceipt?: ProviderAuthReceipt): RuntimeProbeReceipt {
  const executable = resolveExecutable(executableInput, kind);
  const raw = executeRuntimeProbe(kind,executable,consumerRoot,scratch,version);
  if (raw.rootImportError) throw new Error(`${kind} could not import ${CODING_AGENT_PACKAGE}: ${raw.rootImportError.message ?? raw.rootImportError.name ?? "unknown error"}`);
  if (!raw.actualRuntime || !raw.rootExports) throw new Error(`${kind} import probe returned an incomplete receipt`);
  const enforcement=raw.sideEffectEnforcement;
  if(enforcement?.mode!=="bun-preload"||enforcement.networkDenied!==true||enforcement.childProcessDenied!==true
    ||enforcement.networkAttempts!==0||enforcement.childProcessAttempts!==0) throw new Error(`${kind} admission requires complete enforcement and zero network/child-process attempts`);
  assertProbeRuntime(kind, raw.actualRuntime);

  const modern = modernContractRequired(version);
  const codingExports = modern ? MODERN_CODING_AGENT_EXPORTS : MODERN_CODING_AGENT_EXPORTS.slice(0, 3);
  assertFunctionExports(kind, CODING_AGENT_PACKAGE, raw.rootExports, codingExports);
  const sourceOnlyDeepPaths = checkedRejectedPaths(
    kind,
    raw.sourceOnlyDeepPaths,
    SOURCE_ONLY_DEEP_PATHS.map((subpath) => `${CODING_AGENT_PACKAGE}${subpath.slice(1)}`),
    "source-only",
  );

  if (!modern) {
    return { requestedRuntime: kind, requestedExecutable: executable, actualRuntime: raw.actualRuntime, rootExports: raw.rootExports, sideEffectEnforcement: enforcement as RuntimeProbeReceipt["sideEffectEnforcement"], sourceOnlyDeepPaths };
  }
  if (raw.mcpRootImportError) throw new Error(`${kind} could not import ${MCP_PACKAGE}: ${raw.mcpRootImportError.message ?? "unknown error"}`);
  if (raw.mcpOauthImportError) throw new Error(`${kind} could not import ${MCP_PACKAGE}/oauth: ${raw.mcpOauthImportError.message ?? "unknown error"}`);
  if (raw.bunOauthImportError) throw new Error(`${kind} could not import ${AI_PACKAGE}/bun-oauth: ${raw.bunOauthImportError.message ?? "unknown error"}`);
  assertFunctionExports(kind, MCP_PACKAGE, raw.mcpRootExports, MCP_ROOT_EXPORTS);
  assertFunctionExports(kind, `${MCP_PACKAGE}/oauth`, raw.mcpOauthExports, MCP_OAUTH_EXPORTS);
  if (raw.bunOauth?.registerBunOAuthFlows !== "function" || raw.bunOauth.called !== true) {
    throw new Error(`${kind} ${AI_PACKAGE}/bun-oauth registerBunOAuthFlows must import and complete without provider calls`);
  }
  const privateDeepPaths = checkedRejectedPaths(kind, raw.privateDeepPaths, MODERN_PRIVATE_IMPORTS, "private");
  const removedImports = isCurrentLoopVersion(version)
    ? checkedRejectedPaths(kind, raw.removedImports, REMOVED_100_IMPORTS, "private") : undefined;
  if (isCurrentLoopVersion(version) && REMOVED_100_EXPORTS.some(name => raw.removedCoreExports?.[name] !== "undefined")) {
    throw new Error(`${version} removed core exports differ from exact contract`);
  }
  if (!providerReceipt || JSON.stringify(raw.providerAuth) !== JSON.stringify(providerReceipt.providers)) throw new Error(`${kind} provider auth inventory differs from exact receipt`);
  return {
    requestedRuntime: kind,
    requestedExecutable: executable,
    actualRuntime: raw.actualRuntime,
    rootExports: raw.rootExports,
    mcpRootExports: raw.mcpRootExports,
    mcpOauthExports: raw.mcpOauthExports,
    bunOauth: { registerBunOAuthFlows: "function", called: true },
    sideEffectEnforcement: enforcement as RuntimeProbeReceipt["sideEffectEnforcement"],
    providerAuth: providerReceipt.providers,
    sourceOnlyDeepPaths,
    privateDeepPaths,
    ...(removedImports ? { removedImports, removedCoreExports: raw.removedCoreExports } : {}),
  };
}

export function runEarendilPackageAdmission(options: AdmissionOptions): EarendilPackageAdmissionReceipt {
  if (modernContractRequired(options.version) && !options.tarballDir) throw new Error(`tarball directory is required for versions >=${MODERN_CONTRACT_VERSION}`);
  if (!EXACT_VERSION_RE.test(options.version)) throw new Error(`version must be exact: ${options.version}`);
  if (!EXACT_GIT_HEAD_RE.test(options.gitHead)) throw new Error("gitHead must be an exact lowercase 40-character commit SHA");
  const installed = inspectInstalledConsumer(options);
  const scratch = mkdtempSync(join(tmpdir(), "earendil-package-admission-"));
  try {
    const runtimes = [
      runRuntimeProbe("bun", options.bunPath, installed.consumerRoot, join(scratch, "bun"), options.version, installed.providerAuthReceipt),
    ];
    return {
      ...installed,
      admitted: true,
      probeEnvironment: { inheritedSecrets: false, offlineRequested: true, telemetry: "disabled", networkSandboxed: false },
      sideEffectEnforcement: runtimes.map(runtime=>({runtime:runtime.requestedRuntime,...runtime.sideEffectEnforcement})),
      runtimes,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const options = parseAdmissionArgs(process.argv.slice(2));
  if ("help" in options) {
    console.log(usage());
    return;
  }
  console.log(JSON.stringify(runEarendilPackageAdmission(options), null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`[earendil-package-admission] ${error instanceof Error ? error.message : String(error)}`);
    console.error(usage());
    process.exitCode = 1;
  });
}
