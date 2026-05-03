@echo off
setlocal

cd /d "%~dp0"

set "PORT=3000"
set "PORT_IN_USE="

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  set "PORT_IN_USE=%%P"
)

if defined PORT_IN_USE (
  powershell -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing 'http://localhost:%PORT%/api/diagnostico' -TimeoutSec 5; if ($response.StatusCode -eq 200) { exit 0 } else { exit 2 } } catch { exit 1 }"

  if not errorlevel 1 (
    echo O sistema ja esta rodando em http://localhost:%PORT%
    echo Use a mesma URL no navegador.
    echo.
    echo Se quiser atualizar o sistema, primeiro feche a outra janela preta do servidor e rode este arquivo de novo.
    pause
    exit /b 0
  )

  echo A porta %PORT% ja esta ocupada por outro processo.
  echo Feche a aplicacao que estiver usando essa porta e rode este arquivo novamente.
  pause
  exit /b 1
)

if not exist ".next\BUILD_ID" (
  echo.
  echo Gerando build estavel do sistema...
  "C:\Program Files\nodejs\node.exe" ".\node_modules\next\dist\bin\next" build
  if errorlevel 1 (
    echo.
    echo O build falhou. Nao feche esta janela.
    pause
    exit /b 1
  )
) else (
  echo Usando build local ja gerado.
)

echo.
echo Sistema pronto em http://localhost:3000
echo Nao feche esta janela enquanto estiver usando o sistema.
echo.

"C:\Program Files\nodejs\node.exe" ".\node_modules\next\dist\bin\next" start -p 3000
