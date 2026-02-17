#!/usr/bin/env bun
import { createRequire } from "node:module";
import { QuotaService } from "./services/quota-service.js";
import { HistoryService } from "./services/history-service.js";
import { renderQuotaTable } from "./ui/quota-table.js";
import { startGeminiLoginServer, refreshGeminiToken } from "./utils/gemini-auth.js";
import { startCursorLoginServer } from "./utils/cursor-auth.js";
import {
    runAuthDoctor,
    runAuthLogin,
    runAuthSetup,
    showAuthHelp,
} from "./auth/commands.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

async function showHelp() {
    console.log(`
OpenCode Enhanced Quotas CLI v${version}

USAGE:
  opencode-quotas [COMMAND] [OPTIONS]

COMMANDS:
  (default)         Show quota usage table
  login <provider>  Authenticate with a provider
  auth <subcommand> Credential doctor and setup helpers
  help              Show this help message
  version           Show version information

LOGIN PROVIDERS:
  cursor            Authenticate with Cursor (opens browser)
  gemini            Authenticate with Gemini (opens browser)

OPTIONS:
  --provider <id>   Filter by provider ID
  --model <id>      Filter by model ID  
  --no-color        Disable colored output
  --version, -v     Show version number

EXAMPLES:
  opencode-quotas                    # Show all quotas
  opencode-quotas login cursor       # Login to Cursor
  opencode-quotas auth doctor        # Check auth health for API providers
  opencode-quotas auth doctor --probe --verbose
  opencode-quotas auth setup groq    # Configure provider credentials interactively
  opencode-quotas --provider codex   # Show only Codex quotas
  opencode-quotas --version          # Show version
`);
}

async function showLoginHelp() {
    console.log(`
Login to a provider to enable quota tracking.

USAGE:
  opencode-quotas login <provider>

AVAILABLE PROVIDERS:
  cursor     - Cursor AI (cursor.com)
               Opens browser for OAuth authentication
               
  gemini     - Google Gemini (gemini.google.com)
               Opens browser for OAuth authentication

EXAMPLES:
  opencode-quotas login cursor
  opencode-quotas login gemini
`);
}

async function handleCursorLogin() {
    console.log("\n🔐 Cursor Login\n");
    console.log("Starting OAuth authentication flow...");
    console.log("A browser window will open for you to login.\n");
    
    try {
        const success = await startCursorLoginServer();
        if (success) {
            console.log("\n✅ Successfully authenticated with Cursor!");
            console.log("You can now use 'opencode-quotas' to see your Cursor quotas.\n");
        } else {
            console.log("\n❌ Authentication failed or was cancelled.");
            console.log("Please try again.\n");
            process.exit(1);
        }
    } catch (error: any) {
        console.error("\n❌ Login error:", error.message);
        process.exit(1);
    }
}

async function handleGeminiLogin() {
    console.log("\n🔐 Gemini Login\n");
    console.log("Starting OAuth authentication flow...");
    console.log("A browser window will open for you to login.\n");
    
    try {
        const success = await startGeminiLoginServer();
        if (success) {
            console.log("\n✅ Successfully authenticated with Gemini!");
            console.log("You can now use 'opencode-quotas' to see your Gemini quotas.\n");
        } else {
            console.log("\n❌ Authentication failed or was cancelled.");
            console.log("Please try again.\n");
            process.exit(1);
        }
    } catch (error: any) {
        console.error("\n❌ Login error:", error.message);
        process.exit(1);
    }
}

async function showQuotas() {
    if (process.argv.includes("--no-color")) {
        process.env.OPENCODE_QUOTAS_NO_COLOR = "1";
    }

    const historyService = new HistoryService();
    await historyService.init();

    const quotaService = new QuotaService();
    await quotaService.init(process.cwd(), historyService);

    const config = quotaService.getConfig();

    // Parse arguments for provider and model filtering
    let providerId: string | undefined;
    let modelId: string | undefined;

    const providerIdx = process.argv.indexOf("--provider");
    if (providerIdx !== -1 && providerIdx + 1 < process.argv.length) {
        providerId = process.argv[providerIdx + 1];
    }

    const modelIdx = process.argv.indexOf("--model");
    if (modelIdx !== -1 && modelIdx + 1 < process.argv.length) {
        modelId = process.argv[modelIdx + 1];
    }

    const filteredResults = await quotaService.getQuotas({ providerId, modelId });

    if (filteredResults.length === 0) {
        console.log("No active quotas found.");
        return;
    }

    console.log(""); // Empty line
    console.log("📊 OpenCode Quotas");
    console.log("------------------");

    renderQuotaTable(filteredResults, {
        progressBarConfig: config.progressBar,
        tableConfig: config.table,
    }).forEach((row) => {
        console.log(row.line);
    });
    console.log(""); // Empty line
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    // Handle version
    if (command === "--version" || command === "-v" || command === "version") {
        console.log(version);
        return;
    }

    // Handle help explicitly
    if (command === "help" || command === "--help" || command === "-h") {
        await showHelp();
        return;
    }
    
    // No command = show quotas (default behavior)
    if (!command) {
        await showQuotas();
        return;
    }

    // Handle login
    if (command === "login") {
        const provider = args[1];
        
        if (!provider || provider === "help" || provider === "--help") {
            await showLoginHelp();
            return;
        }

        switch (provider.toLowerCase()) {
            case "cursor":
                await handleCursorLogin();
                break;
            case "gemini":
                await handleGeminiLogin();
                break;
            default:
                console.error(`\n❌ Unknown provider: ${provider}`);
                console.error("Available providers: cursor, gemini\n");
                process.exit(1);
        }
        return;
    }

    // Handle auth helpers
    if (command === "auth") {
        const subcommand = args[1];
        if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
            await showAuthHelp();
            return;
        }

        if (subcommand === "doctor") {
            const verbose = args.includes("--verbose") || args.includes("-v");
            const probe = args.includes("--probe");
            await runAuthDoctor({ verbose, probe });
            return;
        }

        if (subcommand === "setup") {
            const setupTarget = args[2];
            if (setupTarget === "--help" || setupTarget === "-h" || setupTarget === "help") {
                await showAuthHelp();
                return;
            }
            await runAuthSetup(setupTarget);
            return;
        }

        if (subcommand === "login") {
            const loginTarget = args[2];
            if (!loginTarget || args.includes("--help") || args.includes("-h") || loginTarget === "help") {
                await showAuthHelp();
                return;
            }
            await runAuthLogin(loginTarget);
            return;
        }

        if (subcommand === "import") {
            const envFile = args[2];
            if (!envFile || args.includes("--help") || args.includes("-h") || envFile === "help") {
                await showAuthHelp();
                return;
            }
            const { runAuthImport } = await import("./auth/commands.js");
            await runAuthImport(envFile);
            return;
        }

        if (subcommand === "export") {
            const mask = args.includes("--mask") || args.includes("-m");
            const outputIdx = args.indexOf("--output");
            const outputPath = outputIdx !== -1 && outputIdx + 1 < args.length ? args[outputIdx + 1] : undefined;
            const { runAuthExport } = await import("./auth/commands.js");
            await runAuthExport(outputPath, mask);
            return;
        }

        console.error(`\n❌ Unknown auth subcommand: ${subcommand}`);
        await showAuthHelp();
        process.exit(1);
    }

    console.error(`\n❌ Unknown command: ${command}`);
    await showHelp();
    process.exit(1);
}

main().catch(console.error);
