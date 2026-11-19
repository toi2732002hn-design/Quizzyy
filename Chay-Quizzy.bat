@echo off
setlocal
title Quizzy - hoc tu vung
cd /d "%~dp0"

rem --- Kiem tra Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] May chua cai Node.js.
  echo     Hay tai ban LTS tai https://nodejs.org roi chay lai file nay.
  start "" https://nodejs.org
  pause
  exit /b 1
)

rem --- Neu Quizzy dang chay roi thi chi mo trinh duyet ---
node -e "require('net').connect(3000,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
if not errorlevel 1 (
  start "" http://localhost:3000
  exit /b 0
)

rem --- Cai thu vien lan dau ---
if not exist "node_modules" (
  echo Dang cai dat lan dau, vui long doi...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [!] Cai dat that bai. Kiem tra ket noi mang roi thu lai.
    pause
    exit /b 1
  )
)

rem --- Dung chung chi cua Windows (can cho mang cong ty); Node cu khong co co nay ---
set "CA_FLAG=--use-system-ca"
node --use-system-ca -e "" >nul 2>nul || set "CA_FLAG="

echo.
echo  Quizzy dang chay tai http://localhost:3000
echo  DUNG DONG CUA SO NAY khi dang hoc. Dong cua so = tat Quizzy.
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
node %CA_FLAG% server.js
pause
