import { completeSocialConnection, SOCIAL_OAUTH_FLOW_KEY } from "./api";
import { SOCIAL_NETWORKS, type SocialNetwork } from "./types";

/** Lê e consome a marca de "este retorno de OAuth é do fluxo social" (uma vez só). */
export function takeSocialOAuthFlow(): SocialNetwork | undefined {
  if (typeof window === "undefined") return undefined;
  const stored = window.sessionStorage.getItem(SOCIAL_OAUTH_FLOW_KEY);
  window.sessionStorage.removeItem(SOCIAL_OAUTH_FLOW_KEY);
  return SOCIAL_NETWORKS.find((network) => network === stored);
}

/**
 * Conclui a conexão e devolve para onde voltar. O destino vem do servidor (guardado junto do state),
 * nunca do navegador; com várias contas autorizadas, abre a escolha (`?pick=`).
 */
export async function finishSocialOAuth(network: SocialNetwork, state: string, code: string): Promise<string> {
  const result = await completeSocialConnection(network, state, code);
  const base = result.returnPath ?? `/workspaces/${result.workspaceId}/social/integrations`;
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${result.autoConnected ? "connected" : "pick"}=${result.network}`;
}
