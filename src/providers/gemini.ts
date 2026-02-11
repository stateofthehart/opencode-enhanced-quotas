/**
 * Gemini (Google) quota provider.
 *
 * Auth: OAuth token from ~/.gemini/oauth_creds.json (created by `gemini` CLI).
 * Endpoint: POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota
 *
 * Returns per-model remainingFraction + resetTime from quota_buckets.
 */

import type { QuotaData, IQuotaProvider } from "../interfaces.js";
import { logger } from "../logger.js";
import { getValidGeminiToken } from "../utils/gemini-auth.js";

// ---------- Auth ----------

async function getToken(): Promise<string | null> {
  // Use the auto-refresh utility
  return await getValidGeminiToken();
}

// ---------- API ----------

interface QuotaBucket {
  remainingFraction: number; // 0.0 – 1.0
  resetTime: string; // ISO-8601
  modelId?: string;
}

interface QuotaResponse {
  quota_buckets?: QuotaBucket[];
  quotaBuckets?: QuotaBucket[];
  buckets?: QuotaBucket[];
}

interface CloudProject {
  projectId?: string;
  lifecycleState?: string;
}

interface ProjectsResponse {
  projects?: CloudProject[];
}

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

async function fetchQuota(token: string): Promise<QuotaData[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);

  try {
    let projectId: string | undefined;
    try {
      const projectsRes = await fetch("https://cloudresourcemanager.googleapis.com/v1/projects", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: ctrl.signal,
      });
      if (projectsRes.ok) {
        const projectsBody = (await projectsRes.json()) as ProjectsResponse;
        projectId = projectsBody.projects?.find((p) => p.lifecycleState === "ACTIVE")?.projectId
          ?? projectsBody.projects?.[0]?.projectId;
      }
    } catch {
      // optional probe, ignore failures
    }

    const res = await fetch("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(projectId ? { project: projectId } : {}),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as QuotaResponse;
    const buckets = data.quota_buckets ?? data.quotaBuckets ?? data.buckets ?? [];
    if (!buckets.length) return [];

    // Group by model, take lowest remainingFraction per model
    const byModel = new Map<string, QuotaBucket>();
    for (const bucket of buckets) {
      const model = bucket.modelId || "gemini";
      const existing = byModel.get(model);
      if (!existing || bucket.remainingFraction < existing.remainingFraction) {
        byModel.set(model, bucket);
      }
    }

    const results: QuotaData[] = [];
    for (const [model, bucket] of byModel) {
      const usedPct = Math.round((1 - bucket.remainingFraction) * 100);
      const resetMs = new Date(bucket.resetTime).getTime() - Date.now();
      const shortModel = model.replace("models/", "").replace("gemini-", "g");

      results.push({
        id: `gemini-${shortModel}`,
        providerName: "Gemini",
        used: usedPct,
        limit: 100,
        unit: "%",
        reset: resetMs > 0 ? formatDuration(resetMs) : undefined,
        info: model,
      });
    }

    return results;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Export ----------

export function createGeminiProvider(): IQuotaProvider {
  return {
    id: "gemini",
    async fetchQuota(): Promise<QuotaData[]> {
      const token = await getToken();
      if (!token) {
        logger.debug("[gemini] No token (install gemini CLI + run `gemini auth login`)");
        return [];
      }
      try {
        return await fetchQuota(token);
      } catch (err) {
        logger.debug(`[gemini] fetch failed: ${err instanceof Error ? err.message : err}`);
        return [];
      }
    },
  };
}
