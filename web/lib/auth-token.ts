/**
 * O access token vive só na memória do processo do navegador — NUNCA em localStorage/sessionStorage
 * (acessível a qualquer script, inclusive um XSS) nem em cookie legível por JS. Some sozinho a
 * cada reload de página; é isso que faz o refresh silencioso no boot do `AuthProvider`
 * (`contexts/auth-context.tsx`) necessário — o cookie HttpOnly do refresh token é quem sustenta a
 * sessão entre reloads, nunca este valor.
 */
let currentAccessToken: string | undefined;

export function setAccessToken(token: string | undefined): void {
  currentAccessToken = token;
}

export function getAccessToken(): string | undefined {
  return currentAccessToken;
}
