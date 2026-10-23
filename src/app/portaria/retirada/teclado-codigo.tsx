"use client";

import { useState } from "react";
import { Delete } from "lucide-react";
import { ALFABETO } from "@/lib/codigo";
import { cn } from "@/lib/utils";

const NUMEROS = ALFABETO.split("").filter((c) => /\d/.test(c)); // 2..9 (o alfabeto não tem 0 nem 1)
const LETRAS = ALFABETO.split("").filter((c) => /[A-Z]/.test(c)); // 24 letras (sem I nem O)

const TECLA =
  "flex h-14 select-none items-center justify-center rounded-[10px] border border-line bg-card text-xl font-semibold " +
  "text-ink transition-colors hover:bg-muted active:bg-muted disabled:pointer-events-none disabled:opacity-50 " +
  "outline-none focus-visible:ring-3 focus-visible:ring-kraft/40";

/**
 * Teclado do código na tela (tablet): teclas de 56 px. Duas páginas:
 *  - números: 2 a 9 (o código nunca tem 0 nem 1) + apagar / ABC / limpar / OK = 12 teclas;
 *  - letras: as 24 letras possíveis (sem I e O) em 6 colunas + 123 / apagar / OK.
 * Só existem teclas VÁLIDAS: é impossível digitar 0, O, 1 ou I por aqui. O teclado
 * do sistema continua funcionando ao tocar no campo do código.
 */
export function TecladoCodigo({
  onTecla,
  onApagar,
  onLimpar,
  onOk,
  desabilitado,
  className,
}: {
  onTecla: (c: string) => void;
  onApagar: () => void;
  onLimpar: () => void;
  onOk: () => void;
  desabilitado?: boolean;
  className?: string;
}) {
  const [pagina, setPagina] = useState<"numeros" | "letras">("numeros");

  const apagar = (
    <button type="button" className={TECLA} onClick={onApagar} disabled={desabilitado} aria-label="Apagar o último caractere">
      <Delete className="size-6" aria-hidden />
    </button>
  );
  const ok = (
    <button
      type="button"
      className={cn(TECLA, "border-ink bg-ink text-white hover:bg-ink-2 active:bg-ink-2")}
      onClick={onOk}
      disabled={desabilitado}
    >
      OK
    </button>
  );

  return (
    <div className={cn("flex flex-col gap-2", className)} role="group" aria-label="Teclado do código">
      {pagina === "numeros" ? (
        <div className="grid grid-cols-3 gap-2">
          {NUMEROS.map((n) => (
            <button key={n} type="button" className={cn(TECLA, "font-mono")} onClick={() => onTecla(n)} disabled={desabilitado}>
              {n}
            </button>
          ))}
          {apagar}
          <button
            type="button"
            className={cn(TECLA, "text-base")}
            onClick={() => setPagina("letras")}
            disabled={desabilitado}
            aria-label="Mostrar as letras"
          >
            ABC
          </button>
          <button type="button" className={cn(TECLA, "text-base")} onClick={onLimpar} disabled={desabilitado}>
            Limpar
          </button>
          {ok}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-6 gap-2">
            {LETRAS.map((l) => (
              <button key={l} type="button" className={cn(TECLA, "font-mono")} onClick={() => onTecla(l)} disabled={desabilitado}>
                {l}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              className={cn(TECLA, "text-base")}
              onClick={() => setPagina("numeros")}
              disabled={desabilitado}
              aria-label="Mostrar os números"
            >
              123
            </button>
            {apagar}
            {ok}
          </div>
        </>
      )}
    </div>
  );
}
