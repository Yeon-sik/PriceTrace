param([Parameter(Mandatory = $true)][string]$SupabaseCli, [switch]$Apply)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$deploymentPath = Join-Path $env:TEMP ('pt-owner-purchase-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $deploymentPath 'supabase/migrations') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot 'supabase/config.toml') -Destination (Join-Path $deploymentPath 'supabase/config.toml')

# Fetch real history/SQL; never fabricate baseline rows or run migration repair.
& $SupabaseCli migration fetch --linked --project-ref bpyvvcmdvgpwjrprkmtq --workdir $deploymentPath --yes
if ($LASTEXITCODE -ne 0) { throw 'Remote migration history fetch failed.' }
foreach ($migrationFile in @('20261004131440_restaurant_menu_identity_candidates.sql', '20261013095911_user_confirmed_purchase_restaurants.sql')) {
    $sourcePath = Join-Path $repoRoot ('supabase/migrations/' + $migrationFile)
    $targetPath = Join-Path $deploymentPath ('supabase/migrations/' + $migrationFile)
    if (Test-Path -LiteralPath $targetPath) { Write-Output ('Already recorded: ' + $migrationFile); continue }
    Copy-Item -LiteralPath $sourcePath -Destination $targetPath
    if ((Get-FileHash -LiteralPath $sourcePath).Hash -ne (Get-FileHash -LiteralPath $targetPath).Hash) { throw 'Deployment copy mismatch.' }
}
$pushArguments = @('db', 'push', '--linked', '--project-ref', 'bpyvvcmdvgpwjrprkmtq', '--workdir', $deploymentPath, '--include-all', '--skip-vault')
if ($Apply) { $pushArguments += '--yes' } else { $pushArguments += '--dry-run' }
& $SupabaseCli @pushArguments
if ($LASTEXITCODE -ne 0) { throw 'Migration push/dry-run failed.' }
