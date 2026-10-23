"use client";

/**
 * <SeletorMoradores moradores valor onChange disabled? />  (22/10/2026)
 * "Para quem?" - um chip por morador do apartamento + "Outro nome…" (texto livre).
 *  - moradores: { id, nome }[] do apto (lib/encomendas: listarMoradoresDoApartamento)
 *  - valor: { moradorId?: number; nome?: string } controlado pelo pai.
 *      { moradorId } = morador escolhido; { nome } (inclusive "") = modo "Outro nome…";
 *      {} = nada escolhido ainda.
 *  - onChange: recebe o novo valor (nunca com moradorId e nome juntos)
 * Apto sem moradores cadastrados: só o campo de nome, sempre visível.
 * No FormData de registrarEncomenda: moradorId -> "destinatarioMoradorId", nome -> "destinatarioNome".
 */
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Chip } from "./chip";

export type ValorDestinatario = { moradorId?: number; nome?: string };

export function SeletorMoradores({
  moradores,
  valor,
  onChange,
  disabled,
  className,
}: {
  moradores: { id: number; nome: string }[];
  valor: ValorDestinatario;
  onChange: (valor: ValorDestinatario) => void;
  disabled?: boolean;
  className?: string;
}) {
  const semMoradores = moradores.length === 0;
  const modoOutro = semMoradores || (valor.moradorId == null && valor.nome !== undefined);

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex flex-wrap gap-2">
        {moradores.map((m) => (
          <Chip
            key={m.id}
            selected={valor.moradorId === m.id}
            disabled={disabled}
            onClick={() => onChange({ moradorId: m.id })}
          >
            {m.nome}
          </Chip>
        ))}
        {!semMoradores && (
          <Chip selected={modoOutro} disabled={disabled} onClick={() => onChange({ nome: valor.nome ?? "" })}>
            Outro nome…
          </Chip>
        )}
      </div>
      {modoOutro && (
        <Input
          value={valor.nome ?? ""}
          onChange={(ev) => onChange({ nome: ev.target.value })}
          disabled={disabled}
          maxLength={80}
          autoFocus={!semMoradores}
          autoComplete="off"
          placeholder="Nome como está na etiqueta"
          aria-label="Nome do destinatário"
          className="h-12 text-base"
        />
      )}
    </div>
  );
}
