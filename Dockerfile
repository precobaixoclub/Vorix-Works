# syntax=docker/dockerfile:1
#
# API do Zuno (Fastify/Node, src/interfaces/api) — imagem de produção. `node:20-slim` (Debian,
# glibc) em vez de `-alpine` de propósito: o pacote `ffmpeg-static` (usado pelo pipeline legado de
# vídeo, não pela plataforma nova, mas presente no mesmo package.json) baixa um binário prebuilt
# que espera glibc — evita incompatibilidade com musl sem precisar separar os dois pacotes agora.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY db ./db
RUN npm run build

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/db ./db

EXPOSE 3000
CMD ["node", "dist/interfaces/api/server.js"]
