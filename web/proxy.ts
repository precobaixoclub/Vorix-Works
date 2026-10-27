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
  const hostname=(request.headers.get("host")??"").split(":")[0].toLowerCase();
  const siteBase=process.env.SITE_PUBLIC_BASE_DOMAIN?.toLowerCase();
  const appHostname=process.env.SITE_APP_HOST?.toLowerCase();
  const isSiteSubdomain=siteBase&&hostname.endsWith(`.${siteBase}`)&&hostname.slice(0,-siteBase.length-1).indexOf(".")===-1;
  const isCustomSite=process.env.SITE_CUSTOM_DOMAIN_ROUTING==="true"&&appHostname&&hostname!==appHostname&&!/^(localhost|127\.)/.test(hostname);
  if((isSiteSubdomain||isCustomSite)&&!pathname.startsWith("/_next/")&&!pathname.startsWith("/api/")&&!pathname.startsWith("/site-domain/")){
    const url=request.nextUrl.clone();url.pathname=`/site-domain/${encodeURIComponent(hostname)}${pathname==="/"?"":pathname}`;return NextResponse.rewrite(url);
  }

  // Unificação dos produtos: resolve aliases antes de renderizar os layouts autenticados.
  const legacyWorkspace = pathname.match(/^\/workspaces\/([^/]+)\/commerce\/?$/);
  if (pathname === "/admin/site-commerce" || legacyWorkspace) {
    const url = request.nextUrl.clone();
    url.pathname = legacyWorkspace ? `/workspaces/${legacyWorkspace[1]}/site` : "/admin/site";
    return NextResponse.redirect(url);
  }

  // "/" é a landing page pública (marketing) — nunca exige sessão.
  if (pathname === "/") return NextResponse.next();

  if (pathname === "/login") {
    if (hasRefreshCookie) return NextResponse.redirect(new URL("/workspaces", request.url));
    return NextResponse.next();
  }

  // "/signup" é público. Se já logado, mandar direto para workspaces em vez de mostrar cadastro.
  if (pathname === "/signup") {
    if (hasRefreshCookie) return NextResponse.redirect(new URL("/workspaces", request.url));
    return NextResponse.next();
  }

  // Páginas públicas exigidas por plataformas externas (Meta/TikTok/YouTube) e por visitantes.
  if (
    pathname.startsWith("/p/") ||
    pathname.startsWith("/s/") ||
    // Vorix Commerce: redirecionamento da intenção de venda para o WhatsApp (a referência é o acesso).
    pathname.startsWith("/i/") ||
    pathname.startsWith("/modelos/") ||
    pathname.startsWith("/site-domain/") ||
    pathname.startsWith("/api/tenant-site/") ||
    // Link compartilhado de reunião do Vorix Meetings (o token é a autorização).
    pathname.startsWith("/r/") ||
    pathname.startsWith("/product-shots/") ||
    pathname === "/empresa" ||
    pathname === "/pricing" ||
    pathname === "/precos" ||
    pathname === "/produtos/conversas" ||
    pathname === "/produtos/meetings" ||
    pathname === "/produtos/site" ||
    pathname === "/public-og" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/data-deletion" ||
    pathname === "/opengraph-image" ||
    pathname === "/opengraph-image.png"
  ) {
    return NextResponse.next();
  }

  if (!hasRefreshCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|site-assets/).*)"],
};
