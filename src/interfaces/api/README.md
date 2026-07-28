# API

Fundação da API HTTP do Zuno (Sprint 02, Fase 2) — estrutura pronta para crescer, sem nenhum endpoint de negócio ainda.

## O que existe hoje

- `app.ts` — monta a aplicação Fastify (sem escutar porta), testável via `app.inject(...)`.
- `server.ts` — único ponto que efetivamente escuta uma porta (`npm run zuno:api`).
- `config/api-config.ts` — leitura de variáveis de ambiente (`API_PORT`, `API_HOST`, mais `JWT_SECRET`/`DATABASE_URL` preparados para sprints futuras, não usados ainda).
- `http/` — `AppError` (e subclasses: `NotFoundError`, `ValidationError`, `UnauthorizedError`, `NotImplementedError`), tratamento global de erro, envelope padrão de resposta (`{ok, data}` / `{ok, error}`).
- `middleware/` — contexto por requisição (`request.zunoContext`) e middleware de autenticação **preparado, nunca aplicado** (ver `src/application/ports/auth.port.ts`).
- `di/container.ts` + `plugins/di.plugin.ts` — raiz de composição, hoje só provendo `AuthPort`.
- `routes/v1/` — versionamento por prefixo (`/v1`); só `health.route.ts` existe.

## O que NÃO existe ainda (de propósito)

Login, banco de dados, billing, publicação, geração de conteúdo, qualquer endpoint que exija autenticação real. `AuthPort` está conectado a um `NoopAuthAdapter` que nunca autentica ninguém — nenhuma rota bloqueia por falta de token.

## Rodando localmente

```
npm run zuno:api
```

Sobe em `http://localhost:3000` (ou `API_PORT`/`API_HOST`, se definidos). `GET /health` e `GET /v1/health` respondem `{"ok":true,"data":{"status":"ok"}}`.
