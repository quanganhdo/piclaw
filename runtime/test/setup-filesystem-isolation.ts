import { assertTestWorkspaceArguments, ensureTestFilesystemIsolation } from "../scripts/test-filesystem-isolation.js";

ensureTestFilesystemIsolation();
assertTestWorkspaceArguments(process.argv.slice(2));
