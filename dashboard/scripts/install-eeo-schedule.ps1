param([switch]$Inspect, [string]$ScriptHome = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $ScriptHome '..'))
$taskName = 'EEO-Teaching-Risk-Weekly'
if ($Inspect) {
    Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State, Actions, Triggers, Settings
    Get-ScheduledTaskInfo -TaskName $taskName | Select-Object LastRunTime, LastTaskResult, NextRunTime
    exit
}
if ((Get-TimeZone).Id -ne 'China Standard Time') { throw '请确认Windows时区为北京时间；本脚本不会修改系统时区。' }
$nodePath = (Get-Command node.exe).Source
$collectorScript = Join-Path $projectRoot 'scripts\run-eeo-weekly.mjs'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and ($existing.Actions.Arguments -notlike '*scripts\run-eeo-weekly.mjs*' -or $existing.Actions.WorkingDirectory -ne $projectRoot)) { throw '同名任务不属于本项目，拒绝覆盖。' }
$action = New-ScheduledTaskAction -Execute $nodePath -Argument "--max-old-space-size=192 --experimental-strip-types `"$collectorScript`"" -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At '10:00'
# Interactive token reuses this user's profile without requesting or saving a password.
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description '本电脑每周采集EEOS客户汇总，校验后同步线上；登录失效或内存不足时保留旧数据。' -Force | Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskName $taskName | Select-Object NextRunTime
