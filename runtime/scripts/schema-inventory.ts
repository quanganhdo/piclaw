#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifySchemaInventory, readSchemaInventory, type SchemaContract } from "./lib/schema-ownership.js";

// Explicit path only: never selects the running profile or initialises a store.
const [path, profile] = process.argv.slice(2);
if (!path || !profile || process.argv.length !== 4) {
  throw Error("Usage: bun runtime/scripts/schema-inventory.ts <owned-fixture.db> <core|native|native-addons>");
}
const contract = JSON.parse(readFileSync(new URL("./schema-ownership.json", import.meta.url), "utf8")) as SchemaContract;
const database = new Database(resolve(path), { readonly: true, strict: true });
try {
  const result = classifySchemaInventory(readSchemaInventory(database), contract, profile);
  console.log(JSON.stringify({ version: contract.version, sources: contract.sources, owners: contract.owners, ...result }, null, 2));
  if (result.errors.length) process.exitCode = 1;
} finally { database.close(); }
