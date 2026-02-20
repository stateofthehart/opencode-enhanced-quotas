import { ProviderHealth, ProbeResult, QuotaData, ProviderCapability } from "../interfaces.js";
import { formatDuration } from "../providers/provider-utils.js";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

function colorize(text: string, color: keyof typeof ANSI): string {
  const code = ANSI[color];
  if (!code || process.env.OPENCODE_QUOTAS_NO_COLOR || process.env.NO_COLOR) {
    return text;
  }
  return `${code}${text}${ANSI.reset}`;
}

function statusEmoji(status: ProviderHealth["status"]): string {
  switch (status) {
    case "healthy":
      return "✅";
    case "degraded":
      return "⚠️";
    case "down":
      return "❌";
    default:
      return "❓";
  }
}

function statusColor(status: ProviderHealth["status"]): keyof typeof ANSI {
  switch (status) {
    case "healthy":
      return "green";
    case "degraded":
      return "yellow";
    case "down":
      return "red";
    default:
      return "dim";
  }
}

function formatLatency(ms: number | undefined): string {
  if (ms === undefined) return "-";
  if (ms < 100) return `${ms}ms`;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatReset(reset: Date | undefined): string {
  if (!reset) return "-";
  const diff = reset.getTime() - Date.now();
  if (diff <= 0) return "now";
  return formatDuration(diff);
}

export function renderHealthTable(healthData: ProviderHealth[]): string[] {
  const lines: string[] = [];

  lines.push("");
  lines.push(colorize("Provider Health Dashboard", "bold"));
  lines.push("-".repeat(80));
  lines.push("");

  const header = [
    "ST".padEnd(4),
    "PROVIDER".padEnd(18),
    "STATUS".padEnd(10),
    "LATENCY".padEnd(10),
    "AVG LAT".padEnd(10),
    "FAILS".padEnd(6),
    "RATE LEFT".padEnd(12),
    "RESET".padEnd(10),
  ].join("");
  lines.push(colorize(header, "dim"));

  for (const health of healthData) {
    const statusIcon = statusEmoji(health.status);
    const statusText = colorize(health.status.toUpperCase().padEnd(4), statusColor(health.status));
    const provider = health.provider.padEnd(18);
    const latency = formatLatency(health.latencyMs).padEnd(10);
    const avgLatency = formatLatency(health.avgLatencyMs).padEnd(10);
    const fails = health.consecutiveFailures.toString().padEnd(6);
    const rateLeft = health.rateLimitRemaining !== undefined
      ? `${health.rateLimitRemaining}`.padEnd(12)
      : "-".padEnd(12);
    const reset = formatReset(health.rateLimitReset).padEnd(10);

    lines.push(`${statusText} ${provider} ${statusIcon.padEnd(10)} ${latency} ${avgLatency} ${fails} ${rateLeft} ${reset}`);
  }

  lines.push("");
  lines.push(colorize(`Total: ${healthData.length} providers | Healthy: ${healthData.filter(h => h.status === "healthy").length} | Degraded: ${healthData.filter(h => h.status === "degraded").length} | Down: ${healthData.filter(h => h.status === "down").length}`, "dim"));
  lines.push("");

  return lines;
}

export function renderProbeResults(results: ProbeResult[]): string[] {
  const lines: string[] = [];

  lines.push("");
  lines.push(colorize("Active Probe Results", "bold"));
  lines.push("-".repeat(80));
  lines.push("");

  const header = [
    "ST".padEnd(4),
    "PROVIDER".padEnd(18),
    "MODEL".padEnd(35),
    "LATENCY".padEnd(10),
    "RATE LEFT".padEnd(12),
    "ERROR".padEnd(20),
  ].join("");
  lines.push(colorize(header, "dim"));

  for (const result of results) {
    const statusIcon = result.available ? "✅" : "❌";
    const statusText = result.available
      ? colorize("OK  ", "green")
      : colorize("ERR ", "red");
    const provider = result.provider.padEnd(18);
    const model = result.model.slice(0, 35).padEnd(35);
    const latency = formatLatency(result.latencyMs).padEnd(10);
    const rateLeft = result.rateLimitRemaining !== undefined
      ? `${result.rateLimitRemaining}`.padEnd(12)
      : "-".padEnd(12);
    const error = result.error?.type || "-";

    lines.push(`${statusText} ${provider} ${model} ${latency} ${rateLeft} ${error}`);
  }

  lines.push("");
  lines.push(colorize(`Probed: ${results.length} providers | Available: ${results.filter(r => r.available).length} | Failed: ${results.filter(r => !r.available).length}`, "dim"));
  lines.push("");

  return lines;
}

export function renderDetailedProbeResult(result: ProbeResult): string[] {
  const lines: string[] = [];

  lines.push("");
  lines.push(colorize(`Probe Result: ${result.provider}`, "bold"));
  lines.push("-".repeat(60));
  lines.push("");

  lines.push(`  Status:      ${result.available ? colorize("✅ Available", "green") : colorize("❌ Unavailable", "red")}`);
  lines.push(`  Model:       ${result.model}`);
  lines.push(`  Latency:     ${formatLatency(result.latencyMs)}`);
  lines.push(`  Timestamp:   ${result.timestamp.toISOString()}`);

  if (result.rateLimitRemaining !== undefined) {
    lines.push(`  Rate Limit:  ${result.rateLimitRemaining}${result.rateLimitLimit ? ` / ${result.rateLimitLimit}` : ""} remaining`);
  }

  if (result.rateLimitReset) {
    lines.push(`  Reset:       ${formatReset(result.rateLimitReset)}`);
  }

  if (result.error) {
    lines.push("");
    lines.push(colorize("  Error Details:", "yellow"));
    lines.push(`    Type:      ${result.error.type}`);
    if (result.error.message) {
      lines.push(`    Message:   ${result.error.message}`);
    }
    if (result.error.retryAfter) {
      lines.push(`    Retry in:  ${formatDuration(result.error.retryAfter)}`);
    }
  }

  if (result.headers && Object.keys(result.headers).length > 0) {
    lines.push("");
    lines.push(colorize("  Response Headers:", "cyan"));
    const relevantHeaders = Object.entries(result.headers)
      .filter(([k]) => k.toLowerCase().includes("rate") || k.toLowerCase().includes("limit") || k.toLowerCase().includes("retry"))
      .slice(0, 10);
    for (const [key, value] of relevantHeaders) {
      lines.push(`    ${key}: ${value}`);
    }
  }

  lines.push("");

  return lines;
}

export function renderCapabilitiesTable(capabilities: ProviderCapability[]): string[] {
  const lines: string[] = [];

  lines.push("");
  lines.push(colorize("Supported Providers & Capabilities", "bold"));
  lines.push("-".repeat(100));
  lines.push("");

  const header = [
    "PROVIDER".padEnd(18),
    "TELEMETRY".padEnd(15),
    "PROBE".padEnd(8),
    "FREE".padEnd(8),
    "PAYG".padEnd(8),
    "SUB".padEnd(8),
    "MODEL".padEnd(30),
  ].join("");
  lines.push(colorize(header, "dim"));

  for (const cap of capabilities) {
    const provider = cap.name.padEnd(18);
    const telemetry = cap.telemetryType.padEnd(15);
    const probe = cap.supportsProbe ? "✅" : "❌";
    const free = cap.isFreeTier ? "✅" : "❌";
    const payg = cap.isPayAsYouGo ? "✅" : "❌";
    const sub = cap.isSubscription ? "✅" : "❌";
    const model = (cap.probeModel || "-").slice(0, 30);

    lines.push(`${provider} ${telemetry} ${probe.padEnd(8)} ${free.padEnd(8)} ${payg.padEnd(8)} ${sub.padEnd(8)} ${model}`);
  }

  lines.push("");
  lines.push(colorize(`Total: ${capabilities.length} providers | Probeable: ${capabilities.filter(c => c.supportsProbe).length}`, "dim"));
  lines.push("");

  return lines;
}

export function renderAllProvidersHealth(
  probeResults: ProbeResult[],
  quotas: QuotaData[],
  capabilities: ProviderCapability[],
  showAllModels: boolean = false
): string[] {
  const lines: string[] = [];

  lines.push("");
  lines.push(colorize("Provider Health Dashboard", "bold"));
  lines.push("-".repeat(120));
  lines.push("");

  const header = [
    "ST".padEnd(4),
    "PROVIDER".padEnd(16),
    "MODEL".padEnd(32),
    "LATENCY".padEnd(10),
    "RATE LEFT".padEnd(12),
    "QUOTA STATUS".padEnd(25),
    "ERROR".padEnd(15),
  ].join("");
  lines.push(colorize(header, "dim"));

  const probedProviders = new Set(probeResults.map(p => p.provider));
  
  for (const cap of capabilities) {
    const providerProbes = probeResults.filter(p => p.provider === cap.id);
    const providerQuotas = quotas.filter(q => 
      q.providerName.toLowerCase().includes(cap.name.toLowerCase()) ||
      q.id.toLowerCase().includes(cap.id.toLowerCase())
    );

    if (providerProbes.length > 0) {
      const modelsToShow = showAllModels ? providerProbes : providerProbes.slice(0, 3);
      
      for (let i = 0; i < modelsToShow.length; i++) {
        const probe = modelsToShow[i];
        const statusText = probe.available ? colorize("OK ", "green") : colorize("ERR", "red");
        const latency = formatLatency(probe.latencyMs);
        const rateLeft = probe.rateLimitRemaining !== undefined ? `${probe.rateLimitRemaining}` : "-";
        const error = probe.error?.type || "-";
        
        const providerDisplay = i === 0 ? cap.name.padEnd(16) : " ".repeat(16);
        const modelName = probe.model || "unknown";
        const modelDisplay = (modelName.length > 30 ? modelName.slice(0, 27) + "..." : modelName).padEnd(32);
        
        let quotaStatus = "-";
        if (i === 0 && providerQuotas.length > 0) {
          quotaStatus = providerQuotas
            .slice(0, 1)
            .map(q => {
              const used = q.used;
              const limit = q.limit !== null ? `/${q.limit}` : "";
              return `${used}${limit} ${q.unit}`;
            })
            .join("; ")
            .slice(0, 25);
        }
        
        lines.push(`${statusText} ${providerDisplay} ${modelDisplay} ${latency.padEnd(10)} ${rateLeft.padEnd(12)} ${quotaStatus.padEnd(25)} ${error}`);
      }
      
      if (!showAllModels && providerProbes.length > 3) {
        const moreCount = providerProbes.length - 3;
        const moreText = `  ... and ${moreCount} more models`;
        lines.push(colorize(`    ${"".padEnd(16)} ${moreText.padEnd(32)}`, "dim"));
      }
    } else {
      const type = cap.supportsProbe ? "quota" : "oauth";
      
      let statusText: string;
      let quotaStatus: string;
      
      if (providerQuotas.length > 0) {
        const hasErr = providerQuotas.some(q => q.info?.toLowerCase().includes("err") || q.unit === "status");
        const hasOk = providerQuotas.some(q => q.used > 0 && !q.info?.toLowerCase().includes("err"));
        
        statusText = hasErr ? colorize("WRN", "yellow") : (hasOk ? colorize("OK ", "green") : colorize("UNK", "dim"));
        quotaStatus = providerQuotas
          .slice(0, 2)
          .map(q => {
            const used = q.used;
            const limit = q.limit !== null ? `/${q.limit}` : "";
            return `${used}${limit} ${q.unit}`;
          })
          .join("; ")
          .slice(0, 25);
      } else {
        statusText = colorize("N/A", "dim");
        quotaStatus = "-";
      }
      
      const provider = cap.name.padEnd(16);
      const typeCol = `[${type}]`.padEnd(32);
      
      lines.push(`${statusText} ${provider} ${typeCol} ${"-".padEnd(10)} ${"-".padEnd(12)} ${quotaStatus.padEnd(25)} -`);
    }
  }

  const okCount = probeResults.filter(p => p.available).length;
  const errCount = probeResults.filter(p => !p.available).length;
  const providerCount = new Set(probeResults.map(p => p.provider)).size;
  const capabilitiesProviderCount = capabilities.filter(c => c.supportsProbe).length;
  const noProbeCount = Math.max(0, capabilitiesProviderCount - providerCount);

  lines.push("");
  lines.push(colorize(
    `Models: ${probeResults.length} probed, ${okCount} available, ${errCount} failed | Providers: ${providerCount} probed, ${noProbeCount} not probed`,
    "dim"
  ));
  lines.push("");

  return lines;
}
