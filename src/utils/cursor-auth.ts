import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";

/**
 * Cursor browser cookie extraction utility.
 *
 * Extracts WorkosCursorSessionToken from Chrome/Firefox cookies
 * to authenticate with Cursor's usage API.
 */

interface CursorCookie {
    name: string;
    value: string;
    domain: string;
    encryptedBytes?: number;
    encryptedHex?: string;
}

// Chrome/Chromium/Cursor cookie roots.
const CHROME_COOKIE_ROOTS = [
    join(homedir(), ".config", "google-chrome"),
    join(homedir(), ".config", "chromium"),
    join(homedir(), ".config", "Cursor"),
    join(homedir(), ".var", "app", "com.google.Chrome", "config", "google-chrome"),
];

async function chromeCookiePaths(): Promise<string[]> {
    const { readdir } = await import("node:fs/promises");
    const candidates = new Set<string>();

    for (const root of CHROME_COOKIE_ROOTS) {
        if (!existsSync(root)) continue;
        const defaultDb = join(root, "Default", "Cookies");
        if (existsSync(defaultDb)) candidates.add(defaultDb);

        try {
            const entries = await readdir(root, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (entry.name.startsWith("Profile ")) {
                    const db = join(root, entry.name, "Cookies");
                    if (existsSync(db)) candidates.add(db);
                }
            }
        } catch {
            // ignore root enumeration failures
        }

        const rootDb = join(root, "Cookies");
        if (existsSync(rootDb)) candidates.add(rootDb);
    }

    return [...candidates];
}

// Firefox cookie database paths
const FIREFOX_COOKIE_PATHS = [
    join(homedir(), ".mozilla", "firefox", "*.default-release", "cookies.sqlite"),
    join(homedir(), ".mozilla", "firefox", "*.default", "cookies.sqlite"),
];

/**
 * Read cookies from Chrome/Chromium SQLite database
 */
async function readChromeCookies(dbPath: string): Promise<CursorCookie[]> {
    try {
        // Use sqlite3 CLI to query
        const { execSync } = await import("child_process");
        
        // Chrome encrypts cookies on some platforms, but on Linux they're often plaintext
        const result = execSync(
            `sqlite3 "${dbPath}" "SELECT name, value, host_key, length(encrypted_value), hex(encrypted_value) FROM cookies WHERE host_key LIKE '%cursor.com' OR host_key LIKE '%cursor.sh'" 2>/dev/null || echo ""`,
            { encoding: "utf-8", timeout: 5000 }
        );

        const cookies: CursorCookie[] = [];
        const lines = result.trim().split("\n").filter(Boolean);
        
        for (const line of lines) {
            const parts = line.split("|");
            if (parts.length >= 3) {
                cookies.push({
                    name: parts[0],
                    value: parts[1],
                    domain: parts[2],
                    encryptedBytes: parts[3] ? Number(parts[3]) : 0,
                    encryptedHex: parts[4] || "",
                });
            }
        }

        return cookies;
    } catch {
        return [];
    }
}

function tryDecryptChromeCookie(encryptedHex: string, passphrase: string): string | null {
    try {
        if (!encryptedHex) return null;
        const buf = Buffer.from(encryptedHex, "hex");
        if (buf.length < 4) return null;

        // Linux Chromium cookies usually start with v10 / v11 prefix.
        let payload = buf;
        if (buf.slice(0, 3).toString("utf-8") === "v10" || buf.slice(0, 3).toString("utf-8") === "v11") {
            payload = buf.slice(3);
        }

        const key = pbkdf2Sync(passphrase, "saltysalt", 1, 16, "sha1");
        const iv = Buffer.alloc(16, 0x20); // 16 spaces
        const decipher = createDecipheriv("aes-128-cbc", key, iv);
        const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
        return decrypted.toString("utf-8").replace(/[\x00-\x1F]+$/g, "");
    } catch {
        return null;
    }
}

async function possibleChromePassphrases(): Promise<string[]> {
    const values = new Set<string>(["peanuts"]);
    try {
        const { execSync } = await import("node:child_process");
        const probes = [
            "secret-tool lookup application chrome",
            "secret-tool lookup application chromium",
            "secret-tool lookup application Cursor",
            "secret-tool lookup application Google\\ Chrome",
        ];
        for (const cmd of probes) {
            try {
                const out = execSync(cmd, { encoding: "utf-8", timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
                if (out) values.add(out);
            } catch {
                // ignore probe failures
            }
        }
    } catch {
        // ignore if require/exec unavailable
    }
    return [...values];
}

/**
 * Read cookies from Firefox SQLite database
 */
async function readFirefoxCookies(dbPath: string): Promise<CursorCookie[]> {
    try {
        const { execSync } = await import("child_process");
        const { readdir } = await import("fs/promises");
        const { dirname } = await import("path");
        
        // Find the actual profile directory
        // dbPath is like: ~/.mozilla/firefox/*.default-release/cookies.sqlite
        const firefoxDir = dirname(dirname(dbPath));
        let actualPath: string | null = null;
        
        try {
            const entries = await readdir(firefoxDir);
            const profileDir = entries.find(e => e.includes(".default"));
            if (profileDir) {
                actualPath = join(firefoxDir, profileDir, "cookies.sqlite");
            }
        } catch {
            return [];
        }
        
        if (!actualPath) return [];
        
        const result = execSync(
            `sqlite3 "${actualPath}" "SELECT name, value, host FROM moz_cookies WHERE host LIKE '%cursor.com' OR host LIKE '%cursor.sh'" 2>/dev/null || echo ""`,
            { encoding: "utf-8", timeout: 5000 }
        );

        const cookies: CursorCookie[] = [];
        const lines = result.trim().split("\n").filter(Boolean);
        
        for (const line of lines) {
            const parts = line.split("|");
            if (parts.length >= 3) {
                cookies.push({
                    name: parts[0],
                    value: parts[1],
                    domain: parts[2],
                });
            }
        }

        return cookies;
    } catch {
        return [];
    }
}

/**
 * Extract WorkosCursorSessionToken from browser cookies
 */
export async function extractCursorSessionCookie(): Promise<string | null> {
    // Try Chrome/Chromium/Cursor first
    const chromePaths = await chromeCookiePaths();
    for (const chromePath of chromePaths) {
        if (existsSync(chromePath)) {
            const cookies = await readChromeCookies(chromePath);
            const sessionCookie = cookies.find(
                c => c.name === "WorkosCursorSessionToken" && (c.value.includes("::") || c.value.length > 50)
            );
            if (sessionCookie) {
                return sessionCookie.value;
            }

            // If cookie exists but plaintext value is empty, attempt Linux decryption.
            const encryptedCookie = cookies.find(
                (c) => c.name === "WorkosCursorSessionToken" && !c.value && (c.encryptedBytes ?? 0) > 0 && !!c.encryptedHex,
            );
            if (encryptedCookie?.encryptedHex) {
                const passphrases = await possibleChromePassphrases();
                for (const passphrase of passphrases) {
                    const decrypted = tryDecryptChromeCookie(encryptedCookie.encryptedHex, passphrase);
                    if (decrypted && (decrypted.includes("::") || decrypted.length > 50)) {
                        return decrypted;
                    }
                }
            }
        }
    }

    // Try Firefox
    for (const firefoxPath of FIREFOX_COOKIE_PATHS) {
        const cookies = await readFirefoxCookies(firefoxPath);
        const sessionCookie = cookies.find(
            c => c.name === "WorkosCursorSessionToken" && (c.value.includes("::") || c.value.length > 50)
        );
        if (sessionCookie) {
            return sessionCookie.value;
        }
    }

    return null;
}

/**
 * Build Cookie header for Cursor API requests
 */
export async function buildCursorCookieHeader(): Promise<string | null> {
    const sessionToken = await extractCursorSessionCookie();
    if (!sessionToken) return null;

    // The cookie header format Cursor expects
    return `WorkosCursorSessionToken=${sessionToken}`;
}

/**
 * Check if browser cookies are available
 */
export async function hasCursorBrowserAuth(): Promise<boolean> {
    const cookie = await extractCursorSessionCookie();
    return cookie !== null;
}

/**
 * Start a login server for Cursor OAuth
 * Guides users to login via browser and cursor-agent CLI
 */
export async function startCursorLoginServer(): Promise<boolean> {
    console.log("\n📱 Cursor Authentication\n");
    console.log("Cursor requires browser authentication. Please follow these steps:\n");
    console.log("  1. Make sure cursor-agent is installed:");
    console.log("     curl -fsSL https://cursor.com/install | bash");
    console.log("");
    console.log("  2. Login via CLI:");
    console.log("     cursor-agent login");
    console.log("");
    console.log("  3. Open cursor.com in your browser and login");
    console.log("");
    console.log("  4. The plugin will automatically detect your session.\n");
    console.log("  5. After logging in, run 'opencode-quotas' to see your quotas.\n");
    
    return false;
}
