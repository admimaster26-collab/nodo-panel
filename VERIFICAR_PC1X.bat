@echo off
title Verificar NODO V15.1 PC1X
echo ==========================================
echo Verificando NODO V15.1 PC1X
echo ==========================================
if exist main.js (echo OK main.js) else (echo FALTA main.js)
if exist app-preload.js (echo OK app-preload.js) else (echo FALTA app-preload.js)
if exist package.json (echo OK package.json) else (echo FALTA package.json)
if exist ".env" (echo OK .env) else (echo FALTA .env - copiar desde .env.PC1X.example)
echo.
node --check main.js
node --check app-preload.js
node --check agent-preload.js
echo.
pause
