#!/usr/bin/env bun
import { createRequire } from "node:module";
import { QuotaService } from "./services/quota-service.js";
import { HistoryService } from "./services/history-service.js";
import { renderQuotaTable } from "./ui/quota-table.js";
import { renderHealthTable, renderProbeResults, renderCapabilitiesTable, renderDetailedProbeResult, renderAllProvidersHealth } from "./ui/health-table.js";
import { startGeminiLoginServer, refreshGeminiToken } from "./utils/gemini-auth.js";
import { startCursorLoginServer } from "./utils/cursor-auth.js";
import {
    runAuthDoctor,
    runAuthLogin,
    runAuthSetup,
    showAuthHelp,
} from "./auth/commands.js";
import { createProber, getHealthMonitor, PROVIDER_CAPABILITIES } from "./probe/index.js";
import { serveCommand, showServeHelp } from "./commands/serve.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

async function showHelp() {
    console.log(`
OpenCode Enhanced Quotas CLI v${version}

USAGE:
  opencode-quotas [COMMAND] [OPTIONS]

COMMANDS:
  (default)         Show quota usage table
  health            Show provider health dashboard
  models            Show all available models with status
  freemodels        Show only free tier models
  serve             Start OpenAI-compatible API Gateway server
  login <provider>  Authenticate with a provider
  auth <subcommand> Credential doctor and setup helpers
  help              Show this help message
  version           Show version information

HEALTH SUBCOMMANDS:
  health            Show health dashboard for all providers
  health --probe    Run active probes on all probeable providers
  health <provider> Show detailed health for a specific provider
  health --caps     Show provider capabilities table

LOGIN PROVIDERS:
  cursor            Authenticate with Cursor (opens browser)
  gemini            Authenticate with Gemini (opens browser)

OPTIONS:
  --provider <id>   Filter by provider ID
  --model <id>      Filter by model ID  
  --probe           Run active probes (health command)
  --caps            Show capabilities table (health command)
  --no-color        Disable colored output
  --version, -v     Show version number

EXAMPLES:
  opencode-quotas                    # Show all quotas
  opencode-quotas health             # Show health dashboard
  opencode-quotas health --probe     # Run active probes
  opencode-quotas health groq        # Detailed health for Groq
  opencode-quotas login cursor       # Login to Cursor
  opencode-quotas auth doctor        # Check auth health for API providers
  opencode-quotas auth doctor --probe --verbose
  opencode-quotas auth setup groq    # Configure provider credentials interactively
  opencode-quotas serve              # Start API Gateway on default port
  opencode-quotas serve --port 3000  # Start API Gateway on port 3000
  opencode-quotas models             # Show available models with state
  opencode-quotas freemodels         # Show only free tier models
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

    // Check for --probe flag to run active probes
    const shouldProbe = process.argv.includes("--probe");
    if (shouldProbe) {
        console.log("\n🔍 Running active probes on all providers...\n");
        const prober = createProber();
        const probeResults = await prober.probeAll();
        const monitor = getHealthMonitor();
        for (const result of probeResults) {
            monitor.recordProbe(result);
        }
        renderProbeResults(probeResults).forEach(line => console.log(line));
        return;
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

async function showHealth(providerId?: string) {
    if (process.argv.includes("--no-color")) {
        process.env.OPENCODE_QUOTAS_NO_COLOR = "1";
    }

    const shouldProbe = process.argv.includes("--probe");
    const shouldShowCaps = process.argv.includes("--caps");

    if (shouldShowCaps) {
        renderCapabilitiesTable(PROVIDER_CAPABILITIES).forEach(line => console.log(line));
        return;
    }

    const monitor = getHealthMonitor();

    if (shouldProbe) {
        console.log("\n🔍 Running active probes with model discovery...\n");
        const prober = createProber();
        const probeResults = await prober.probeAllModels({ maxModelsPerProvider: 10 });
        for (const result of probeResults) {
            monitor.recordProbe(result);
        }
        
        const quotaService = new QuotaService();
        await quotaService.init(process.cwd(), new HistoryService());
        const quotas = await quotaService.getQuotas({});
        
        renderAllProvidersHealth(probeResults, quotas, PROVIDER_CAPABILITIES).forEach(line => console.log(line));
        return;
    }

    if (providerId) {
        const capability = PROVIDER_CAPABILITIES.find(c => c.id === providerId || c.name.toLowerCase() === providerId.toLowerCase());
        if (!capability) {
            console.error(`\n❌ Unknown provider: ${providerId}`);
            console.error(`Available providers: ${PROVIDER_CAPABILITIES.map(c => c.id).join(", ")}\n`);
            process.exit(1);
        }

        if (capability.supportsProbe) {
            console.log(`\n🔍 Probing ${capability.name}...\n`);
            const prober = createProber();
            const result = await prober.probe(capability.id);
            monitor.recordProbe(result);
            renderDetailedProbeResult(result).forEach(line => console.log(line));
        } else {
            console.log(`\n📊 ${capability.name} doesn't support active probing (OAuth/subscription-based).\n`);
            console.log("Showing quota status instead:\n");
            
            const quotaService = new QuotaService();
            await quotaService.init(process.cwd(), new HistoryService());
            const quotas = await quotaService.getQuotas({});
            const providerQuotas = quotas.filter(q => q.providerName.toLowerCase().includes(providerId.toLowerCase()));
            
            if (providerQuotas.length > 0) {
                for (const q of providerQuotas) {
                    console.log(`  ${q.providerName}: ${q.used}${q.limit ? `/${q.limit}` : ''} ${q.unit}${q.info ? ` (${q.info})` : ''}`);
                }
            } else {
                console.log("  No quota data available. Run auth doctor to diagnose.");
            }
            console.log("");
        }
        return;
    }

    console.log("\n📊 Provider Health Overview\n");
    console.log("Run 'opencode-quotas health --probe' for active health checks");
    console.log("Run 'opencode-quotas health --caps' to see provider capabilities\n");
    
    renderCapabilitiesTable(PROVIDER_CAPABILITIES).forEach(line => console.log(line));
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (process.argv.includes("--no-color")) {
        process.env.OPENCODE_QUOTAS_NO_COLOR = "1";
    }

    if (command === "--version" || command === "-v") {
        console.log(version);
        return;
    }

    if (command === "version") {
        console.log(version);
        return;
    }

    if (command === "help" || command === "--help" || command === "-h") {
        await showHelp();
        return;
    }

    if (command === "--probe") {
        await showQuotas();
        return;
    }

    if (!command || command.startsWith("--")) {
        await showQuotas();
        return;
    }

    // Handle health command
    if (command === "health") {
        const providerArg = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
        await showHealth(providerArg);
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

    // Handle models commands
    if (command === "models") {
        const { showMyModels, showModelsHelp } = await import("./commands/models.js");
        
        if (args.includes("--help") || args.includes("-h")) {
            await showModelsHelp();
            return;
        }
        
        await showMyModels(args.slice(1));
        return;
    }

    if (command === "freemodels") {
        const { showFreeModels, showModelsHelp } = await import("./commands/models.js");
        
        if (args.includes("--help") || args.includes("-h")) {
            await showModelsHelp();
            return;
        }
        
        await showFreeModels(args.slice(1));
        return;
    }

    if (command === "serve") {
        if (args.includes("--help") || args.includes("-h")) {
            showServeHelp();
            return;
        }
        
        // Parse serve options
        const serveOptions: { port?: number; host?: string } = {};
        const portIndex = args.indexOf("--port");
        if (portIndex !== -1 && args[portIndex + 1]) {
            serveOptions.port = parseInt(args[portIndex + 1], 10);
        }
        const hostIndex = args.indexOf("--host");
        if (hostIndex !== -1 && args[hostIndex + 1]) {
            serveOptions.host = args[hostIndex + 1];
        }
        
        await serveCommand(serveOptions);
        return;
    }

    console.error(`\n❌ Unknown command: ${command}`);
    await showHelp();
    process.exit(1);
}

main().catch(console.error);
