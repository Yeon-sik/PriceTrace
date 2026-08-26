$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$packRoot = Join-Path $repositoryRoot "chatgpt-project-sources"
$zipPath = Join-Path $repositoryRoot "chatgpt-receipt-project-sources.zip"

$copies = @(
  @{ Source = "src/domain/receipt.ts"; Destination = "receipt-contract/receipt.ts" },
  @{ Source = "docs/templates/RECEIPT_V2_TEMPLATE.json"; Destination = "receipt-contract/RECEIPT_V2_TEMPLATE.json" },
  @{ Source = "docs/templates/RECEIPT_IMAGE_ANALYSIS_PROMPT.md"; Destination = "receipt-contract/RECEIPT_IMAGE_ANALYSIS_PROMPT.md" },
  @{ Source = "scripts/validate-private-receipts.ts"; Destination = "validation/validate-private-receipts.ts" },
  @{ Source = "scripts/private-receipt-source.ts"; Destination = "validation/private-receipt-source.ts" },
  @{ Source = "data/public/receipts/index.v1.json"; Destination = "reference/existing-public-receipt-index.v1.json" },
  @{ Source = "supabase/CHATGPT_PROJECT_SOURCE_SYNC.md"; Destination = "supabase/CHATGPT_PROJECT_SOURCE_SYNC.md" }
)

foreach ($copy in $copies) {
  $sourcePath = Join-Path $repositoryRoot $copy.Source
  $destinationPath = Join-Path $packRoot $copy.Destination
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "ChatGPT 프로젝트 패키지 원본 파일을 찾을 수 없습니다: $($copy.Source)"
  }
  $destinationDirectory = Split-Path -Parent $destinationPath
  New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

Compress-Archive -Path (Join-Path $packRoot "*") -DestinationPath $zipPath -Force
Write-Output "ChatGPT receipt project source ZIP created: $zipPath"
