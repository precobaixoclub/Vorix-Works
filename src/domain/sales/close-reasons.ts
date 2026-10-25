export function closeReasonKey(label: string): string {
  return label.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

/** Older workspaces may contain duplicate rows created by concurrent bootstrap requests. */
export function uniqueCloseReasonLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  return labels.map((label) => label.trim().replace(/\s+/g, " ")).filter((label) => {
    const key = closeReasonKey(label);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
