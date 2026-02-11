import { describe, expect, test } from "bun:test";
import { QuotaService } from "../../src/services/quota-service";
import { type QuotaData } from "../../src/interfaces";

function makeQuota(
    id: string,
    providerName: string,
    used: number,
    limit: number,
): QuotaData {
    return {
        id,
        providerName,
        used,
        limit,
        unit: "requests",
    };
}

describe("QuotaService command view", () => {
    test("keeps raw per-provider quotas in command output when aggregation is enabled", () => {
        const service = new QuotaService({
            showUnaggregated: false,
            aggregatedGroups: [
                {
                    id: "ag-group",
                    name: "Antigravity Group",
                    providerId: "antigravity",
                    patterns: ["flash", "pro"],
                    strategy: "most_critical",
                },
            ],
        });

        const raw = [
            makeQuota("ag-flash", "antigravity flash", 10, 100),
            makeQuota("ag-pro", "antigravity pro", 20, 100),
            makeQuota("cursor-requests", "cursor usage", 30, 100),
        ];

        const commandRows = (service as any).processQuotasForCommand(raw, {});
        const ids = (commandRows || []).map((q: QuotaData) => q.id);

        expect(ids).toContain("ag-flash");
        expect(ids).toContain("ag-pro");
        expect(ids).toContain("cursor-requests");
    });
});
