const QUOTA_COMMANDS = new Set(["usage", "mymodels", "usage-logs"]);

export function normalizeCommandName(command: string): string {
    const firstToken = command.trim().split(/\s+/, 1)[0] ?? "";
    return firstToken.replace(/^\/+/, "").toLowerCase();
}

export function isQuotaCommand(command: string): boolean {
    return QUOTA_COMMANDS.has(normalizeCommandName(command));
}
