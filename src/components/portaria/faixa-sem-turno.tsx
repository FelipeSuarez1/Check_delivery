"use client";

import { TriangleAlert } from "lucide-react";
import { abrirDialogoTurno } from "@/components/turno-dialog";
import { classeBotao } from "@/components/portaria/botao";
import { cn } from "@/lib/utils";

/**
 * Faixa de aviso quando não há turno aberto: sem turno ninguém consegue
 * registrar nem entregar (o porteiro do turno é gravado em cada encomenda).
 * O botão abre o diálogo "Quem está de turno?" do cabeçalho.
 */
export function FaixaSemTurno({
  texto = "Abra o turno para registrar e entregar",
  className,
}: {
  texto?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-warn bg-warn-soft px-4 py-2.5 text-warn",
        className
      )}
    >
      <TriangleAlert className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 text-base font-semibold">{texto}</span>
      <button type="button" onClick={abrirDialogoTurno} className={classeBotao({ variante: "escuro" })}>
        Abrir turno
      </button>
    </div>
  );
}
