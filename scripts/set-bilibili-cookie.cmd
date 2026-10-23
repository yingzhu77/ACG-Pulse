@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
node "%~dp0set-bilibili-cookie.mjs" %*
set "exitCode=%errorlevel%"
echo %cmdcmdline% | findstr /i /c:"/c" >nul
if not errorlevel 1 pause
exit /b %exitCode%
