import { NextRequest, NextResponse } from "next/server";

/**
 * Portão de navegação (Sprint 05) — verifica só a PRESENÇA do cookie HttpOnly do refresh token
 * (`zuno_refresh_token`, definido pela API em `POST /v1/auth/login`). Isto NÃO é a fronteira de
 * segurança real — o proxy não valida o token, só evita que quem nunca fez login veja telas que
 * vão falhar em seguida; a validação de verdade acontece na API a cada requisição (JWT). Cookies
 * HttpOnly são invisíveis para JavaScript no navegador, mas continuam legíveis aqui porque o
 * proxy roda no servidor/edge, nunca no cliente.
 */
const REFRESH_COOKIE_NAME = "zuno_refresh_token";

export function proxy(request: NextRequest) {
  const hasRefreshCookie = request.cookies.has(REFRESH_COOKIE_NAME);
  const { pathname } = request.nextUrl;

  // "/" é a landing page pública (marketing) — nunca exige sessão.
  if (pathname === "/") return NextResponse.next();

  if (pathname === "/login") {
    if (hasRefreshCookie) return NextResponse.redirect(new URL("/workspaces", request.url));
    return NextResponse.next();
  }

  if (!hasRefreshCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
