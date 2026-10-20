$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$link = Join-Path $desktop "GPT Image Studio.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = Join-Path $root "start.bat"
$shortcut.WorkingDirectory = $root
$shortcut.Description = "本地 GPT 图片生成工作台"
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,167"
$shortcut.Save()

Write-Host "已创建桌面快捷方式: $link"
Write-Host "之后双击桌面图标即可启动。"
