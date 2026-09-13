[CmdletBinding()]
param(
    [string]$SshKey = "C:\Users\Diogo\.ssh\facturaya_hostinger_ed25519",
    [string]$VpsHost = "2.24.64.161",
    [string]$VpsUser = "root"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $SshKey -PathType Leaf)) {
    throw "No se encontró la llave SSH: $SshKey"
}

$secureKey = Read-Host "Pega tu GROQ_API_KEY real y presiona Enter" -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
$plainKey = $null
$previousOutputEncoding = $OutputEncoding

try {
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    if (
        [string]::IsNullOrWhiteSpace($plainKey) -or
        -not $plainKey.StartsWith("gsk_", [StringComparison]::Ordinal) -or
        $plainKey.Length -lt 20
    ) {
        throw "La entrada no parece una GROQ_API_KEY válida (debe comenzar con gsk_)."
    }

    $remoteCommand = @'
set -eu
secrets_directory="/opt/manolo-platform/infra/vps/secrets"
target="$secrets_directory/groq_api_key"
candidate="$secrets_directory/groq_api_key.candidate"
install -d -m 700 "$secrets_directory"
umask 077
IFS= read -r provided_key
printf '%s' "$provided_key" | tr -d '\r\n' > "$candidate"
http_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --connect-timeout 10 --max-time 20 --header "Authorization: Bearer $(cat "$candidate")" https://api.groq.com/openai/v1/models)"
if [ "$http_status" != "200" ]; then
    rm -f -- "$candidate"
    printf '%s\n' "groq_api=http_$http_status" >&2
    exit 1
fi
mv -- "$candidate" "$target"
chown 1000:1000 "$target"
chmod 600 "$target"
printf '%s\n' "groq_api=ok"
'@

    $OutputEncoding = [Text.UTF8Encoding]::new($false)
    $plainKey | & ssh `
        -i $SshKey `
        -o BatchMode=yes `
        -o ConnectTimeout=10 `
        "$VpsUser@$VpsHost" `
        $remoteCommand

    if ($LASTEXITCODE -ne 0) {
        throw "El VPS rechazó la clave. El secreto anterior no fue reemplazado."
    }

    Write-Host "Clave Groq validada y guardada correctamente en el VPS." -ForegroundColor Green
}
finally {
    if ($keyPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    }
    $plainKey = $null
    $secureKey.Dispose()
    $OutputEncoding = $previousOutputEncoding
}
