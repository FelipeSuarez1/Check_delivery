import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { exigirPapelNaPagina } from "@/lib/auth";
import { buscarPorCodigo, encomendaParaMoradorPorCodigo, type EncomendaResumo } from "@/lib/encomendas";
import { montarLinhaDoTempo, nomeExibicao, textoLocalGuardado } from "@/lib/morador";
import { CodigoEncomenda } from "@/components/encomenda/codigo-encomenda";
import { QrCodigo } from "@/components/encomenda/qr-codigo";
import { StampStatus } from "@/components/encomenda/stamp-status";
import { FotosAmpliaveis } from "../../_componentes/fotos-ampliaveis-client";
import { LinhaDoTempo } from "../../_componentes/linha-do-tempo";

export const metadata: Metadata = { title: "Encomenda" };

/**
 * Tela do código (mockup MoradorCodigo): QR + código grande para mostrar ao
 * porteiro, dados da encomenda e linha do tempo.
 *
 * AUTORIZAÇÃO: o morador só abre encomenda do PRÓPRIO apartamento — a consulta
 * filtra por `apartamentoId` da sessão e qualquer outro caso (código de outro
 * apto, inexistente, malformado) cai no mesmo 404, sem 403 que confirme que o
 * código existe. O admin (que abre a área para conferir) vê qualquer apto.
 */
export default async function EncomendaDoMoradorPage({ params }: { params: Promise<{ codigo: string }> }) {
  const sessao = await exigirPapelNaPagina("morador", "admin");
  const { codigo } = await params;

  let e: EncomendaResumo | null;
  if (sessao.papel === "morador") {
    if (!sessao.apartamentoId) notFound();
    e = await encomendaParaMoradorPorCodigo(codigo, sessao.apartamentoId);
  } else {
    e = await buscarPorCodigo(codigo);
  }
  if (!e) notFound();

  const origem = [e.tipoRotulo, e.transportadora].filter(Boolean).join(" · ");
  const aguardando = e.status === "aguardando";
  // admin conferindo: o "Voltar" mantém o apartamento que ele está vendo
  const sufixoAdmin = sessao.papel === "admin" ? `?apto=${encodeURIComponent(e.apartamento)}` : "";
  const voltar = aguardando ? `/app${sufixoAdmin}` : `/app/historico${sufixoAdmin}`;
  const passos = montarLinhaDoTempo(e);

  return (
    <>
      <h1 className="sr-only">Encomenda {e.codigo}</h1>
      <div className="flex items-center gap-2.5">
        <Link href={voltar} className="chip h-11 hover:border-kraft">
          <ArrowLeft className="size-3.5" aria-hidden />
          Voltar
        </Link>
        <StampStatus status={e.status} diasParada={e.diasParada} />
      </div>

      {aguardando ? (
        <section
          aria-label={`Código ${e.codigo}`}
          className="flex flex-col items-center gap-2.5 rounded-[14px] border-2 border-kraft bg-card p-5"
        >
          <QrCodigo codigo={e.codigo} size={200} />
          <CodigoEncomenda codigo={e.codigo} className="text-[52px] leading-none" />
          <span className="text-center text-[13px] text-ink-2">Mostre esta tela ao porteiro, ou diga o código.</span>
        </section>
      ) : (
        <section
          aria-label={`Código ${e.codigo}`}
          className="flex flex-col items-center gap-2 rounded-[14px] border border-line bg-card p-5"
        >
          <CodigoEncomenda codigo={e.codigo} size="lg" className="text-ink-3" />
          <span className="text-center text-[13px] text-ink-2">
            {e.status === "entregue"
              ? "Esta encomenda já foi entregue — o código não vale mais para retirar."
              : "Esta encomenda foi cancelada — o código não vale mais para retirar."}
          </span>
        </section>
      )}

      <section className="flex flex-col gap-2 rounded-[14px] border border-line bg-card p-4">
        <div className="flex gap-3">
          <FotosAmpliaveis fotos={e.fotos.map((f) => ({ id: f.id }))} codigo={e.codigo} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <b className="font-semibold">para {nomeExibicao(e.destinatarioNome)}</b>
            {origem && <span className="text-[13px] text-ink-2">{origem}</span>}
            {e.local && <span className="text-[13px] text-ink-2">{textoLocalGuardado(e.local)}</span>}
          </div>
        </div>
        {e.fotos.length === 0 && !aguardando && (
          <p className="text-xs text-ink-3">A foto não está mais disponível — ela fica guardada por 90 dias depois da entrega.</p>
        )}
      </section>

      <LinhaDoTempo passos={passos} />
    </>
  );
}
