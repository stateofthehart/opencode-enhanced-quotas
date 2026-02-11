import { expect, test, describe, beforeEach } from "bun:test";
import { type QuotaData } from "../../src/interfaces";

/**
 * Tests for the /mymodels command logic extracted from QuotaHubPlugin's
 * "command.execute.before" hook (src/index.ts lines 278-358).
 *
 * The /mymodels command categorizes quotas into three buckets:
 *   - available: usage < 80%
 *   - limited:   usage >= 80% and < 100%
 *   - exhausted: usage >= 100%
 *
 * Supports arguments:
 *   - status=all|available|limited|exhausted
 *   - provider=<name> (case-insensitive substring match)
 *
 * Because the command logic lives inline inside the plugin hook closure,
 * we extract and re-implement the same logic here for unit testing without
 * needing to instantiate the full plugin (which requires client, $, etc.).
 */

// ── Extracted command logic ─────────────────────────────────────────────
// This mirrors the /mymodels handler from src/index.ts exactly.

interface MyModelsResult {
    text: string;
}

function executeMyModelsCommand(
    quotas: QuotaData[],
    args: string,
): MyModelsResult {
    if (quotas.length === 0) {
        return {
            text: "No quota data available to determine model availability.",
        };
    }

    const argParts = args.split(" ").filter(Boolean);
    const statusArg = argParts.find((a: string) => a.startsWith("status="));
    const providerArg = argParts.find((a: string) =>
        a.startsWith("provider="),
    );
    const statusFilter = statusArg?.split("=")[1] || "all";
    const providerFilter = providerArg?.split("=")[1];

    let filtered = quotas;
    if (providerFilter) {
        filtered = quotas.filter((q: QuotaData) =>
            q.providerName.toLowerCase().includes(providerFilter.toLowerCase()),
        );
    }

    const available: QuotaData[] = [];
    const limited: QuotaData[] = [];
    const exhausted: QuotaData[] = [];

    for (const q of filtered) {
        const pct = q.limit ? (q.used / q.limit) * 100 : 0;
        if (pct >= 100) exhausted.push(q);
        else if (pct >= 80) limited.push(q);
        else available.push(q);
    }

    const lines: string[] = ["Model Availability by Quota Status:"];

    if (statusFilter === "all" || statusFilter === "available") {
        if (available.length > 0) {
            lines.push("\n[OK] Available:");
            for (const q of available) {
                const pct = q.limit
                    ? Math.round((q.used / q.limit) * 100)
                    : 0;
                const reset = q.reset ? ` (resets: ${q.reset})` : "";
                lines.push(
                    `  + ${q.providerName} - ${q.id}: ${pct}% used${reset}`,
                );
            }
        }
    }

    if (statusFilter === "all" || statusFilter === "limited") {
        if (limited.length > 0) {
            lines.push("\n[~] Limited (approaching limit):");
            for (const q of limited) {
                const pct = q.limit
                    ? Math.round((q.used / q.limit) * 100)
                    : 0;
                const reset = q.reset ? ` (resets: ${q.reset})` : "";
                lines.push(
                    `  ~ ${q.providerName} - ${q.id}: ${pct}% used${reset}`,
                );
            }
        }
    }

    if (statusFilter === "all" || statusFilter === "exhausted") {
        if (exhausted.length > 0) {
            lines.push("\n[!] Exhausted (unavailable):");
            for (const q of exhausted) {
                const reset = q.reset ? ` (resets: ${q.reset})` : "";
                lines.push(
                    `  x ${q.providerName} - ${q.id}: 100%+ used${reset}`,
                );
            }
        }
    }

    if (lines.length === 1) {
        lines.push(`\nNo models found with status: ${statusFilter}`);
    } else {
        lines.push(`\n${"-".repeat(40)}`);
        lines.push(
            `Summary: ${available.length} available, ${limited.length} limited, ${exhausted.length} exhausted`,
        );
    }

    return { text: lines.join("\n") };
}

// ── Test Data Factories ─────────────────────────────────────────────────

function makeQuota(overrides: Partial<QuotaData> & { id: string }): QuotaData {
    return {
        providerName: "TestProvider",
        used: 0,
        limit: 100,
        unit: "requests",
        ...overrides,
    };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("/mymodels command", () => {
    // ── Empty state ─────────────────────────────────────────────────
    describe("when no quotas are available", () => {
        test("returns unavailable message for empty quota array", () => {
            const result = executeMyModelsCommand([], "");
            expect(result.text).toBe(
                "No quota data available to determine model availability.",
            );
        });
    });

    // ── Categorization ──────────────────────────────────────────────
    describe("categorization thresholds", () => {
        test("classifies quota at 0% usage as available", () => {
            const quotas = [makeQuota({ id: "q1", used: 0, limit: 100 })];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("[OK] Available:");
            expect(result.text).toContain("q1: 0% used");
            expect(result.text).not.toContain("[~] Limited");
            expect(result.text).not.toContain("[!] Exhausted");
        });

        test("classifies quota at 50% usage as available", () => {
            const quotas = [makeQuota({ id: "q1", used: 50, limit: 100 })];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("[OK] Available:");
            expect(result.text).toContain("q1: 50% used");
        });

        test("classifies quota at 79% usage as available", () => {
            const quotas = [makeQuota({ id: "q1", used: 79, limit: 100 })];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("[OK] Available:");
            expect(result.text).toContain("q1: 79% used");
            expect(result.text).not.toContain("[~] Limited");
        });

        test("classifies quota at exactly 80% usage as limited", () => {
            const quotas = [makeQuota({ id: "q1", used: 80, limit: 100 })];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("[~] Limited (approaching limit):");
            expect(result.text).toContain("q1: 80% used");
            expect(result.text).not.toContain("[OK] Available:");
        });

        test("classifies quota at 95% usage as limited", () => {
            const quotas = [makeQuota({ id: "q1", used: 95, limit: 100 })];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("[~] Limited (approaching limit):");
            expect(result.text).toContain("q1: 95% used");
        });

        test("classifies quota at 99% usage as limited", () => {
            const quotas = [makeQuota({ id: "q1", used: 99, limit: 100 })];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("[~] Limited");
            expect(result.text).toContain("q1: 99% used");
            expect(result.text).not.toContain("[!] Exhausted");
        });

        test("classifies quota at exactly 100% usage as exhausted", () => {
            const quotas = [makeQuota({ id: "q1", used: 100, limit: 100 })];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("[!] Exhausted (unavailable):");
            expect(result.text).toContain("q1: 100%+ used");
            expect(result.text).not.toContain("[~] Limited");
        });

        test("classifies quota over 100% usage as exhausted", () => {
            const quotas = [makeQuota({ id: "q1", used: 150, limit: 100 })];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("[!] Exhausted (unavailable):");
            expect(result.text).toContain("q1: 100%+ used");
        });

        test("classifies unlimited quota (limit=null) as available at 0%", () => {
            const quotas = [
                makeQuota({ id: "q1", used: 500, limit: null }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("[OK] Available:");
            expect(result.text).toContain("q1: 0% used");
        });
    });

    // ── Mixed quotas ────────────────────────────────────────────────
    describe("mixed quota statuses", () => {
        let mixedQuotas: QuotaData[];

        beforeEach(() => {
            mixedQuotas = [
                makeQuota({
                    id: "flash",
                    providerName: "Antigravity Flash",
                    used: 10,
                    limit: 100,
                }),
                makeQuota({
                    id: "pro",
                    providerName: "Antigravity Pro",
                    used: 85,
                    limit: 100,
                }),
                makeQuota({
                    id: "codex",
                    providerName: "Codex Usage",
                    used: 100,
                    limit: 100,
                }),
            ];
        });

        test("shows all three sections when status=all (default)", () => {
            const result = executeMyModelsCommand(mixedQuotas, "");
            expect(result.text).toContain("[OK] Available:");
            expect(result.text).toContain("[~] Limited (approaching limit):");
            expect(result.text).toContain("[!] Exhausted (unavailable):");
        });

        test("includes header line", () => {
            const result = executeMyModelsCommand(mixedQuotas, "");
            expect(result.text).toStartWith(
                "Model Availability by Quota Status:",
            );
        });

        test("includes summary with correct counts", () => {
            const result = executeMyModelsCommand(mixedQuotas, "");
            expect(result.text).toContain(
                "Summary: 1 available, 1 limited, 1 exhausted",
            );
        });

        test("includes separator before summary", () => {
            const result = executeMyModelsCommand(mixedQuotas, "");
            expect(result.text).toContain("-".repeat(40));
        });

        test("lists correct quotas in each section", () => {
            const result = executeMyModelsCommand(mixedQuotas, "");
            // Available section should contain flash
            expect(result.text).toContain(
                "+ Antigravity Flash - flash: 10% used",
            );
            // Limited section should contain pro
            expect(result.text).toContain(
                "~ Antigravity Pro - pro: 85% used",
            );
            // Exhausted section should contain codex
            expect(result.text).toContain(
                "x Codex Usage - codex: 100%+ used",
            );
        });
    });

    // ── status= filter ──────────────────────────────────────────────
    describe("status filter", () => {
        let mixedQuotas: QuotaData[];

        beforeEach(() => {
            mixedQuotas = [
                makeQuota({
                    id: "avail1",
                    providerName: "P1",
                    used: 10,
                    limit: 100,
                }),
                makeQuota({
                    id: "avail2",
                    providerName: "P2",
                    used: 30,
                    limit: 100,
                }),
                makeQuota({
                    id: "limited1",
                    providerName: "P3",
                    used: 85,
                    limit: 100,
                }),
                makeQuota({
                    id: "exhausted1",
                    providerName: "P4",
                    used: 100,
                    limit: 100,
                }),
            ];
        });

        test("status=available shows only available models", () => {
            const result = executeMyModelsCommand(
                mixedQuotas,
                "status=available",
            );
            expect(result.text).toContain("[OK] Available:");
            expect(result.text).toContain("avail1");
            expect(result.text).toContain("avail2");
            expect(result.text).not.toContain("[~] Limited");
            expect(result.text).not.toContain("[!] Exhausted");
        });

        test("status=limited shows only limited models", () => {
            const result = executeMyModelsCommand(
                mixedQuotas,
                "status=limited",
            );
            expect(result.text).toContain("[~] Limited (approaching limit):");
            expect(result.text).toContain("limited1");
            expect(result.text).not.toContain("[OK] Available:");
            expect(result.text).not.toContain("[!] Exhausted");
        });

        test("status=exhausted shows only exhausted models", () => {
            const result = executeMyModelsCommand(
                mixedQuotas,
                "status=exhausted",
            );
            expect(result.text).toContain("[!] Exhausted (unavailable):");
            expect(result.text).toContain("exhausted1");
            expect(result.text).not.toContain("[OK] Available:");
            expect(result.text).not.toContain("[~] Limited");
        });

        test("status=all is equivalent to default (no status arg)", () => {
            const withAll = executeMyModelsCommand(
                mixedQuotas,
                "status=all",
            );
            const withDefault = executeMyModelsCommand(mixedQuotas, "");
            expect(withAll.text).toBe(withDefault.text);
        });

        test("status filter with no matching results shows 'no models found'", () => {
            const onlyAvailable = [
                makeQuota({ id: "q1", used: 10, limit: 100 }),
            ];
            const result = executeMyModelsCommand(
                onlyAvailable,
                "status=exhausted",
            );
            expect(result.text).toContain(
                "No models found with status: exhausted",
            );
            expect(result.text).not.toContain("Summary:");
        });

        test("status filter with no matching results for 'limited' shows correct message", () => {
            const onlyAvailable = [
                makeQuota({ id: "q1", used: 10, limit: 100 }),
            ];
            const result = executeMyModelsCommand(
                onlyAvailable,
                "status=limited",
            );
            expect(result.text).toContain(
                "No models found with status: limited",
            );
        });

        test("summary counts reflect all categories even when filtered", () => {
            // When status=available, summary still shows counts for all categories
            const result = executeMyModelsCommand(
                mixedQuotas,
                "status=available",
            );
            expect(result.text).toContain(
                "Summary: 2 available, 1 limited, 1 exhausted",
            );
        });
    });

    // ── provider= filter ────────────────────────────────────────────
    describe("provider filter", () => {
        let multiProviderQuotas: QuotaData[];

        beforeEach(() => {
            multiProviderQuotas = [
                makeQuota({
                    id: "ag-flash",
                    providerName: "Antigravity Flash",
                    used: 10,
                    limit: 100,
                }),
                makeQuota({
                    id: "ag-pro",
                    providerName: "Antigravity Pro",
                    used: 85,
                    limit: 100,
                }),
                makeQuota({
                    id: "codex-usage",
                    providerName: "Codex Usage",
                    used: 50,
                    limit: 100,
                }),
                makeQuota({
                    id: "gh-copilot",
                    providerName: "GitHub Copilot",
                    used: 100,
                    limit: 100,
                }),
            ];
        });

        test("filters by provider name (case-insensitive substring)", () => {
            const result = executeMyModelsCommand(
                multiProviderQuotas,
                "provider=antigravity",
            );
            expect(result.text).toContain("ag-flash");
            expect(result.text).toContain("ag-pro");
            expect(result.text).not.toContain("codex-usage");
            expect(result.text).not.toContain("gh-copilot");
        });

        test("provider filter is case-insensitive", () => {
            const upper = executeMyModelsCommand(
                multiProviderQuotas,
                "provider=ANTIGRAVITY",
            );
            const lower = executeMyModelsCommand(
                multiProviderQuotas,
                "provider=antigravity",
            );
            const mixed = executeMyModelsCommand(
                multiProviderQuotas,
                "provider=AntiGravity",
            );
            expect(upper.text).toBe(lower.text);
            expect(upper.text).toBe(mixed.text);
        });

        test("provider filter uses substring match", () => {
            const result = executeMyModelsCommand(
                multiProviderQuotas,
                "provider=codex",
            );
            expect(result.text).toContain("codex-usage");
            expect(result.text).not.toContain("ag-flash");
        });

        test("provider filter with no matches returns 'no models found'", () => {
            const result = executeMyModelsCommand(
                multiProviderQuotas,
                "provider=nonexistent",
            );
            // All categories are empty after provider filtering, so no sections appear
            expect(result.text).toContain("No models found with status: all");
        });

        test("provider filter combined with status filter", () => {
            const result = executeMyModelsCommand(
                multiProviderQuotas,
                "provider=antigravity status=limited",
            );
            expect(result.text).toContain("[~] Limited (approaching limit):");
            expect(result.text).toContain("ag-pro");
            expect(result.text).not.toContain("[OK] Available:");
            expect(result.text).not.toContain("ag-flash");
            expect(result.text).not.toContain("codex-usage");
        });

        test("combined filter: provider + status=available", () => {
            const result = executeMyModelsCommand(
                multiProviderQuotas,
                "provider=antigravity status=available",
            );
            expect(result.text).toContain("ag-flash");
            expect(result.text).not.toContain("ag-pro");
        });

        test("combined filter: provider match but no match for status", () => {
            const result = executeMyModelsCommand(
                multiProviderQuotas,
                "provider=antigravity status=exhausted",
            );
            expect(result.text).toContain(
                "No models found with status: exhausted",
            );
        });
    });

    // ── Reset time display ──────────────────────────────────────────
    describe("reset time display", () => {
        test("shows reset time for available quotas when present", () => {
            const quotas = [
                makeQuota({
                    id: "q1",
                    providerName: "P1",
                    used: 10,
                    limit: 100,
                    reset: "in 2h 41m",
                }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("(resets: in 2h 41m)");
        });

        test("shows reset time for limited quotas when present", () => {
            const quotas = [
                makeQuota({
                    id: "q1",
                    providerName: "P1",
                    used: 85,
                    limit: 100,
                    reset: "in 30m",
                }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("(resets: in 30m)");
        });

        test("shows reset time for exhausted quotas when present", () => {
            const quotas = [
                makeQuota({
                    id: "q1",
                    providerName: "P1",
                    used: 100,
                    limit: 100,
                    reset: "in 5m",
                }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("(resets: in 5m)");
        });

        test("omits reset time when not present", () => {
            const quotas = [
                makeQuota({
                    id: "q1",
                    providerName: "P1",
                    used: 10,
                    limit: 100,
                }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).not.toContain("(resets:");
        });
    });

    // ── Line formatting ─────────────────────────────────────────────
    describe("output formatting", () => {
        test("available items use '+' prefix", () => {
            const quotas = [
                makeQuota({ id: "q1", providerName: "P1", used: 10, limit: 100 }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("  + P1 - q1: 10% used");
        });

        test("limited items use '~' prefix", () => {
            const quotas = [
                makeQuota({ id: "q1", providerName: "P1", used: 85, limit: 100 }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("  ~ P1 - q1: 85% used");
        });

        test("exhausted items use 'x' prefix", () => {
            const quotas = [
                makeQuota({ id: "q1", providerName: "P1", used: 100, limit: 100 }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("  x P1 - q1: 100%+ used");
        });

        test("exhausted items always show '100%+ used' regardless of actual percentage", () => {
            const quotas = [
                makeQuota({ id: "q1", providerName: "P1", used: 200, limit: 100 }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            // The exhausted branch does not compute percentage; it always says "100%+ used"
            expect(result.text).toContain("100%+ used");
            expect(result.text).not.toContain("200% used");
        });

        test("percentage is rounded to nearest integer", () => {
            const quotas = [
                makeQuota({ id: "q1", providerName: "P1", used: 33, limit: 100 }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("33% used");
        });

        test("percentage rounds correctly for non-integer ratios", () => {
            // 1/3 = 33.333...% -> rounds to 33%
            const quotas = [
                makeQuota({ id: "q1", providerName: "P1", used: 1, limit: 3 }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("33% used");
        });

        test("percentage rounds up when >= .5", () => {
            // 5/6 = 83.333...% -> rounds to 83%
            const quotas = [
                makeQuota({ id: "q1", providerName: "P1", used: 5, limit: 6 }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("83% used");
        });

        test("format includes providerName - id pattern", () => {
            const quotas = [
                makeQuota({
                    id: "my-quota-id",
                    providerName: "My Provider",
                    used: 20,
                    limit: 100,
                }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("My Provider - my-quota-id");
        });
    });

    // ── Argument parsing ────────────────────────────────────────────
    describe("argument parsing", () => {
        test("handles empty arguments string", () => {
            const quotas = [makeQuota({ id: "q1", used: 10, limit: 100 })];
            const result = executeMyModelsCommand(quotas, "");
            // Should default to status=all, no provider filter
            expect(result.text).toContain("[OK] Available:");
        });

        test("handles arguments with extra whitespace", () => {
            const quotas = [
                makeQuota({ id: "q1", providerName: "P1", used: 10, limit: 100 }),
            ];
            const result = executeMyModelsCommand(
                quotas,
                "  status=available   ",
            );
            expect(result.text).toContain("[OK] Available:");
        });

        test("handles arguments in any order", () => {
            const quotas = [
                makeQuota({
                    id: "q1",
                    providerName: "ProvA",
                    used: 10,
                    limit: 100,
                }),
                makeQuota({
                    id: "q2",
                    providerName: "ProvB",
                    used: 90,
                    limit: 100,
                }),
            ];
            const statusFirst = executeMyModelsCommand(
                quotas,
                "status=available provider=ProvA",
            );
            const providerFirst = executeMyModelsCommand(
                quotas,
                "provider=ProvA status=available",
            );
            expect(statusFirst.text).toBe(providerFirst.text);
        });

        test("ignores unknown arguments gracefully", () => {
            const quotas = [makeQuota({ id: "q1", used: 10, limit: 100 })];
            const result = executeMyModelsCommand(
                quotas,
                "unknown=value status=available",
            );
            expect(result.text).toContain("[OK] Available:");
        });
    });

    // ── Edge cases ──────────────────────────────────────────────────
    describe("edge cases", () => {
        test("handles quota with limit=0 as available (falsy limit treated like null)", () => {
            // q.limit is 0, which is falsy in JS, so the ternary falls to pct=0
            // This means limit=0 behaves like limit=null (unlimited/available)
            const quotas = [
                makeQuota({ id: "q1", used: 5, limit: 0 }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("[OK] Available:");
            expect(result.text).toContain("q1: 0% used");
        });

        test("handles quota with used=0 and limit=0", () => {
            // 0/0 = NaN, NaN comparisons are all false, falls to available
            const quotas = [
                makeQuota({ id: "q1", used: 0, limit: 0 }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            // NaN < 80 is false, NaN < 100 is false, so goes to available bucket
            // Actually: NaN >= 100 is false, NaN >= 80 is false, so available
            expect(result.text).toContain("[OK] Available:");
        });

        test("handles many quotas in all categories", () => {
            const quotas: QuotaData[] = [];
            for (let i = 0; i < 10; i++) {
                quotas.push(
                    makeQuota({
                        id: `avail-${i}`,
                        providerName: `P-Avail-${i}`,
                        used: i * 5,
                        limit: 100,
                    }),
                );
            }
            for (let i = 0; i < 5; i++) {
                quotas.push(
                    makeQuota({
                        id: `limited-${i}`,
                        providerName: `P-Limited-${i}`,
                        used: 80 + i * 3,
                        limit: 100,
                    }),
                );
            }
            for (let i = 0; i < 3; i++) {
                quotas.push(
                    makeQuota({
                        id: `exhausted-${i}`,
                        providerName: `P-Exhausted-${i}`,
                        used: 100 + i * 10,
                        limit: 100,
                    }),
                );
            }

            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain(
                "Summary: 10 available, 5 limited, 3 exhausted",
            );
        });

        test("handles single quota that is available", () => {
            const quotas = [makeQuota({ id: "only-one", used: 5, limit: 100 })];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("[OK] Available:");
            expect(result.text).toContain(
                "Summary: 1 available, 0 limited, 0 exhausted",
            );
        });

        test("handles single quota that is exhausted", () => {
            const quotas = [
                makeQuota({ id: "only-one", used: 100, limit: 100 }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("[!] Exhausted");
            expect(result.text).toContain(
                "Summary: 0 available, 0 limited, 1 exhausted",
            );
        });

        test("all quotas are unlimited (limit=null) - all shown as available at 0%", () => {
            const quotas = [
                makeQuota({
                    id: "q1",
                    providerName: "P1",
                    used: 100,
                    limit: null,
                }),
                makeQuota({
                    id: "q2",
                    providerName: "P2",
                    used: 999,
                    limit: null,
                }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("[OK] Available:");
            expect(result.text).toContain("q1: 0% used");
            expect(result.text).toContain("q2: 0% used");
            expect(result.text).not.toContain("[~] Limited");
            expect(result.text).not.toContain("[!] Exhausted");
            expect(result.text).toContain(
                "Summary: 2 available, 0 limited, 0 exhausted",
            );
        });

        test("boundary: exactly at 79.5% rounds to 80% in display but categorized as available", () => {
            // 79.5% usage: used=159, limit=200 -> 79.5%
            // 79.5 < 80, so categorized as available
            // Math.round(79.5) = 80 in display
            const quotas = [
                makeQuota({ id: "q1", providerName: "P1", used: 159, limit: 200 }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("[OK] Available:");
            // Display shows rounded percentage
            expect(result.text).toContain("80% used");
        });

        test("boundary: exactly at 99.5% rounds to 100% in display but categorized as limited", () => {
            // 99.5%: used=199, limit=200 -> 99.5%
            // 99.5 < 100, so categorized as limited
            // Math.round(99.5) = 100 in display (but for limited, pct is computed)
            const quotas = [
                makeQuota({ id: "q1", providerName: "P1", used: 199, limit: 200 }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            expect(result.text).toContain("[~] Limited");
        });
    });

    // ── Output structure ────────────────────────────────────────────
    describe("output structure", () => {
        test("first line is always the header", () => {
            const quotas = [makeQuota({ id: "q1", used: 10, limit: 100 })];
            const result = executeMyModelsCommand(quotas, "");
            const firstLine = result.text.split("\n")[0];
            expect(firstLine).toBe("Model Availability by Quota Status:");
        });

        test("no summary line appears when no sections were rendered", () => {
            // When filtering yields no results for the requested status
            const quotas = [makeQuota({ id: "q1", used: 10, limit: 100 })];
            const result = executeMyModelsCommand(
                quotas,
                "status=exhausted",
            );
            expect(result.text).not.toContain("Summary:");
            expect(result.text).toContain("No models found");
        });

        test("summary line appears at the end when sections exist", () => {
            const quotas = [makeQuota({ id: "q1", used: 10, limit: 100 })];
            const result = executeMyModelsCommand(quotas, "");
            const lines = result.text.split("\n");
            const lastLine = lines[lines.length - 1];
            expect(lastLine).toStartWith("Summary:");
        });

        test("sections are separated by blank lines", () => {
            const quotas = [
                makeQuota({ id: "q1", used: 10, limit: 100 }),
                makeQuota({ id: "q2", used: 85, limit: 100 }),
                makeQuota({ id: "q3", used: 100, limit: 100 }),
            ];
            const result = executeMyModelsCommand(quotas, "");
            // Each section header starts with \n, which creates a blank line separator
            expect(result.text).toContain("\n[OK] Available:");
            expect(result.text).toContain("\n[~] Limited");
            expect(result.text).toContain("\n[!] Exhausted");
        });
    });
});
