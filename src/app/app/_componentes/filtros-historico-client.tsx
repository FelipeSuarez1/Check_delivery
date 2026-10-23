"use client";

/**
 * <FiltrosHistorico chips q ... /> — linha de chips do histórico (mockup
 * MoradorHistorico, 23/10/2026): um chip por ano com registro, "Tudo" e
 * "Buscar". Os chips de ano são links (`?ano=`); "Buscar" abre um campo (GET,
 * `?q=`) que guarda o ano escolhido. Nada é gravado: tudo é filtro de leitura.
 */
import { useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChipFiltro = { rotulo: string; href: string; ativo: boolean };

export function FiltrosHistorico({
  chips,
  q,
  ano,
  apto,
  hrefLimpar,
}: {
  chips: ChipFiltro[];
  /** busca atual ("" = sem busca) */
  q: string;
  /** valor do `?ano=` a manter ao buscar ("" = padrão) */
  ano: string;
  /** só admin: apartamento conferido */
  apto: string;
  /** link que remove a busca mantendo o ano */
  hrefLimpar: string;
}) {
  const [aberto, setAberto] = useState(q !== "");

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <Link
            key={c.rotulo}
            href={c.href}
            aria-current={c.ativo ? "true" : undefined}
            className={cn("chip h-11 min-w-11 justify-center tabular-nums", c.ativo ? "chip-on" : "hover:border-kraft")}
          >
            {c.rotulo}
          </Link>
        ))}
        {!aberto && (
          <button type="button" onClick={() => setAberto(true)} className="chip h-11 hover:border-kraft">
            <Search className="size-3.5" aria-hidden />
            Buscar
          </button>
        )}
      </div>

      {aberto && (
        <form method="get" action="/app/historico" role="search" className="flex gap-2">
          {ano !== "" && <input type="hidden" name="ano" value={ano} />}
          {apto !== "" && <input type="hidden" name="apto" value={apto} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            maxLength={60}
            autoFocus={q === ""}
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Código, nome ou empresa"
            aria-label="Buscar no histórico"
            className="h-11 min-w-0 flex-1 rounded-[10px] border border-input bg-card px-3.5 text-base outline-none focus-visible:border-kraft focus-visible:ring-2 focus-visible:ring-kraft/40"
          />
          <button
            type="submit"
            className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-ink bg-ink px-4 text-sm font-semibold text-white hover:opacity-90"
          >
            <Search className="size-4" aria-hidden />
            Buscar
          </button>
          {q !== "" && (
            <Link
              href={hrefLimpar}
              aria-label="Limpar busca"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] border border-line bg-card text-ink-2 hover:text-ink"
            >
              <X className="size-[18px]" aria-hidden />
            </Link>
          )}
        </form>
      )}
    </div>
  );
}
