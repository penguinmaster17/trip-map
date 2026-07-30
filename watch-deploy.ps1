<#
    Trip Map — deploy watcher

    Leave this running in a PowerShell window. It watches for commits that
    haven't been pushed yet and pushes them, which triggers a Vercel deploy.

        .\watch-deploy.ps1

    Why this exists: Claude can edit files and commit them, but it runs in an
    isolated Linux sandbox with no access to your GitHub credentials — those live
    in Windows Credential Manager. This script runs on your machine, where the
    credentials already are, so the two halves meet in the middle.

    It only pushes commits that already exist. It never commits for you, so
    half-finished edits sitting in the folder can't get shipped by accident.

    Ctrl+C to stop.
#>

param(
    [int]$IntervalSeconds = 15,
    [switch]$Once
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Write-Stamp($Message, $Color = 'Gray') {
    Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message) -ForegroundColor $Color
}

# --- checks before we start looping ---

if (-not (Test-Path '.git')) {
    Write-Host "No git repository here. Run this from the project folder." -ForegroundColor Red
    exit 1
}

$upstream = git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
if (-not $upstream) {
    Write-Host "This branch has no upstream. Run once:" -ForegroundColor Red
    Write-Host "    git push -u origin main" -ForegroundColor Yellow
    exit 1
}

$remote = git config --get remote.origin.url
Write-Host ""
Write-Host "Watching for commits to push" -ForegroundColor Cyan
Write-Host "  repo     $remote"
Write-Host "  tracking $upstream"
Write-Host "  every    $IntervalSeconds seconds"
Write-Host "  Ctrl+C to stop"
Write-Host ""

# --- the loop ---

while ($true) {
    try {
        $ahead = [int](git rev-list --count '@{u}..HEAD' 2>$null)

        if ($ahead -gt 0) {
            $subjects = git log '@{u}..HEAD' --pretty=format:'%s'
            $word = if ($ahead -eq 1) { 'commit' } else { 'commits' }
            Write-Stamp "$ahead $word to push:" 'White'
            foreach ($s in $subjects) { Write-Host "           - $s" -ForegroundColor DarkGray }

            $output = git push 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Stamp "pushed — Vercel is building" 'Green'
            }
            else {
                Write-Stamp "push failed:" 'Red'
                $output | ForEach-Object { Write-Host "           $_" -ForegroundColor DarkRed }
                # Most likely cause is the remote having commits we don't.
                if ($output -match 'rejected|non-fast-forward|fetch first') {
                    Write-Stamp "the remote is ahead — run: git pull --rebase" 'Yellow'
                }
            }
        }
    }
    catch {
        Write-Stamp "watcher error: $($_.Exception.Message)" 'Red'
    }

    if ($Once) { break }
    Start-Sleep -Seconds $IntervalSeconds
}
