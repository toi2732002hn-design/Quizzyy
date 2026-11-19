@echo off
chcp 65001 >nul
title Cai dat Quizzy
if not exist "%~dp0installer\Install.ps1" (
  echo Khong tim thay thu muc "installer".
  echo Hay giai nen TOAN BO file zip ra mot thu muc roi chay lai file nay.
  echo (Dung chay truc tiep tu ben trong file zip.)
  pause
  exit /b 1
)
start "" powershell -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0installer\Install.ps1"
exit /b 0
