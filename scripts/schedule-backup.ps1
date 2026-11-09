<#
Legt die Aufgaben der Windows-Aufgabenplanung für die Sicherung an (Pilotbetrieb, Teil W4).
ERST ANZEIGEN, DANN ÄNDERN: ohne -Execute zeigt das Skript nur, was es anlegen würde; vorhandene Aufgaben bleiben unberührt.

  powershell -File scripts\schedule-backup.ps1                  zeigt die Aufgaben
  powershell -File scripts\schedule-backup.ps1 -Execute         legt an: täglich 02:30 Sicherung, sonntags 03:30 Wiederherstellungsprüfung
  powershell -File scripts\schedule-backup.ps1 -Remove -Execute entfernt die beiden Aufgaben wieder

Voraussetzungen: Git Bash (bash.exe) und Docker Desktop laufen zur Ausführungszeit; die Aufgaben laufen im Benutzerkonto, das angemeldet ist. Ein ausgeschalteter oder schlafender Rechner sichert nicht –
darum prüft die wöchentliche Prüfung das Alter der jüngsten Sicherung. Es wird keine kostenpflichtige Infrastruktur angelegt.
#>
param([switch]$Execute, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$bash = (Get-Command bash.exe -ErrorAction SilentlyContinue).Source
if (-not $bash) { $bash = 'C:\Program Files\Git\bin\bash.exe' }
$tasks = @(
  @{ Name = 'ORBIT-Sicherung-Taeglich'; Script = 'scripts/backup-run.sh --execute'; Trigger = { New-ScheduledTaskTrigger -Daily -At 02:30 }; Text = 'täglich 02:30: Datenbank + Dokumente sichern' },
  @{ Name = 'ORBIT-Wiederherstellungspruefung-Woechentlich'; Script = 'scripts/backup-restore-check.sh'; Trigger = { New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 03:30 }; Text = 'sonntags 03:30: Wiederherstellung in Wegwerf-Datenbank prüfen, Alter der Sicherung prüfen' }
)
foreach ($t in $tasks) {
  $exists = [bool](Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue)
  Write-Output ("{0}: {1} (Befehl: bash -lc 'cd {2} && {3}') - bereits vorhanden: {4}" -f $t.Name, $t.Text, $root, $t.Script, $exists)
  if (-not $Execute) { continue }
  if ($Remove) {
    if ($exists) { Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false; Write-Output "  entfernt." }
    continue
  }
  if ($exists) { Write-Output '  unverändert (existiert bereits).'; continue }
  $action = New-ScheduledTaskAction -Execute $bash -Argument ("-lc `"cd '{0}' && {1}`"" -f ($root -replace '\\', '/'), $t.Script) -WorkingDirectory $root
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger (& $t.Trigger) -Settings $settings -Description 'ORBIT Pilotbetrieb: Sicherung (siehe docs/PILOT_BETRIEB_RUNBOOK.md)' | Out-Null
  Write-Output '  angelegt.'
}
if (-not $Execute) { Write-Output 'Nur angezeigt. Zum Anlegen -Execute angeben.' }
