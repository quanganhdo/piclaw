import { describe, expect, test } from "bun:test";
import { Result, type Result as Outcome } from "../../src/service-effects/contracts/result.js";

describe("Piclaw service-effect result", () => {
  test("preserves the discriminant, payload identity and serialised shape", () => {
    const value = { decision: "applied" };
    const error = { _tag: "storage_unavailable", certainty: "unknown", retryable: true };
    const success = Result.ok(value);
    const failure = Result.err(error);
    expect(success).toEqual({ ok: true, value });
    expect(failure).toEqual({ ok: false, error });
    if (!success.ok || failure.ok) throw new Error("Invalid discriminant");
    expect(success.value).toBe(value);
    expect(failure.error).toBe(error);
    expect(JSON.parse(JSON.stringify(success))).toEqual({ ok: true, value });
    expect(JSON.parse(JSON.stringify(failure))).toEqual({ ok: false, error });
  });

  test("accepts structural outcomes and undefined without adding fields", () => {
    const outcome: Outcome<number, string> = { ok: false, error: "not_applied" };
    expect(outcome.ok ? outcome.value : outcome.error).toBe("not_applied");
    expect(Result.ok(undefined)).toEqual({ ok: true, value: undefined });
    expect(Result.err(undefined)).toEqual({ ok: false, error: undefined });
    expect(Object.keys(Result.ok(undefined))).toEqual(["ok", "value"]);
    expect(Object.keys(Result.err(undefined))).toEqual(["ok", "error"]);
  });
});
