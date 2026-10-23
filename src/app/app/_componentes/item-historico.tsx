/**
 * <ItemHistorico encomenda /> — uma linha do histórico (mockup MoradorHistorico,
 * 23/10/2026): foto 48 px, código, carimbo, "para <nome> · tipo · transportadora"
 * e "retirada por <quem> · dd/MM HH:mm" (ou "cancelada: motivo"). A linha toda é
 * um link para a tela do código. Server component.
 */
import Link from "next/link";
import { CodigoEncomenda } from "@/components/encomenda/codigo-encomenda";
import { FotoEncomenda } from "@/components/encomenda/foto-encomenda";
import { StampStatus } from "@/components/encomenda/stamp-status";
import { formatarDataHora } from "@/lib/datas";
import type { EncomendaResumo } from "@/lib/encomendas";
import { nomeExibicao } from "@/lib/morador";

function desfecho(e: EncomendaResumo): string {
  if (e.status === "entregue") {
    const quem = e.retiradaPor ? `retirada por ${nomeExibicao(e.retiradaPor)}${e.retiradaPorTerceiro ? " (terceiro)" : ""}` : "retirada";
    return e.entregueEm ? `${quem} · ${formatarDataHora(e.entregueEm)}` : quem;
  }
  const motivo = e.canceladaMotivo ? `cancelada: ${e.canceladaMotivo}` : "cancelada";
  return e.canceladaEm ? `${motivo} · ${formatarDataHora(e.canceladaEm)}` : motivo;
}

export function ItemHistorico({ encomenda: e }: { encomenda: EncomendaResumo }) {
  const origem = [e.tipoRotulo, e.transportadora].filter(Boolean).join(" · ");
  return (
    <Link
      href={`/app/encomenda/${e.codigo}`}
      className="flex gap-3 border-b border-line py-3 last:border-b-0 hover:bg-paper/60"
    >
      <FotoEncomenda fotoId={e.fotoId} alt={`Foto da encomenda ${e.codigo}`} size={48} className="rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <CodigoEncomenda codigo={e.codigo} size="sm" className="text-base text-ink" />
          <StampStatus status={e.status} className="h-[22px] text-[11px]" />
        </div>
        <div className="text-sm">
          <b className="font-semibold">para {nomeExibicao(e.destinatarioNome)}</b>
          {origem && <span className="text-ink-2"> · {origem}</span>}
        </div>
        <div className="text-xs tabular-nums text-ink-3">{desfecho(e)}</div>
      </div>
    </Link>
  );
}
