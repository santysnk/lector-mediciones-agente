@echo off
title Agente Lector de Mediciones
cd /d "%~dp0"
echo ========================================
echo   Agente Lector de Mediciones Modbus
echo ========================================
echo.
echo Iniciando agente...
echo.
npm start
echo.
echo Agente detenido. Presiona una tecla para cerrar.
pause >nul
