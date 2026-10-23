"use client";

/**
 * <ChipsTipo valor onChange disabled? />  (22/10/2026)
 * Escolha do tipo: Caixa, Envelope, Sacola, Mercado, Perecível.
 *  - valor: TipoEncomenda | null (nenhum escolhido ainda)
 *  - onChange: recebe o tipo clicado
 * No FormData de registrarEncomenda o valor vai no campo "tipo".
 */
import { ROTULO_TIPO, TIPOS, type TipoEncomenda } from "@/lib/encomenda-constantes";
import { cn } from "@/lib/utils";
import { Chip } from "./chip";

export function ChipsTipo({
  valor,
  onChange,
  disabled,
  className,
}: {
  valor: TipoEncomenda | null | undefined;
  onChange: (tipo: TipoEncomenda) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)} role="group" aria-label="Tipo da encomenda">
      {TIPOS.map((t) => (
        <Chip key={t} selected={valor === t} disabled={disabled} onClick={() => onChange(t)}>
          {ROTULO_TIPO[t]}
        </Chip>
      ))}
    </div>
  );
}
