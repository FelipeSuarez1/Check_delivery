"use client";

/**
 * <SeletorMoradores moradores valor onChange disabled? />  (22/10/2026)
 * "Para quem?" - um chip por morador do apartamento + "Outro nome…" (texto livre).
 *  - moradores: { id, nome, avisoWhatsApp? }[] do apto (lib/encomendas: listarApartamentosComMoradores).
 *      avisoWhatsApp === false (23/10/2026, LGPD) = o morador recusou avisos por WhatsApp: o chip leva um sino
 *      cortado (+ title e texto para leitor de tela) e, escolhido, aparece uma linha explicando que a
 *      encomenda dele não gera link do WhatsApp. Omitido = aceita.
 *  - valor: { moradorId?: number; nome?: string } controlado pelo pai.
 *      { moradorId } = morador escolhido; { nome } (inclusive "") = modo "Outro nome…";
 *      {} = nada escolhido ainda.
 *  - onChange: recebe o novo valor (nunca com moradorId e nome juntos)
 * Apto sem moradores cadastrados: só o campo de nome, sempre visível.
 * No FormData de registrarEncomenda: moradorId -> "destinatarioMoradorId", nome -> "destinatarioNome".
 */
import { BellOff } from "lucide-react";
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
  moradores: { id: number; nome: string; avisoWhatsApp?: boolean }[];
  valor: ValorDestinatario;
  onChange: (valor: ValorDestinatario) => void;
  disabled?: boolean;
  className?: string;
}) {
  const semMoradores = moradores.length === 0;
  const modoOutro = semMoradores || (valor.moradorId == null && valor.nome !== undefined);
  const escolhido = valor.moradorId != null ? moradores.find((m) => m.id === valor.moradorId) : undefined;
  const escolhidoRecusou = escolhido?.avisoWhatsApp === false;

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex flex-wrap gap-2">
        {moradores.map((m) => {
          const recusou = m.avisoWhatsApp === false;
          return (
            <Chip
              key={m.id}
              selected={valor.moradorId === m.id}
              disabled={disabled}
              onClick={() => onChange({ moradorId: m.id })}
              title={recusou ? "não recebe WhatsApp" : undefined}
            >
              {m.nome}
              {recusou && (
                <>
                  <BellOff className="size-3.5 shrink-0 opacity-70" aria-hidden />
                  <span className="sr-only">(não recebe WhatsApp)</span>
                </>
              )}
            </Chip>
          );
        })}
        {!semMoradores && (
          <Chip selected={modoOutro} disabled={disabled} onClick={() => onChange({ nome: valor.nome ?? "" })}>
            Outro nome…
          </Chip>
        )}
      </div>
      {escolhidoRecusou && escolhido && (
        <p className="flex items-start gap-1.5 text-[13px] text-ink-2" role="status">
          <BellOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {escolhido.nome} pediu para não receber avisos no WhatsApp: esta encomenda não gera o link do aviso.
        </p>
      )}
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
