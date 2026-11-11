param([switch]$Instalar, [switch]$Validar)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Falha ao executar $Program $Arguments" }
}

$Python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if ($Instalar) {
    if (-not (Test-Path -LiteralPath $Python)) {
        Invoke-Checked 'py' @('-3', '-m', 'venv', '.venv')
    }
    Invoke-Checked $Python @('-m', 'pip', 'install', '-r', 'requirements-platform.txt', '-r', 'requirements.txt')
    if (Test-Path -LiteralPath 'frontend\package-lock.json') {
        Invoke-Checked 'npm.cmd' @('ci', '--prefix', 'frontend')
    } else {
        Invoke-Checked 'npm.cmd' @('install', '--prefix', 'frontend')
    }
    Invoke-Checked 'npm.cmd' @('run', 'build', '--prefix', 'frontend')
}
if (-not (Test-Path -LiteralPath $Python)) { throw 'Execute primeiro: .\iniciar.ps1 -Instalar' }
if ($Validar) {
    Invoke-Checked $Python @('-m', 'pytest', 'tests', 'test_app.py', '-q')
    Invoke-Checked 'npm.cmd' @('test', '--prefix', 'frontend')
    Invoke-Checked 'npm.cmd' @('run', 'build', '--prefix', 'frontend')
    return
}
if (-not (Test-Path -LiteralPath 'frontend\dist\index.html')) { throw 'Frontend ausente. Execute: .\iniciar.ps1 -Instalar' }
Invoke-Checked $Python @('run.py')
