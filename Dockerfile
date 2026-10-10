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
RUN apt-get update \
  && apt-get install -y --no-install-recommends fontconfig \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/db ./db
RUN mkdir -p /usr/local/share/fonts/vorix /etc/fonts/conf.d \
  && cp ./dist/infrastructure/rendering/assets/geist-regular.ttf /usr/local/share/fonts/vorix/GeistEditorial-Regular.ttf \
  && cp ./dist/infrastructure/rendering/assets/dm-serif-display-regular.ttf /usr/local/share/fonts/vorix/DMSerifDisplay-Regular.ttf \
  && printf '%s\n' \
    '<?xml version="1.0"?>' \
    '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">' \
    '<fontconfig>' \
    '  <dir>/usr/local/share/fonts/vorix</dir>' \
    '  <alias>' \
    '    <family>GeistEditorial</family>' \
    '    <prefer><family>Geist</family></prefer>' \
    '  </alias>' \
    '</fontconfig>' \
    > /etc/fonts/conf.d/60-vorix-geist-editorial.conf \
  && fc-cache -f /usr/local/share/fonts/vorix \
  && fc-match GeistEditorial | grep -i 'GeistEditorial-Regular.ttf' \
  && fc-match "DM Serif Display" | grep -i 'DMSerifDisplay-Regular.ttf'

EXPOSE 3000
CMD ["node", "dist/interfaces/api/server.js"]
