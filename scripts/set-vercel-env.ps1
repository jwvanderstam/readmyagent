#Requires -Version 7
<#
.SYNOPSIS
  Sets the production environment variables of a readmyagent instance in Vercel and redeploys.

.DESCRIPTION
  See docs/operations.md, step 1.5. Run it in your own terminal after steps 1.2 to 1.4.
  You sign in to Vercel in the browser and type the OAuth client ID and secret when asked.
  AUTH_SECRET and CRON_SECRET are generated here. No secret is shown, logged or kept: each
  value goes to Vercel through a temporary file that is deleted right after. DATABASE_URL is
  left alone (the Neon integration owns it). Existing values of the other variables are
  overwritten.

.EXAMPLE
  pwsh -ExecutionPolicy Bypass -File scripts/set-vercel-env.ps1 `
    -Team my-team -Project readmyagent -OwnerEmail me@example.com `
    -DriveFolderId <folder-id> -FeedbackFileId <file-id> `
    -GcpProjectNumber 123456789012 `
    -ServiceAccountEmail readmyagent-drive@my-project.iam.gserviceaccount.com
#>
param(
    [Parameter(Mandatory)] [string] $Team,
    [Parameter(Mandatory)] [string] $Project,
    [Parameter(Mandatory)] [string] $OwnerEmail,
    [Parameter(Mandatory)] [string] $DriveFolderId,
    [Parameter(Mandatory)] [string] $FeedbackFileId,
    [Parameter(Mandatory)] [ValidatePattern('^\d+$')] [string] $GcpProjectNumber,
    [Parameter(Mandatory)] [ValidatePattern('^[a-z][a-z0-9-]*@[a-z][a-z0-9-]*\.iam\.gserviceaccount\.com$')]
    [string] $ServiceAccountEmail,
    [string] $PoolId = 'vercel',
    [string] $ProviderId = 'vercel',
    [string] $Timezone = 'Europe/Amsterdam'
)
$ErrorActionPreference = 'Stop'

$Cli = 'vercel@66.2.0'
$Npx = if ($IsWindows) { 'npx.cmd' } else { 'npx' }

function Invoke-Vercel([string[]]$CliArgs, [string]$StdinFile) {
    $all = @('--yes', $Cli) + $CliArgs + @('--scope', $Team)
    $params = @{ FilePath = $Npx; ArgumentList = $all; NoNewWindow = $true; Wait = $true; PassThru = $true }
    if ($StdinFile) { $params.RedirectStandardInput = $StdinFile }
    (Start-Process @params).ExitCode
}

function Set-Var([string]$Name, [string]$Value, [switch]$Sensitive) {
    if ([string]::IsNullOrWhiteSpace($Value)) { throw "Empty value for $Name" }
    $file = New-TemporaryFile
    try {
        # The exact value, without a trailing newline.
        [IO.File]::WriteAllText($file, $Value.Trim())
        $kind = if ($Sensitive) { '--sensitive' } else { '--no-sensitive' }
        $code = Invoke-Vercel @('env', 'add', $Name, '-e', 'production', '-p', $Project, '--force', $kind) $file
        if ($code -ne 0) { throw "Could not set $Name (exit $code)" }
        Write-Host "  $Name set" -ForegroundColor Green
    } finally {
        Remove-Item $file -Force -ErrorAction SilentlyContinue
    }
}

function New-Secret {
    $b = [byte[]]::new(32)
    [Security.Cryptography.RandomNumberGenerator]::Fill($b)
    -join ($b | ForEach-Object { $_.ToString('x2') })
}

Write-Host '1/4 Sign in to Vercel' -ForegroundColor Cyan
if ((Invoke-Vercel @('whoami')) -ne 0) {
    if ((Invoke-Vercel @('login')) -ne 0) { throw 'Vercel sign-in failed' }
}

Write-Host "`n2/4 Google OAuth client (Google Auth Platform > Clients)" -ForegroundColor Cyan
$googleId = (Read-Host 'Client ID').Trim()
if ($googleId -notmatch "^$GcpProjectNumber-.+\.apps\.googleusercontent\.com$") {
    throw "Not a client ID of project $GcpProjectNumber (expected $GcpProjectNumber-....apps.googleusercontent.com)"
}
$googleSecret = Read-Host 'Client secret (not shown)' -AsSecureString | ConvertFrom-SecureString -AsPlainText
if ([string]::IsNullOrWhiteSpace($googleSecret)) { throw 'No client secret entered' }

Write-Host "`n3/4 Setting variables (Production)" -ForegroundColor Cyan
Set-Var 'AUTH_GOOGLE_ID' $googleId
Set-Var 'AUTH_GOOGLE_SECRET' $googleSecret -Sensitive
$googleSecret = $null
Set-Var 'AUTH_SECRET' (New-Secret) -Sensitive
Set-Var 'CRON_SECRET' (New-Secret) -Sensitive
Set-Var 'OWNER_EMAIL' $OwnerEmail
Set-Var 'APP_TIMEZONE' $Timezone
Set-Var 'DRIVE_FOLDER_ID' $DriveFolderId
Set-Var 'DRIVE_FEEDBACK_FILE_ID' $FeedbackFileId
Set-Var 'GCP_PROJECT_NUMBER' $GcpProjectNumber
Set-Var 'GCP_SERVICE_ACCOUNT_EMAIL' $ServiceAccountEmail
Set-Var 'GCP_WORKLOAD_IDENTITY_POOL_ID' $PoolId
Set-Var 'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID' $ProviderId

Write-Host "`n4/4 Redeploying production" -ForegroundColor Cyan
if ((Invoke-Vercel @('redeploy', "$Project.vercel.app", '-e', 'production')) -ne 0) {
    Write-Host 'Redeploy through the CLI failed. Use the dashboard: Deployments > latest > ... > Redeploy.' -ForegroundColor Yellow
    exit 1
}
Write-Host "`nDone. Open the app: the setup page should be gone." -ForegroundColor Green
