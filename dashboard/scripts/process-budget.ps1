param([int]$RootPid)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$os=Get-CimInstance Win32_OperatingSystem
$all=@(Get-CimInstance Win32_Process)
$ids=[System.Collections.Generic.HashSet[int]]::new()
if($RootPid -gt 0){ [void]$ids.Add($RootPid) }
for($i=0;$i -lt 12;$i++){ $before=$ids.Count; foreach($item in $all){if($ids.Contains([int]$item.ParentProcessId)){[void]$ids.Add([int]$item.ProcessId)}};if($ids.Count -eq $before){break} }
$rows=@($all | Where-Object {$ids.Contains([int]$_.ProcessId)} | ForEach-Object {
  [pscustomobject]@{pid=$_.ProcessId;command=$_.CommandLine;privateMB=[math]::Round([double]$_.PrivatePageCount/1MB,1)}
})
[pscustomobject]@{freeMB=[math]::Round($os.FreePhysicalMemory/1024,1);totalMB=[math]::Round(($rows.privateMB|Measure-Object -Sum).Sum,1);processes=$rows}|ConvertTo-Json -Depth 4 -Compress
