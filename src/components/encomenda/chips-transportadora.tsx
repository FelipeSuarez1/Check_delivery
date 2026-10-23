"use client";

/**
 * <ChipsTransportadora valor onChange disabled? />  (22/10/2026)
 * Transportadora/remetente: as sugeridas (Correios, Mercado Livre, Amazon,
 * Shopee) + "Outro" com texto livre. É opcional: tocar de novo na escolhida desmarca.
 *  - valor: string ("" = nenhuma)
 *  - onChange: recebe o texto final (nome sugerido ou o digitado)
 * No FormData de registrarEncomenda o valor vai no campo "transportadora".
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { TRANSPORTADORAS_SUGERIDAS } from "@/lib/encomenda-constantes";
import { cn } from "@/lib/utils";
import { Chip } from "./chip";

const ehSugerida = (v: string) => (TRANSPORTADORAS_SUGERIDAS as readonly string[]).includes(v);

export function ChipsTransportadora({
  valor,
  onChange,
  disabled,
  className,
}: {
  valor: string;
  onChange: (valor: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [outroAberto, setOutroAberto] = useState(false);
  // um valor que não é sugerido (ex. veio preenchido) também é "Outro"
  const modoOutro = outroAberto || (valor !== "" && !ehSugerida(valor));

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Transportadora ou remetente">
        {TRANSPORTADORAS_SUGERIDAS.map((t) => (
          <Chip
            key={t}
            selected={!modoOutro && valor === t}
            disabled={disabled}
            onClick={() => {
              setOutroAberto(false);
              onChange(!modoOutro && valor === t ? "" : t);
            }}
          >
            {t}
          </Chip>
        ))}
        <Chip
          selected={modoOutro}
          disabled={disabled}
          onClick={() => {
            if (modoOutro) {
              setOutroAberto(false);
              onChange("");
            } else {
              setOutroAberto(true);
              if (ehSugerida(valor)) onChange("");
            }
          }}
        >
          Outro
        </Chip>
      </div>
      {modoOutro && (
        <Input
          value={valor}
          onChange={(ev) => onChange(ev.target.value)}
          disabled={disabled}
          maxLength={60}
          autoFocus
          autoComplete="off"
          placeholder="Transportadora ou remetente"
          aria-label="Outra transportadora ou remetente"
          className="h-12 text-base"
        />
      )}
    </div>
  );
}
