@echo off
cd /d C:\Users\USUARIO\.openclaw\workspace-jacko\Botbarber2
netstat -ano | findstr ":3001" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 exit /b 0
echo ===== arranque %date% %time% =====>> %TEMP%\slotbrain.log
set PORT=3001
"C:\Users\USUARIO\AppData\Roaming\fnm\node-versions\v22.14.0\installation\node.exe" server.js>> %TEMP%\slotbrain.log 2>&1
