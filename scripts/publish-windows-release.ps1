[CmdletBinding()]
param(
  [string]$Repository = $env:GITHUB_REPOSITORY,
  [string]$Commit = $env:GITHUB_SHA
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if ($Repository -ne 'Le672/yukino-rail-watch' -or $Commit -notmatch '^[a-f0-9]{40}$') {
  throw 'Release repository or build commit is invalid.'
}
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskPackage = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
$taskBuilder = Get-Content -LiteralPath 'electron-builder.json' -Raw | ConvertFrom-Json
$taskVersion = [string]$taskPackage.version
if ($taskVersion -notmatch '^\d+\.\d+\.\d+$' -or $taskBuilder.extraMetadata.version -ne $taskVersion) {
  throw 'Package and Windows builder must share a stable version.'
}
$taskTag = 'v' + $taskVersion
$taskExe = Get-Item -LiteralPath (Join-Path $taskRoot "release/Yukino-Rail-Watch-$taskVersion-portable.exe")
$taskStream = [System.IO.File]::OpenRead($taskExe.FullName)
try {
  if ($taskExe.Length -lt 2 -or $taskStream.ReadByte() -ne 77 -or $taskStream.ReadByte() -ne 90) {
    throw 'The Windows release asset is not a valid executable.'
  }
} finally { $taskStream.Dispose() }

$taskExistingJson = gh release view $taskTag --repo $Repository --json isDraft,targetCommitish,url 2>$null
if ($LASTEXITCODE -eq 0) {
  $taskExisting = $taskExistingJson | ConvertFrom-Json
  if (-not $taskExisting.isDraft) {
    Write-Output "Published version $taskTag already exists; keeping its assets unchanged."
    return
  }
  if ($taskExisting.targetCommitish -ne $Commit) {
    throw 'An existing draft belongs to a different build commit; it was left unchanged.'
  }
} else {
  $taskCreateArguments = @('release', 'create', $taskTag, '--repo', $Repository, '--draft', '--target', $Commit, '--title', "Yukino Rail Watch $taskTag")
  $taskNotes = Join-Path $taskRoot "docs/releases/$taskVersion.md"
  if (Test-Path -LiteralPath $taskNotes) { $taskCreateArguments += @('--notes-file', $taskNotes) }
  else { $taskCreateArguments += '--generate-notes' }
  gh @taskCreateArguments
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the release draft.' }
}

$taskChecksumPath = Join-Path $taskRoot 'release/SHA256SUMS.txt'
$taskHash = (Get-FileHash -LiteralPath $taskExe.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText($taskChecksumPath, "$taskHash  $($taskExe.Name)`n", [System.Text.UTF8Encoding]::new($false))
gh release upload $taskTag $taskExe.FullName $taskChecksumPath --repo $Repository --clobber
if ($LASTEXITCODE -ne 0) { throw 'Asset upload failed; the release remains a draft.' }
$taskAssetJson = gh release view $taskTag --repo $Repository --json assets
if ($LASTEXITCODE -ne 0) { throw 'Could not verify uploaded assets; the release remains a draft.' }
$taskAssets = ($taskAssetJson | ConvertFrom-Json).assets
foreach ($taskFile in @($taskExe, (Get-Item -LiteralPath $taskChecksumPath))) {
  $taskMatches = @($taskAssets | Where-Object { $_.name -eq $taskFile.Name -and $_.size -eq $taskFile.Length })
  if ($taskMatches.Count -ne 1) { throw "Release asset verification failed: $($taskFile.Name)" }
}
gh release edit $taskTag --repo $Repository --draft=false --latest
if ($LASTEXITCODE -ne 0) { throw 'Could not publish the verified release draft.' }
gh release view $taskTag --repo $Repository --json url --jq .url
if ($LASTEXITCODE -ne 0) { throw 'The release was published but its URL could not be read.' }