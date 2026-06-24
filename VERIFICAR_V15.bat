@echo off
title Verificar NODO V15
echo ==========================================
echo Verificando NODO V15
echo ==========================================
if exist main.js (echo OK main.js) else (echo FALTA main.js)
if exist app-preload.js (echo OK app-preload.js) else (echo FALTA app-preload.js)
if exist "NODO · OPERATIVO LITE.htm" (echo OK panel HTML) else (echo FALTA NODO OPERATIVO LITE)
if exist package.json (echo OK package.json) else (echo FALTA package.json)
echo.
node --check main.js
node --check app-preload.js
echo.
pause
