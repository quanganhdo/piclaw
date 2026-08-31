import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { resolveAscCommand } from "../../scripts/build-remote-display-decoder-wasm.js";

test("remote display WASM build invokes the AssemblyScript JavaScript entry through Bun", () => {
  const command = resolveAscCommand();
  expect(command[0]).toBe(process.execPath);
  expect(command[1]).toBe(resolve(import.meta.dir, "../../../node_modules/assemblyscript/bin/asc.js"));
});
