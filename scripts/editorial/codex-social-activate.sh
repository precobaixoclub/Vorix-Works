#!/usr/bin/env bash
set -euo pipefail

directory=/opt/vorix-editorial
agent_home=/var/lib/vorix-codex
timer=codex-social.timer
legacy_path=/opt/zuno/autopilot/autopilot-all.mjs
agent=(runuser -u vorix-codex -- env -i PATH=/usr/local/bin:/usr/bin:/bin "HOME=$agent_home" "CODEX_HOME=$agent_home/.codex" "$directory/tools/node_modules/.bin/codex")

if systemctl is-active --quiet "$timer"; then
  printf '%s\n' 'Automação editorial já ativa.'
  exit 0
fi

expires=$((SECONDS + 900))
until "${agent[@]}" login status >/dev/null 2>&1; do
  if (( SECONDS >= expires )); then
    printf '%s\n' 'A autorização do Codex ainda está pendente; a rotina anterior permanece ativa.' >&2
    exit 1
  fi
  sleep 10
done

probe_dir=$(mktemp -d "$agent_home/jobs/ativacao-XXXXXX")
chown vorix-codex:vorix-codex "$probe_dir"
trap 'rm -f "$probe_dir/resultado"; rmdir "$probe_dir" 2>/dev/null || true' EXIT
printf '%s\n' 'Teste de disponibilidade. Use a ferramenta nativa de geração de imagens para criar uma base abstrata em retrato 4:5 com formas geométricas sobre azul-marinho, sem texto. Não use comandos. Responda somente com o caminho absoluto da imagem que a ferramenta salvou.' |
  timeout 300 "${agent[@]}" -a never exec --model gpt-6.2-sol --ephemeral --sandbox read-only --skip-git-repo-check --cd "$probe_dir" --json --output-last-message "$probe_dir/resultado" - >/dev/null
image=$(tr -d '\r\n' < "$probe_dir/resultado")
image=$(realpath -- "$image")
case "$image" in
  "$agent_home"/.codex/generated_images/*) test -s "$image" ;;
  *) printf '%s\n' 'O Codex não devolveu uma base visual válida.' >&2; exit 1 ;;
esac

umask 077
backup=$(mktemp "$directory/crontab-anterior-XXXXXX")
crontab -l > "$backup"
test "$(grep -Fc -- "$legacy_path" "$backup")" -eq 1
grep -Fv -- "$legacy_path" "$backup" | crontab -
if ! systemctl enable --now "$timer" || ! systemctl is-active --quiet "$timer"; then
  systemctl disable --now "$timer" || true
  crontab "$backup"
  exit 1
fi
systemctl list-timers --all "$timer" --no-pager
