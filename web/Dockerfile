# syntax=docker/dockerfile:1
#
# Frontend do Zuno (Next.js, App Router) — build "standalone" (ver next.config.mjs), imagem de
# runtime bem mais leve que copiar node_modules inteiro. `NEXT_PUBLIC_API_URL` precisa existir no
# momento do BUILD (Next.js embute variáveis `NEXT_PUBLIC_*` no bundle do client em build time,
# não em runtime) — por isso é um build-arg, não uma env var só do container final.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Sem web/public ainda (nenhum arquivo estático hoje) — quando existir, adicionar:
#   COPY --from=build /app/public ./public

EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
