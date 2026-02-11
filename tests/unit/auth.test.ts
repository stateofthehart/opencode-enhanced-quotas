import { expect, test, describe, spyOn, beforeEach, afterEach } from "bun:test";
import * as auth from "../../src/providers/antigravity/auth";
import * as fs from "node:fs/promises";

// We need to mock the global fetch
const originalFetch = globalThis.fetch;

describe("Antigravity Auth", () => {
    beforeEach(() => {
        auth.resetCredentialCache();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        // Restore all fs mocks
        if ((fs.readFile as any).mockRestore) {
            (fs.readFile as any).mockRestore();
        }
        if ((fs.writeFile as any).mockRestore) {
            (fs.writeFile as any).mockRestore();
        }
    });

    describe("hasCloudCredentials", () => {
        test("returns true when accounts file exists and is valid", async () => {
            spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
                version: 1,
                accounts: [{ email: "test@example.com", refreshToken: "abc", addedAt: 0, lastUsed: 0 }],
                activeIndex: 0
            }));

            const result = await auth.hasCloudCredentials();
            expect(result).toBe(true);
        });

        test("returns false when accounts file is missing", async () => {
            spyOn(fs, "readFile").mockRejectedValue({ code: "ENOENT" });

            const result = await auth.hasCloudCredentials();
            expect(result).toBe(false);
        });
    });

    describe("getCloudCredentials", () => {
        test("refreshes token when cache is empty", async () => {
            // Mock file read
            spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
                version: 1,
                accounts: [{ email: "test@example.com", refreshToken: "refresh-token", addedAt: 0, lastUsed: 0 }],
                activeIndex: 0
            }));

            // Mock fetch for token refresh
            globalThis.fetch = (async (url: string) => {
                if (url.includes("oauth2.googleapis.com/token")) {
                    return {
                        ok: true,
                        json: async () => ({
                            access_token: "new-access-token",
                            expires_in: 3600,
                            token_type: "Bearer"
                        })
                    } as Response;
                }
                return { ok: false } as Response;
            }) as any;

            const creds = await auth.getCloudCredentials();
            expect(creds.accessToken).toBe("new-access-token");
            expect(creds.email).toBe("test@example.com");
        });

        test("accepts refresh_token alias when refreshToken is missing", async () => {
            spyOn(fs, "readFile").mockResolvedValue(
                JSON.stringify({
                    version: 1,
                    accounts: [
                        {
                            email: "legacy@example.com",
                            refresh_token: "legacy-refresh-token",
                            addedAt: 0,
                            lastUsed: 0,
                        },
                    ],
                    activeIndex: 0,
                }),
            );

            globalThis.fetch = (async (url: string) => {
                if (url.includes("oauth2.googleapis.com/token")) {
                    return {
                        ok: true,
                        json: async () => ({
                            access_token: "aliased-access-token",
                            expires_in: 3600,
                            token_type: "Bearer",
                        }),
                    } as Response;
                }
                return { ok: false } as Response;
            }) as any;

            const creds = await auth.getCloudCredentials();
            expect(creds.accessToken).toBe("aliased-access-token");
            expect(creds.email).toBe("legacy@example.com");
        });

        test("falls back to legacy ~/.opencode accounts path when config path is missing", async () => {
            spyOn(fs, "readFile")
                .mockRejectedValueOnce({ code: "ENOENT" })
                .mockResolvedValueOnce(
                    JSON.stringify({
                        version: 1,
                        accounts: [
                            {
                                email: "legacy-path@example.com",
                                refreshToken: "legacy-path-refresh-token",
                                addedAt: 0,
                                lastUsed: 0,
                            },
                        ],
                        activeIndex: 0,
                    }),
                );

            globalThis.fetch = (async () => ({
                ok: true,
                json: async () => ({
                    access_token: "legacy-path-access-token",
                    expires_in: 3600,
                    token_type: "Bearer",
                }),
            })) as any;

            const creds = await auth.getCloudCredentials();
            expect(creds.accessToken).toBe("legacy-path-access-token");
            expect(creds.email).toBe("legacy-path@example.com");
        });

        test("uses managedProjectId when projectId is unavailable", async () => {
            spyOn(fs, "readFile").mockResolvedValue(
                JSON.stringify({
                    version: 1,
                    accounts: [
                        {
                            email: "managed-project@example.com",
                            refreshToken: "managed-project-refresh-token",
                            managedProjectId: "managed-project-id",
                            addedAt: 0,
                            lastUsed: 0,
                        },
                    ],
                    activeIndex: 0,
                }),
            );

            globalThis.fetch = (async () => ({
                ok: true,
                json: async () => ({
                    access_token: "managed-project-access-token",
                    expires_in: 3600,
                    token_type: "Bearer",
                }),
            })) as any;

            const creds = await auth.getCloudCredentials();
            expect(creds.projectId).toBe("managed-project-id");
        });

        test("persists normalized refreshToken when loading refresh_token alias", async () => {
            spyOn(fs, "readFile").mockResolvedValue(
                JSON.stringify({
                    version: 1,
                    accounts: [
                        {
                            email: "legacy2@example.com",
                            refresh_token: "legacy-refresh-token-2",
                            addedAt: 0,
                            lastUsed: 0,
                        },
                    ],
                    activeIndex: 0,
                }),
            );
            const writeSpy = spyOn(fs, "writeFile").mockResolvedValue(undefined as any);

            globalThis.fetch = (async () => ({
                ok: true,
                json: async () => ({
                    access_token: "new-access-token-2",
                    expires_in: 3600,
                    token_type: "Bearer",
                }),
            })) as any;

            await auth.getCloudCredentials();
            expect(writeSpy).toHaveBeenCalled();
            const writtenJson = JSON.parse(String(writeSpy.mock.calls[0]?.[1] ?? "{}"));
            expect(writtenJson.accounts?.[0]?.refreshToken).toBe("legacy-refresh-token-2");
        });

        test("continues auth when refreshToken normalization write fails", async () => {
            spyOn(fs, "readFile").mockResolvedValue(
                JSON.stringify({
                    version: 1,
                    accounts: [
                        {
                            email: "legacy3@example.com",
                            refresh_token: "legacy-refresh-token-3",
                            addedAt: 0,
                            lastUsed: 0,
                        },
                    ],
                    activeIndex: 0,
                }),
            );
            spyOn(fs, "writeFile").mockRejectedValue(new Error("EACCES"));

            globalThis.fetch = (async () => ({
                ok: true,
                json: async () => ({
                    access_token: "new-access-token-3",
                    expires_in: 3600,
                    token_type: "Bearer",
                }),
            })) as any;

            const creds = await auth.getCloudCredentials();
            expect(creds.accessToken).toBe("new-access-token-3");
            expect(creds.email).toBe("legacy3@example.com");
        });

        test("throws helpful error when refresh token is invalid", async () => {
             spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
                version: 1,
                accounts: [{ email: "different@example.com", refreshToken: "bad-token", addedAt: 0, lastUsed: 0 }],
                activeIndex: 0
            }));

            globalThis.fetch = (async () => ({
                ok: false,
                status: 400,
                text: async () => "invalid_grant"
            })) as any;

            await expect(auth.getCloudCredentials()).rejects.toThrow("Refresh token is invalid or expired");
        });
    });
});
