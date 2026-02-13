import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AUTH_FILE } from "../utils/paths.js";

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remH = hours % 24;
    return `${days}d ${remH}h`;
  }
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function parseDurationToMs(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();

  const asNumber = Number.parseFloat(trimmed);
  if (Number.isFinite(asNumber) && !trimmed.endsWith("ms") && !trimmed.endsWith("s") && !trimmed.endsWith("m") && !trimmed.endsWith("h")) {
    return asNumber * 1000;
  }

  const parts = [...trimmed.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/g)];
  if (parts.length === 0) return null;

  let total = 0;
  for (const p of parts) {
    const n = Number.parseFloat(p[1] || "0");
    const unit = p[2];
    if (!Number.isFinite(n)) continue;
    if (unit === "ms") total += n;
    else if (unit === "s") total += n * 1000;
    else if (unit === "m") total += n * 60_000;
    else if (unit === "h") total += n * 3_600_000;
    else if (unit === "d") total += n * 86_400_000;
  }

  return total > 0 ? total : null;
}

export async function readProviderConfig(fileName: string): Promise<Record<string, unknown> | null> {
  return readProviderConfigCandidates([fileName]);
}

export function readStringByAliasObject(
  obj: unknown,
  aliases: string[],
): string | null {
  return readStringByAliases(obj, aliases);
}

type OpenCodeAuthMap = Record<string, unknown>;

async function readOpenCodeAuthMap(): Promise<OpenCodeAuthMap | null> {
  try {
    const raw = await readFile(AUTH_FILE(), "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as OpenCodeAuthMap;
  } catch {
    return null;
  }
}

function findOpenCodeAuthEntry(
  authMap: OpenCodeAuthMap,
  providerAliases: string[],
): unknown {
  if (providerAliases.length === 0) return null;

  const wanted = providerAliases.map((alias) => normalizeKey(alias));

  for (const [providerID, info] of Object.entries(authMap)) {
    const normalizedProviderID = normalizeKey(providerID);
    if (wanted.some((alias) => normalizedProviderID === alias || normalizedProviderID.includes(alias))) {
      return info;
    }
  }

  return null;
}

export async function readOpenCodeAuthField(
  providerAliases: string[],
  fieldAliases: string[],
): Promise<string | null> {
  const authMap = await readOpenCodeAuthMap();
  if (!authMap) return null;

  const entry = findOpenCodeAuthEntry(authMap, providerAliases);
  if (!entry) return null;

  return readStringByAliases(entry, fieldAliases);
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readStringByAliases(
  obj: unknown,
  aliases: string[],
  depth = 0,
): string | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || depth > 3) return null;

  const rec = obj as Record<string, unknown>;
  const wanted = new Set(aliases.map(normalizeKey));

  for (const [k, v] of Object.entries(rec)) {
    if (typeof v === "string" && v.trim() && wanted.has(normalizeKey(k))) {
      return v.trim();
    }
  }

  for (const value of Object.values(rec)) {
    const nested = readStringByAliases(value, aliases, depth + 1);
    if (nested) return nested;
  }

  return null;
}

export async function readProviderConfigCandidates(
  fileNames: string[],
): Promise<Record<string, unknown> | null> {
  const bases = [
    join(homedir(), ".config", "opencode"),
    join(homedir(), ".opencode"),
  ];

  for (const base of bases) {
    for (const fileName of fileNames) {
      try {
        const raw = await readFile(join(base, fileName), "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Continue searching remaining candidates.
      }
    }
  }

  return null;
}

export async function readStringFromConfigCandidates(
  fileNames: string[],
  aliases: string[],
): Promise<string | null> {
  const config = await readProviderConfigCandidates(fileNames);
  if (!config) return null;
  return readStringByAliases(config, aliases);
}

export async function readApiKey(
  envKeys: string[],
  configFile: string | string[],
  configKeys: string[] = [
    "apiKey",
    "api_key",
    "apiToken",
    "token",
    "accessToken",
    "access_token",
    "key",
  ],
  openCodeProviderAliases: string[] = [],
): Promise<string | null> {
  for (const envKey of envKeys) {
    const value = process.env[envKey];
    if (value && value.trim()) return value.trim();
  }

  const files = Array.isArray(configFile) ? configFile : [configFile];
  const fromConfig = await readStringFromConfigCandidates(files, configKeys);
  if (fromConfig) return fromConfig;

  if (openCodeProviderAliases.length > 0) {
    return readOpenCodeAuthField(openCodeProviderAliases, configKeys);
  }

  return null;
}
