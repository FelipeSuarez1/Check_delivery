@echo off
rem Sobe o app de Encomendas em modo producao na porta 3001 (atalho da pasta Inicializar do servidor).
rem Se o build estiver desatualizado apos mudancas de codigo, rode antes: npm run build
title Encomendas Espaco Tangara (porta 3001)
rem %~dp0 = pasta deste arquivo (scripts\); sobe um nivel ate a raiz do projeto.
rem Assim o atalho funciona em qualquer computador, sem editar caminho.
cd /d "%~dp0.."
npm run start
pause
