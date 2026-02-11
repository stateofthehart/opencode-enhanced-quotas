/**
 * JetBrains AI Assistant quota provider.
 *
 * Auth: none — reads local XML files from JetBrains IDE config directories.
 * File: ~/.config/JetBrains/<IDE><version>/options/AIAssistantQuotaManager2.xml
 * Also: ~/.config/Google/<AndroidStudio><version>/options/AIAssistantQuotaManager2.xml
 *
 * The XML contains HTML-entity-encoded JSON in `quotaInfo` and `nextRefill` attributes.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { QuotaData, IQuotaProvider } from "../interfaces.js";
import { logger } from "../logger.js";

// ---------- IDE detection ----------

const JETBRAINS_IDES = [
  "IntelliJIdea",
  "PyCharm",
  "WebStorm",
  "GoLand",
  "CLion",
  "DataGrip",
  "RubyMine",
  "Rider",
  "PhpStorm",
  "RustRover",
  "Fleet",
  "Aqua",
  "DataSpell",
];

const CONFIG_ROOTS = [
  join(homedir(), ".config", "JetBrains"),
  join(homedir(), ".config", "Google"), // Android Studio
];

const QUOTA_FILE = "options/AIAssistantQuotaManager2.xml";

/** Find the most recently modified quota XML file across all installed IDEs. */
async function findNewestQuotaFile(): Promise<string | null> {
  let newest: { path: string; mtime: number } | null = null;

  for (const root of CONFIG_ROOTS) {
    if (!existsSync(root)) continue;
    try {
      const entries = await readdir(root);
      for (const entry of entries) {
        const filePath = join(root, entry, QUOTA_FILE);
        try {
          const s = await stat(filePath);
          if (s.isFile() && (!newest || s.mtimeMs > newest.mtime)) {
            newest = { path: filePath, mtime: s.mtimeMs };
          }
        } catch {
          // file doesn't exist in this IDE version
        }
      }
    } catch {
      // can't read directory
    }
  }

  return newest?.path ?? null;
}

// ---------- XML parsing ----------

/** Decode HTML entities: &quot; &#10; &amp; &lt; &gt; */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#10;/g, "\n")
    .replace(/&#13;/g, "\r")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

interface QuotaInfo {
  type?: string; // "Available"
  current?: number; // tokens used
  maximum?: number; // total tokens
  tariffQuota?: { available?: number };
  until?: string; // subscription end date
}

interface NextRefill {
  type?: string; // "Known"
  next?: string; // ISO-8601 refill date
  tariff?: { amount?: number; duration?: string };
}

function extractAttrValue(xml: string, attrName: string): string | null {
  // Match: name="attrName" value="..."
  const regex = new RegExp(
    `name="${attrName}"\\s+value="([^"]*)"`,
    "s",
  );
  const match = xml.match(regex);
  return match ? decodeHtmlEntities(match[1]) : null;
}

// ---------- Provider ----------

function formatDuration(ms: number): string {
  if (ms <= 0) return "now";
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remH = hours % 24;
    return `${days}d ${remH}h`;
  }
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

async function fetchQuota(): Promise<QuotaData[]> {
  const filePath = await findNewestQuotaFile();
  if (!filePath) {
    logger.debug("[jetbrains] No AIAssistantQuotaManager2.xml found");
    return [];
  }

  logger.debug(`[jetbrains] Reading: ${filePath}`);
  const xml = await readFile(filePath, "utf-8");

  // Parse quotaInfo
  const quotaInfoStr = extractAttrValue(xml, "quotaInfo");
  if (!quotaInfoStr) {
    logger.debug("[jetbrains] No quotaInfo attribute found");
    return [];
  }

  let quotaInfo: QuotaInfo;
  try {
    quotaInfo = JSON.parse(quotaInfoStr);
  } catch {
    logger.debug("[jetbrains] Failed to parse quotaInfo JSON");
    return [];
  }

  // Parse nextRefill
  let nextRefill: NextRefill | null = null;
  const nextRefillStr = extractAttrValue(xml, "nextRefill");
  if (nextRefillStr) {
    try {
      nextRefill = JSON.parse(nextRefillStr);
    } catch {
      // optional
    }
  }

  const used = quotaInfo.current ?? 0;
  const total = quotaInfo.maximum ?? 0;

  // Reset time: prefer nextRefill.next, fall back to quotaInfo.until
  const resetDate = nextRefill?.next || quotaInfo.until;
  let resetLabel: string | undefined;
  if (resetDate) {
    const resetMs = new Date(resetDate).getTime() - Date.now();
    if (resetMs > 0) resetLabel = formatDuration(resetMs);
  }

  // Derive IDE name from file path
  const pathParts = filePath.split("/");
  const ideDir = pathParts[pathParts.length - 3] || "JetBrains";

  return [
    {
      id: "jetbrains-tokens",
      providerName: "JetBrains AI",
      used,
      limit: total > 0 ? total : null,
      unit: "tokens",
      reset: resetLabel,
      info: ideDir,
    },
  ];
}

// ---------- Export ----------

export function createJetBrainsProvider(): IQuotaProvider {
  return {
    id: "jetbrains",
    async fetchQuota(): Promise<QuotaData[]> {
      try {
        return await fetchQuota();
      } catch (err) {
        logger.debug(`[jetbrains] failed: ${err instanceof Error ? err.message : err}`);
        return [];
      }
    },
  };
}
