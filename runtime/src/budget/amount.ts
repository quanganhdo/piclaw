export function parseBudgetDecimalMicros(value: unknown, options: { positive?: boolean } = {}): number {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(text)) {
    throw new Error("Amount must be a non-negative decimal with at most six places");
  }
  const [whole, fraction = ""] = text.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount is too large");
  const result = Number(micros);
  if (options.positive && result <= 0) throw new Error("Amount must be greater than zero");
  return result;
}

export function formatBudgetMicros(value: number): string {
  if (!Number.isSafeInteger(value)) return "unknown";
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute / 1_000_000);
  const fraction = String(absolute % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}
