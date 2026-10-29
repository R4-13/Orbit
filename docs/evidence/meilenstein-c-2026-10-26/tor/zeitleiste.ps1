param($Log, $Csv, $Start)
$t = [datetime]::ParseExact($Start,'HH:mm:ss',$null)
$rows = Import-Csv $Csv -Delimiter ';' | Where-Object { $_.cpu_pct -match '^\d' } | ForEach-Object { [pscustomobject]@{ t=[datetime]::ParseExact($_.zeit,'HH:mm:ss',$null); cpu=[double]$_.cpu_pct; frei=[int]$_.frei_mb; spg=[double](($_.pg_scribenio_cpu -replace '%','') -replace ',','.'); jest=[int]$_.jest_priv_mb } }
$cur = $t
Get-Content $Log | Where-Object { $_ -match '^(PASS|FAIL) test/.*\((\d+(\.\d+)?) s\)' } | ForEach-Object {
  $null = $_ -match '^(PASS|FAIL) (\S+) \((\d+(\.\d+)?) s\)'
  $dur = [double]$Matches[3]; $st = $cur; $cur = $cur.AddSeconds($dur)
  $w = $rows | Where-Object { $_.t -ge $st -and $_.t -le $cur }
  if ($w) { "{0} {1,-48} {2:HH:mm}-{3:HH:mm} {4,6}s | CPU Ø{5,5:N0} | Anteil>=95%: {6,3:N0}% | frei Ø{7,5:N0} MB | ScribenioPG Ø{8,5:N0}%" -f $Matches[1], $Matches[2], $st, $cur, $dur, ($w | Measure-Object cpu -Average).Average, (100*@($w | Where-Object { $_.cpu -ge 95 }).Count/$w.Count), ($w | Measure-Object frei -Average).Average, ($w | Measure-Object spg -Average).Average }
}
