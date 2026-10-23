/**
 * <CardNaPortaria encomenda /> — card de "Na portaria" do morador (mockup
 * MoradorInicio, 23/10/2026): foto 84 px, eyebrow "Código", código mono 34 px,
 * "para <nome>", "tipo · transportadora", quando/quem recebeu e o botão que leva
 * à tela do código (QR). Parada há 3 dias ou mais ganha só o carimbo "N dias".
 * Server component; `encomenda` é o EncomendaResumo (sem telefone).
 */
import Link from "next/link";
import { QrCode } from "lucide-react";
import { CodigoEncomenda } from "@/components/encomenda/codigo-encomenda";
import { FotoEncomenda } from "@/components/encomenda/foto-encomenda";
import { StampStatus } from "@/components/encomenda/stamp-status";
import { formatarRelativo } from "@/lib/datas";
import type { EncomendaResumo } from "@/lib/encomendas";
import { nomeExibicao } from "@/lib/morador";

export function CardNaPortaria({ encomenda: e }: { encomenda: EncomendaResumo }) {
  const origem = [e.tipoRotulo, e.transportadora].filter(Boolean).join(" · ");
  return (
    <article
      aria-label={`Encomenda ${e.codigo}`}
      className="flex flex-col gap-2.5 rounded-[14px] border-[1.5px] border-kraft bg-card p-4"
    >
      <div className="flex gap-3">
        <FotoEncomenda fotoId={e.fotoId} alt={`Foto da encomenda ${e.codigo}`} size={84} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="eyebrow">Código</span>
          <CodigoEncomenda codigo={e.codigo} className="text-[34px] leading-none" />
          <div className="mt-1.5 line-clamp-2 font-semibold">para {nomeExibicao(e.destinatarioNome)}</div>
          {origem && <div className="text-[13px] text-ink-2">{origem}</div>}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 text-xs tabular-nums text-ink-3">
          {formatarRelativo(e.recebidaEm)} · recebida por {nomeExibicao(e.recebidaPor)}
        </span>
        {e.parada && <StampStatus status="aguardando" diasParada={e.diasParada} />}
      </div>
      <Link
        href={`/app/encomenda/${e.codigo}`}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-line bg-card px-[18px] text-[15px] font-semibold hover:border-kraft hover:text-kraft-ink"
      >
        <QrCode className="size-[18px] shrink-0" aria-hidden />
        Mostrar ao porteiro
      </Link>
    </article>
  );
}
