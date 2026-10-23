"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Mantém a tela viva sem push: relê os dados do servidor (router.refresh) a
 * cada `segundos` enquanto a aba está visível, e de novo ao voltar a ficar
 * visível/online (tablet que acorda, celular que reabre o app). O estado do
 * cliente (formulários, diálogos abertos) é preservado — só os dados mudam.
 * Também atualiza os contadores do cabeçalho, que vivem no layout.
 */
export function AtualizaPeriodico({ segundos = 60 }: { segundos?: number }) {
  const router = useRouter();

  useEffect(() => {
    const atualizar = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = window.setInterval(atualizar, segundos * 1000);
    document.addEventListener("visibilitychange", atualizar);
    window.addEventListener("online", atualizar);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", atualizar);
      window.removeEventListener("online", atualizar);
    };
  }, [router, segundos]);

  return null;
}
