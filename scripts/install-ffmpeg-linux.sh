#!/bin/sh
# Instala o FFmpeg oficial do runtime Linux do Vorix num caminho FIXO (/opt/vorix/ffmpeg/ffmpeg).
#
# Por quê: o binário Linux do pacote `ffmpeg-static` (build johnvansickle 7.0.2) não tem o filtro
# `drawtext` — desde o FFmpeg 6.1 ele exige libharfbuzz, ausente nessa build. O renderizador de vídeo
# (`timeline-to-filter-compiler.ts`) usa `drawtext` com `text_align`, então no Linux todo vídeo com
# texto falhava ("No such filter: 'drawtext'"); no Windows a build do pacote tem o filtro.
# `resolveFfmpegBinaryPath` prefere este caminho fixo quando existe (nunca um caminho vindo de
# variável de ambiente).
#
# Build: jellyfin-ffmpeg 7.0.2-9 portable (estática, GPL; só depende da glibc), versão FIXA e
# sha256 conferido — nunca "latest".
#
# Uso: sh scripts/install-ffmpeg-linux.sh [diretório-destino]   (padrão /opt/vorix/ffmpeg)
set -eu
DEST="${1:-/opt/vorix/ffmpeg}"
URL="https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/v7.0.2-9/jellyfin-ffmpeg_7.0.2-9_portable_linux64-gpl.tar.xz"
SHA256="dbdaa68b7e7e6639b8396e767bdf1c0fb4ed220e916bbd7b5beaacc8413ff4a9"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL --retry 3 -o "$TMP/ffmpeg.tar.xz" "$URL"
echo "$SHA256  $TMP/ffmpeg.tar.xz" | sha256sum -c -
tar -xJf "$TMP/ffmpeg.tar.xz" -C "$TMP" ffmpeg
mkdir -p "$DEST"
install -m 0755 "$TMP/ffmpeg" "$DEST/ffmpeg"

# Contrato do renderizador: drawtext com text_align e textfile.
"$DEST/ffmpeg" -hide_banner -filters 2>/dev/null | grep -q " drawtext " || { echo "FFmpeg instalado sem drawtext" >&2; exit 1; }
"$DEST/ffmpeg" -hide_banner -h filter=drawtext 2>/dev/null | grep -q "text_align" || { echo "FFmpeg instalado sem drawtext text_align" >&2; exit 1; }
echo "FFmpeg instalado em $DEST/ffmpeg: $("$DEST/ffmpeg" -hide_banner -version | head -1)"
