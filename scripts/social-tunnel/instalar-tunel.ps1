# Instala o túnel do Vorix para iniciar sozinho quando você entra no Windows (sem janela).
# Remover: Unregister-ScheduledTask -TaskName "Vorix - tunel redes sociais" -Confirm:$false
$dir = "$env:LOCALAPPDATA\VorixTunel"
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot "vorix-tunel.ps1") "$dir\vorix-tunel.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dir\vorix-tunel.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Vorix - tunel redes sociais" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "Vorix - tunel redes sociais"
"Túnel instalado e iniciado. Log: $dir\tunel.log"
