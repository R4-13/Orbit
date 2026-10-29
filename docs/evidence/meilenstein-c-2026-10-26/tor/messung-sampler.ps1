param([string]$Out, [int]$Seconds = 15)
"zeit;cpu_pct;frei_mb;pagefile_mb;pagefile_pct;jest_ws_mb;jest_priv_mb;disk_queue;vmmem_priv_mb;pg_orbit_cpu;pg_scribenio_cpu;top3" | Out-File $Out -Encoding utf8
while ($true) {
  try {
    $v = @{}
    $v['% processor time'] = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
    $v['% usage'] = (Get-CimInstance Win32_PerfFormattedData_PerfOS_PagingFile -Filter "Name='_Total'").PercentUsage
    $v['avg. disk queue length'] = (Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'").CurrentDiskQueueLength
    $os = Get-CimInstance Win32_OperatingSystem
    $pf = Get-CimInstance Win32_PageFileUsage
    $j = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*jest.js*' } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
    $ws = 0; $pv = 0; foreach ($p in $j) { $ws += $p.WorkingSet64 / 1MB; $pv += $p.PrivateMemorySize64 / 1MB }
    $vm = (Get-Process vmmemWSL -ErrorAction SilentlyContinue | Select-Object -First 1).PrivateMemorySize64 / 1MB
    $st = docker stats --no-stream --format "{{.Name}}={{.CPUPerc}}" orbit-postgres scribenio-postgres-1 2>$null
    $po = ($st | Where-Object { $_ -like 'orbit-postgres=*' }) -replace '.*=', ''
    $ps = ($st | Where-Object { $_ -like 'scribenio-postgres-1=*' }) -replace '.*=', ''
    $top = (Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.Name -ne "_Total" -and $_.Name -ne "Idle" -and $_.Name -notlike "powershell*" -and $_.Name -notlike "WmiPrvSE*" } | Sort-Object PercentProcessorTime -Descending | Select-Object -First 3 | ForEach-Object { ($_.Name -replace "#d+$","") + "=" + $_.PercentProcessorTime }) -join ","
    "{0};{1};{2};{3};{4};{5};{6};{7};{8};{9};{10};{11}" -f (Get-Date -Format 'HH:mm:ss'), $v['% processor time'], [int]($os.FreePhysicalMemory / 1024), $pf.CurrentUsage, $v['% usage'], [int]$ws, [int]$pv, $v['avg. disk queue length'], [int]$vm, $po, $ps, $top | Out-File $Out -Append -Encoding utf8
  } catch { "fehler;$($_.Exception.Message)" | Out-File $Out -Append -Encoding utf8 }
  Start-Sleep -Seconds $Seconds
}
