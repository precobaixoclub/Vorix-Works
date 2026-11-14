# Instala o túnel do Vorix para iniciar sozinho quando você entra no Windows (sem janela).
# Remover: Unregister-ScheduledTask -TaskName "Vorix - tunel redes sociais" -Confirm:$false
$dir = "$env:LOCALAPPDATA\VorixTunel"
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot "vorix-tunel.ps1") "$dir\vorix-tunel.ps1"
# conhost --headless: sem janela nenhuma. Com "-WindowStyle Hidden" o Windows 11 abre uma aba vazia
# no Terminal, e fechar essa aba derrubava o túnel.
$action = New-ScheduledTaskAction -Execute "conhost.exe" -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$dir\vorix-tunel.ps1`""
# Liga ao entrar no Windows e confere a cada 5 minutos: se tiver parado, liga de novo (se estiver rodando, nada muda).
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$watch = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$trigger = @($logon, $watch)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Vorix - tunel redes sociais" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "Vorix - tunel redes sociais"
"Túnel instalado e iniciado. Log: $dir\tunel.log"
