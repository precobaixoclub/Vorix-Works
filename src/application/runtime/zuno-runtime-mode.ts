export const ZUNO_RUNTIME_MODES = ["LOCAL_PRODUCTION"] as const;

export type ZunoRuntimeMode = (typeof ZUNO_RUNTIME_MODES)[number];

export const DEFAULT_ZUNO_RUNTIME_MODE: ZunoRuntimeMode = "LOCAL_PRODUCTION";

export function parseZunoRuntimeMode(value: string | undefined): ZunoRuntimeMode {
  if (!value?.trim()) return DEFAULT_ZUNO_RUNTIME_MODE;

  const normalized = value.trim().replace(/-/g, "_").toUpperCase();
  if (normalized === "LOCAL_PRODUCTION") return "LOCAL_PRODUCTION";

  throw new Error(`Modo de execução inválido: ${value}. Nesta fase use apenas local-production.`);
}
