/**
 * <CardEncomenda encomenda href? acoes? className? />  (22/10/2026)
 * Card do mockup "Aguardando": foto 72 px, código + apto, destinatário,
 * "tipo · transportadora", "quando · porteiro" e o carimbo de status.
 *  - encomenda: EncomendaResumo (lib/encomendas) - já serializável
 *  - href: se vier, o card INTEIRO é um link (link esticado; os `acoes` continuam clicáveis)
 *  - acoes: botões extras abaixo do card (ex. "Avisar no WhatsApp", "Cancelar")
 * Parada (3 dias ou mais): borda vermelha. Entregue/cancelada ganham uma linha
 * de contexto (quem retirou / motivo). Funciona em server e client components.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { formatarRelativo } from "@/lib/datas";
import type { EncomendaResumo } from "@/lib/encomendas";
import { cn } from "@/lib/utils";
import { CodigoEncomenda } from "./codigo-encomenda";
import { FotoEncomenda } from "./foto-encomenda";
import { StampStatus } from "./stamp-status";

export function CardEncomenda({
  encomenda: e,
  href,
  acoes,
  className,
}: {
  encomenda: EncomendaResumo;
  href?: string;
  acoes?: ReactNode;
  className?: string;
}) {
  const origem = [e.tipoRotulo, e.transportadora].filter(Boolean).join(" · ");
  const contexto =
    e.status === "entregue" && e.entregueEm
      ? `Retirou ${e.retiradaPor ?? "—"}${e.retiradaPorTerceiro ? " (terceiro)" : ""} · ${formatarRelativo(e.entregueEm)}`
      : e.status === "cancelada"
        ? `Cancelada${e.canceladaMotivo ? `: ${e.canceladaMotivo}` : ""}`
        : null;

  return (
    <div
      className={cn(
        "relative flex flex-col gap-2.5 rounded-[14px] border bg-card p-3.5 transition-colors",
        e.parada ? "border-warn" : "border-line",
        href && "hover:border-kraft",
        className
      )}
    >
      {href && (
        <Link
          href={href}
          aria-label={`Abrir encomenda ${e.codigo} do ${e.apartamento}`}
          className="absolute inset-0 z-0 rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-kraft"
        />
      )}
      <div className="flex items-start gap-3">
        <FotoEncomenda fotoId={e.fotoId} alt={`Foto da encomenda ${e.codigo}`} size={72} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <CodigoEncomenda codigo={e.codigo} size="md" className="text-ink" />
            <span className="font-heading text-[22px] font-semibold leading-none">{e.apartamento}</span>
          </div>
          <div className="truncate font-semibold">{e.destinatarioNome}</div>
          <div className="truncate text-[13px] text-ink-2">{origem}</div>
        </div>
      </div>
      {contexto && <div className="truncate text-[13px] text-ink-2">{contexto}</div>}
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs tabular-nums text-ink-3">
          {formatarRelativo(e.recebidaEm)} · {e.recebidaPor}
        </span>
        <StampStatus status={e.status} diasParada={e.diasParada} />
      </div>
      {acoes && <div className="relative z-10 flex flex-wrap items-center gap-2">{acoes}</div>}
    </div>
  );
}
