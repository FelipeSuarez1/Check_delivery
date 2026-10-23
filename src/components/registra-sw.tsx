"use client";

import { useEffect } from "react";

/**
 * Registra o service worker (requisito para o navegador oferecer "instalar o
 * app"). O SW só guarda arquivos estáticos de build (ver public/sw.js).
 *
 * Em desenvolvimento NÃO registra e ainda desinstala o que existir: os arquivos
 * de /_next/static mudam sem trocar de nome a cada edição e um cache-first
 * serviria código velho.
 */
export function RegistraSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {});
      return;
    }
    // não atrapalha o primeiro pintar da tela
    const id = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* sem service worker o app funciona igual, só não instala */
      });
    }, 1500);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}
