/**
 * Leitura respeitosa de robots.txt (seção 2). Interpretação conservadora: qualquer `Disallow`
 * sob `User-agent: *` (ou sob o user-agent explícito informado) bloqueia o caminho: nunca
 * ignoramos uma regra por incerteza. Ausência de robots.txt (404/erro de rede) é tratada como
 * "sem restrições declaradas", nunca como bloqueio — mas o chamador ainda deve manter o crawl
 * pequeno e respeitoso por conta própria (ver `WebsiteDiscoveryOptions.maxPages`).
 */

export type RobotsRules = {
  disallowedPaths: string[];
  fetchedOk: boolean;
};

const FETCH_TIMEOUT_MS = 10_000;

export async function fetchRobotsRules(domain: string, userAgent = "*"): Promise<RobotsRules> {
  const url = `https://${domain}/robots.txt`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { disallowedPaths: [], fetchedOk: false };
    }
    const body = await response.text();
    return { disallowedPaths: parseDisallowedPaths(body, userAgent), fetchedOk: true };
  } catch {
    return { disallowedPaths: [], fetchedOk: false };
  } finally {
    clearTimeout(timeout);
  }
}

export function parseDisallowedPaths(robotsTxtBody: string, userAgent: string): string[] {
  const lines = robotsTxtBody.split(/\r?\n/).map((line) => line.trim());
  const disallowed: string[] = [];
  let matchesGroup = false;
  let sawAnyUserAgentLine = false;

  for (const rawLine of lines) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      if (sawAnyUserAgentLine && matchesGroup) {
        // já coletamos o grupo relevante; um novo bloco de user-agent encerra o grupo anterior.
      }
      sawAnyUserAgentLine = true;
      matchesGroup = value === "*" || value.toLowerCase() === userAgent.toLowerCase();
      continue;
    }
    if (key === "disallow" && matchesGroup && value) {
      disallowed.push(value);
    }
  }
  return disallowed;
}

export function isPathAllowed(path: string, rules: RobotsRules): boolean {
  return !rules.disallowedPaths.some((disallowed) => path.startsWith(disallowed));
}
