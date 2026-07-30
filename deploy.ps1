<#
    Trip Map — one-shot deploy

        .\deploy.ps1                       push whatever is already committed
        .\deploy.ps1 "fix the thing"       also commit any pending changes first

    Use this when you don't have the watcher running and just want to ship.
#>

param([string]$Message)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$dirty = git status --porcelain

if ($dirty) {
    if (-not $Message) {
        Write-Host "There are uncommitted changes:" -ForegroundColor Yellow
        git status --short
        Write-Host ""
        Write-Host "Pass a message to commit them:" -ForegroundColor Yellow
        Write-Host '    .\deploy.ps1 "what changed"' -ForegroundColor Gray
        exit 1
    }
    git add -A
    git commit -m $Message
}

$ahead = [int](git rev-list --count '@{u}..HEAD' 2>$null)
if ($ahead -eq 0) {
    Write-Host "Nothing to push — already up to date." -ForegroundColor Gray
    exit 0
}

Write-Host "Pushing $ahead commit(s)..." -ForegroundColor Cyan
git push

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Pushed. Vercel is building — live in about 30 seconds." -ForegroundColor Green
    Write-Host "https://trip-map-henna.vercel.app/" -ForegroundColor Cyan
}
