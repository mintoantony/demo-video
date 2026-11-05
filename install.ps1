# Installs the demo-video agent and skill for Claude Code (user level).
# Run from this folder:  powershell -ExecutionPolicy Bypass -File .\install.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$claude = Join-Path $env:USERPROFILE '.claude'
$src = Join-Path $here 'tools\claude'

if (-not (Test-Path $src)) { throw "tools\claude not found. Run: node make_tool_copies.mjs" }

$agents = Join-Path $claude 'agents'
New-Item -ItemType Directory -Force $agents | Out-Null
Copy-Item (Join-Path $src 'agents\*') $agents -Force
Write-Host "Agent copied to $agents"

$skill = Join-Path $claude 'skills\demo-video'
New-Item -ItemType Directory -Force $skill | Out-Null
Copy-Item (Join-Path $src 'skills\demo-video\*') $skill -Recurse -Force
Write-Host "Skill copied to $skill"

Push-Location $skill
try {
  npm install
  npx playwright install chromium
} finally { Pop-Location }
Write-Host 'Done. Restart Claude Code, then type /demo-video.'
