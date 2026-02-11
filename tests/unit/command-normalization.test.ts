import { describe, expect, test } from "bun:test";
import {
    isQuotaCommand,
    normalizeCommandName,
} from "../../src/utils/command-normalization";

describe("command normalization", () => {
    test("normalizes slash-prefixed commands", () => {
        expect(normalizeCommandName("/usage")).toBe("usage");
        expect(normalizeCommandName("/mymodels")).toBe("mymodels");
    });

    test("normalizes whitespace and casing", () => {
        expect(normalizeCommandName("  /UsAgE  ")).toBe("usage");
        expect(normalizeCommandName("  MYMODELS  ")).toBe("mymodels");
    });

    test("recognizes supported quota commands after normalization", () => {
        expect(isQuotaCommand("/usage")).toBeTrue();
        expect(isQuotaCommand("usage-logs")).toBeTrue();
        expect(isQuotaCommand(" /MYMODELS ")).toBeTrue();
        expect(isQuotaCommand("help")).toBeFalse();
    });

    test("normalizes only the command token when arguments are present", () => {
        expect(normalizeCommandName("/usage provider=antigravity")).toBe("usage");
        expect(normalizeCommandName(" /mymodels --raw ")).toBe("mymodels");
    });
});
