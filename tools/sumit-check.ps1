# PORTAL X - SUMIT connection check. Read-only: it charges nothing and creates no customer, document or payment.
# Calls only POST /website/companies/getdetails/ and POST /billing/payments/list/ (last 24 hours, prints a count only).
#
# The private key is read only from the environment variable SUMIT_API_KEY, never from an argument or a file,
# and is never printed. Set it for this window only, without leaving it in the shell history:
#
#   $env:SUMIT_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host -AsSecureString 'SUMIT private key')).Password
#   $env:SUMIT_COMPANY_ID = '<the organization number>'
#   powershell -ExecutionPolicy Bypass -File .\tools\sumit-check.ps1
#   Remove-Item Env:SUMIT_API_KEY

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$key = $env:SUMIT_API_KEY
if ([string]::IsNullOrWhiteSpace($key)) {
    Write-Output 'SUMIT_API_KEY is not set in this window. Nothing was sent.'
    exit 2
}
if ([string]::IsNullOrWhiteSpace($env:SUMIT_COMPANY_ID)) {
    Write-Output 'SUMIT_COMPANY_ID is not set in this window. Nothing was sent.'
    exit 2
}
$companyId = [long]$env:SUMIT_COMPANY_ID
$base = 'https://api.sumit.co.il'

# SUMIT error texts are printed only after any accidental copy of the key is removed
function Clean([string]$text) {
    if ($null -eq $text) { return '' }
    return $text.Replace($key, '***')
}

function Call([string]$path, [hashtable]$extra) {
    $body = @{ Credentials = @{ CompanyID = $companyId; APIKey = $key } } + $extra
    $bytes = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 5 -Compress))
    try {
        return Invoke-RestMethod -Method Post -Uri ($base + $path) -ContentType 'application/json' -Body $bytes -TimeoutSec 45
    } catch {
        $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'no response' }
        Write-Output "FAILED: $path answered HTTP $code."
        exit 1
    }
}

Write-Output "Company ID: $companyId"

$company = Call '/website/companies/getdetails/' @{}
if ($company.Status -ne 0) {
    Write-Output "FAILED: company details refused (status $($company.Status)): $(Clean $company.UserErrorMessage)"
    exit 1
}
$types = @('CompanyWithVAT', 'VATExemptDealer', 'LicensedDealer', 'Fellowship', 'Partnership', 'CommunityInterestCompany',
    'Cooperative', 'HouseCommittee', 'ElectionGroup', 'Party', 'SelfEmployed', 'PublicTrust')
$c = $company.Data.Company
$type = if ($c.CompanyType -is [int] -and $c.CompanyType -lt $types.Count) { $types[$c.CompanyType] } else { "$($c.CompanyType)" }
Write-Output 'OK: the key is accepted.'
Write-Output "Organization: $($c.Name)"
Write-Output "Organization type: $type"
if ($type -eq 'VATExemptDealer') { Write-Output 'OK: exempt dealer, receipts only.' } else { Write-Output 'WARNING: not an exempt dealer. The site will not open a payment page.' }

$now = (Get-Date).ToUniversalTime()
$payments = Call '/billing/payments/list/' @{
    Date_From = $now.AddDays(-1).ToString('yyyy-MM-ddTHH:mm:ssZ')
    Date_To = $now.ToString('yyyy-MM-ddTHH:mm:ssZ')
    StartIndex = 0
}
if ($payments.Status -ne 0) {
    Write-Output "WARNING: the billing API refused (status $($payments.Status)): $(Clean $payments.UserErrorMessage)"
    Write-Output 'The credit card module may be missing, or the key may lack access to it.'
    exit 1
}
Write-Output "OK: the billing API answers ($(@($payments.Data.Payments).Count) payments in the last 24 hours; no details printed)."
Write-Output 'Done. Nothing was charged or created.'
