"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { AvisoOk } from "./ui-admin";

/**
 * Mensagem de sucesso que some sozinha (8 s) depois de uma ação: o diálogo já
 * fechou, então é o único sinal de que deu certo. `mostrar` é estável.
 */
export function useAvisoTransitorio(): { aviso: string | null; mostrar: (texto: string) => void; limpar: () => void } {
  const [aviso, setAviso] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const limpar = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setAviso(null);
  }, []);

  const mostrar = useCallback((texto: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    setAviso(texto);
    timer.current = window.setTimeout(() => setAviso(null), 8000);
  }, []);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  return { aviso, mostrar, limpar };
}

export function FaixaAviso({ aviso, aoFechar }: { aviso: string | null; aoFechar: () => void }) {
  if (!aviso) return null;
  return (
    <div className="relative">
      <AvisoOk className="pr-12">{aviso}</AvisoOk>
      <button
        type="button"
        onClick={aoFechar}
        aria-label="Fechar aviso"
        className="absolute top-0 right-0 inline-flex size-11 items-center justify-center rounded-[10px] text-ok hover:bg-ok/10"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
