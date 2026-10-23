/**
 * /portaria/encomenda/[id] - detalhe e ações de uma encomenda (23/10/2026).
 * Foto grande, código, apto, destinatário, tipo/transportadora/local/observação,
 * linha do tempo (recebida → aviso → entregue/cancelada) e os botões da portaria.
 * Só portaria/admin (a allowlist do middleware já barra o morador; aqui reforça).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AcoesEncomendaClient } from "./acoes-encomenda-client";
import { CodigoEncomenda } from "@/components/encomenda/codigo-encomenda";
import { GaleriaFotos } from "@/components/encomenda/galeria-fotos";
import { StampStatus } from "@/components/encomenda/stamp-status";
import { LinkVoltar } from "@/components/portaria/link-voltar";
import { exigirPapelNaPagina } from "@/lib/auth";
import { formatarRelativo } from "@/lib/datas";
import { buscarPorId, prepararAviso, type EncomendaDetalhe } from "@/lib/encomendas";
import { formatarHa } from "@/lib/historico-portaria";
import { buscarTurnoAberto } from "@/lib/turno";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Encomenda" };

export default async function DetalheEncomendaPage({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await exigirPapelNaPagina("portaria", "admin");
  const { id: idTexto } = await params;
  if (!/^\d{1,9}$/.test(idTexto)) notFound();
  const e = await buscarPorId(Number(idTexto));
  if (!e) notFound();

  const aguardando = e.status === "aguardando";
  const [turno, aviso] = await Promise.all([buscarTurnoAberto(), aguardando ? prepararAviso(e.id) : null]);

  // a action decide de verdade; aqui só some o botão de quem não poderia usá-lo
  const podeCancelar =
    aguardando && (sessao.papel === "admin" || (!!turno && new Date(e.recebidaEm) >= new Date(turno.inicioISO)));

  const campos: { rotulo: string; valor: string }[] = [
    { rotulo: "Tipo", valor: e.tipoRotulo },
    ...(e.transportadora ? [{ rotulo: "Transportadora", valor: e.transportadora }] : []),
    ...(e.local ? [{ rotulo: "Onde guardou", valor: e.local }] : []),
    ...(e.observacao ? [{ rotulo: "Observação", valor: e.observacao }] : []),
  ];

  const vazioFoto = aguardando ? "Sem foto" : "Foto apagada (as fotos saem do disco 90 dias após a entrega)";

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <LinkVoltar href="/portaria" />
        <h1 className="text-2xl">Encomenda</h1>
        <StampStatus status={e.status} diasParada={e.diasParada} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[460px_minmax(0,1fr)]">
        <GaleriaFotos fotos={e.fotos} codigo={e.codigo} vazio={vazioFoto} />

        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-[14px] border border-line bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <CodigoEncomenda codigo={e.codigo} size="lg" />
              <Link
                href={`/portaria/historico/${e.apartamento}`}
                title={`Ver o histórico do ${e.apartamento}`}
                className="font-heading text-[32px] font-semibold leading-none underline-offset-4 hover:text-kraft-ink hover:underline"
              >
                {e.apartamento}
              </Link>
            </div>
            <div>
              <div className="text-xl font-semibold">{e.destinatarioNome}</div>
              <div className="text-[15px] text-ink-2">Torre {e.torre}</div>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 border-t border-line pt-3 sm:grid-cols-2">
              {campos.map((c) => (
                <div key={c.rotulo} className={cn("min-w-0", c.rotulo === "Observação" && "sm:col-span-2")}>
                  <dt className="eyebrow">{c.rotulo}</dt>
                  <dd className="break-words text-base">{c.valor}</dd>
                </div>
              ))}
            </dl>
          </section>

          <LinhaDoTempo e={e} />

          {aguardando && (
            <AcoesEncomendaClient
              id={e.id}
              codigo={e.codigo}
              apartamento={e.apartamento}
              linkWhatsApp={aviso?.ok ? aviso.link : null}
              semTelefone={aviso && !aviso.ok ? aviso.erro : null}
              podeCancelar={podeCancelar}
              jaAvisada={!!e.avisoWhatsAppEm}
            />
          )}
        </div>
      </div>
    </>
  );
}

type Passo = { chave: string; titulo: string; detalhe: string; cor: string; pendente?: boolean };

function LinhaDoTempo({ e }: { e: EncomendaDetalhe }) {
  const passos: Passo[] = [
    {
      chave: "recebida",
      titulo: "Recebida na portaria",
      detalhe: `${formatarRelativo(e.recebidaEm)} · por ${e.recebidaPor}`,
      cor: "bg-kraft",
    },
  ];

  if (e.avisoWhatsAppEm) {
    passos.push({
      chave: "aviso",
      titulo: "Aviso aberto no WhatsApp",
      detalhe: formatarRelativo(e.avisoWhatsAppEm),
      cor: "bg-info",
    });
  } else if (e.status === "aguardando") {
    passos.push({
      chave: "aviso",
      titulo: "Morador ainda não avisado pelo WhatsApp",
      detalhe: "Ele também vê a encomenda ao abrir o app.",
      cor: "",
      pendente: true,
    });
  }

  if (e.status === "entregue" && e.entregueEm) {
    const doc = e.retiradaPorTerceiro && e.retiradaTerceiroDoc ? ` · doc ${e.retiradaTerceiroDoc}` : "";
    passos.push({
      chave: "entregue",
      titulo: "Entregue",
      detalhe: `${formatarRelativo(e.entregueEm)} · por ${e.entreguePor ?? "—"} · para ${e.retiradaPor ?? "—"}${
        e.retiradaPorTerceiro ? ` (terceiro${doc})` : ""
      }`,
      cor: "bg-ok",
    });
  } else if (e.status === "cancelada") {
    passos.push({
      chave: "cancelada",
      titulo: "Cancelada",
      detalhe: `${e.canceladaEm ? `${formatarRelativo(e.canceladaEm)} · ` : ""}${e.canceladaMotivo ?? "sem motivo registrado"}`,
      cor: "bg-ink-3",
    });
  } else {
    passos.push({
      chave: "espera",
      titulo: "Aguardando retirada",
      detalhe: formatarHa(e.recebidaEm),
      cor: e.parada ? "bg-warn" : "",
      pendente: !e.parada,
    });
  }

  return (
    <section className="rounded-[14px] border border-line bg-card p-4" aria-label="Linha do tempo">
      <h2 className="eyebrow mb-3">Linha do tempo</h2>
      <ol className="relative flex flex-col gap-4 border-l-2 border-line pl-5">
        {passos.map((p) => (
          <li key={p.chave} className="relative min-w-0">
            <span
              aria-hidden
              className={cn(
                "absolute -left-[27px] top-[5px] size-3 rounded-full ring-4 ring-card",
                p.cor,
                p.pendente && "border-2 border-ink-3 bg-card"
              )}
            />
            <div className={cn("font-semibold", p.pendente && "text-ink-2")}>{p.titulo}</div>
            <div className="break-words text-[15px] tabular-nums text-ink-2">{p.detalhe}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
