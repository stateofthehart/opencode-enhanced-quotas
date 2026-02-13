import { describe, expect, spyOn, test } from "bun:test";
import {
  formatDuration,
  parseDurationToMs,
  readApiKey,
  toNumber,
} from "../../src/providers/provider-utils";
import * as fs from "node:fs/promises";

describe("provider-utils", () => {
  test("parses mixed duration strings", () => {
    expect(parseDurationToMs("1h 30m")).toBe(5_400_000);
    expect(parseDurationToMs("2m10s")).toBe(130_000);
    expect(parseDurationToMs("45")).toBe(45_000);
    expect(parseDurationToMs("n/a")).toBeNull();
  });

  test("formats durations consistently", () => {
    expect(formatDuration(0)).toBe("now");
    expect(formatDuration(65_000)).toBe("1m");
    expect(formatDuration(3_900_000)).toBe("1h 5m");
  });

  test("converts numeric-ish values", () => {
    expect(toNumber(10)).toBe(10);
    expect(toNumber("10.5")).toBe(10.5);
    expect(toNumber("abc")).toBeNull();
    expect(toNumber(null)).toBeNull();
  });

  test("reads api keys from alias config fields", async () => {
    const readSpy = spyOn(fs, "readFile").mockResolvedValue(
      JSON.stringify({
        credentials: {
          api_key: "alias-key-123",
        },
      }),
    );

    const key = await readApiKey([], ["openrouter-auth.json"], ["apiKey", "api_key"]);
    expect(key).toBe("alias-key-123");
    readSpy.mockRestore();
  });
});
