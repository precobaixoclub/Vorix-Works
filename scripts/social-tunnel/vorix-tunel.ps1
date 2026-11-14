# Vorix — túnel das redes sociais (roda no PC do dono, escondido, enquanto o Windows estiver ligado).
# O servidor do Vorix passa o login e as publicações do Instagram/Facebook por esta conexão, então
# a Meta vê a sua internet de casa no Brasil. Se cair, reconecta sozinho em 15 segundos.
param([string]$Server = "root@62.83.93.42")
$ssh = "$env:WINDIR\System32\OpenSSH\ssh.exe"
$key = "$env:USERPROFILE\.ssh\vorix_social_tunnel_ed25519"
$log = "$env:LOCALAPPDATA\VorixTunel\tunel.log"
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
while ($true) {
  Add-Content $log "$(Get-Date -Format s) conectando"
  & $ssh -N -T -i $key -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=accept-new -R 172.20.0.1:1080 $Server 2>> $log
  Add-Content $log "$(Get-Date -Format s) caiu (código $LASTEXITCODE), tentando de novo em 15 s"
  Start-Sleep -Seconds 15
}
