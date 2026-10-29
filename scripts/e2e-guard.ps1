# Zählt laufende E2E-Jest-Prozesse (Windows). Aufruf aus scripts/e2e-isolated.sh: keine parallelen oder liegengebliebenen Testläufe.
$n = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*jest-e2e.json*' }).Count
Write-Output $n
