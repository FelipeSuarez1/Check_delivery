import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CircleCheck, UserRound } from "lucide-react";
import { AtualizaPeriodico } from "@/components/atualiza-periodico";
import { exigirPapelNaPagina } from "@/lib/auth";
import { carregarPainel, PARADAS_NA_LISTA } from "@/lib/admin";
import { formatarDuracao, resumirUserAgent } from "@/lib/admin-formato";
import { formatarDataHora, formatarHora, formatarRelativo } from "@/lib/datas";
import { PARADA_DIAS } from "@/lib/encomenda-constantes";
import { cn } from "@/lib/utils";
import { SeloTipoEvento } from "./_componentes/tipo-evento";
import { CARTAO, CabecalhoPagina, Selo, TD, TH, TabelaRolavel } from "./_componentes/ui-admin";

export const metadata: Metadata = { title: "Painel" };

function Rotulo({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

/** Detalhe curto para o painel: user-agent vira "Chrome 156 · Windows"; texto longo é cortado. */
function resumirDetalhe(detalhe: string | null): string | null {
  if (!detalhe) return null;
  const ua = resumirUserAgent(detalhe);
  if (ua) return `Entrou pelo ${ua}`;
  return detalhe.length > 140 ? `${detalhe.slice(0, 140)}…` : detalhe;
}

const NUMERO_GRANDE = "font-heading text-5xl leading-none font-semibold tabular-nums";

export default async function AdminPage() {
  await exigirPapelNaPagina("admin");
  const p = await carregarPainel();
  const maisAntiga = p.paradas.itens[0]?.dias ?? null;
  const restantes = p.paradas.total - p.paradas.itens.length;

  return (
    <>
      {/* o painel é visto o dia todo: relê os números sozinho (preserva a rolagem) */}
      <AtualizaPeriodico segundos={60} />

      <CabecalhoPagina
        titulo="Painel"
        descricao={
          <>
            A portaria agora e nos últimos dias. Atualiza sozinho a cada minuto · última leitura às{" "}
            <span className="tabular-nums">{formatarHora(p.geradoEm)}</span>.
          </>
        }
      />

      {/* turno */}
      <section
        aria-label="Turno da portaria"
        className={cn(CARTAO, "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3", !p.turno && "border-warn/40 bg-warn-soft")}
      >
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            p.turno ? "bg-ok-soft text-ok" : "bg-warn/10 text-warn"
          )}
        >
          <UserRound className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <Rotulo>Turno aberto</Rotulo>
          {p.turno ? (
            <p className="text-base">
              <b>{p.turno.porteiroNome}</b> <span className="text-ink-2">· desde {formatarRelativo(p.turno.inicioISO)}</span>
            </p>
          ) : (
            <p className="text-base font-semibold text-warn">Nenhum turno aberto — a portaria precisa escolher o porteiro.</p>
          )}
        </div>
        <Link
          href="/portaria"
          className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-line bg-card px-4 text-sm font-semibold hover:bg-muted"
        >
          Abrir a portaria
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </section>

      {/* números */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <section aria-label="Aguardando agora" className={cn(CARTAO, "space-y-3 p-4")}>
          <Rotulo>Aguardando agora</Rotulo>
          <p className={NUMERO_GRANDE} data-testid="aguardando-total">
            {p.aguardando.total}
          </p>
          <div className="flex flex-wrap gap-2">
            <Selo tom="kraft">Torre A · {p.aguardando.torreA}</Selo>
            <Selo tom="kraft">Torre B · {p.aguardando.torreB}</Selo>
          </div>
        </section>

        <section
          aria-label="Paradas"
          className={cn(CARTAO, "space-y-3 p-4", p.paradas.total > 0 && "border-warn/40 bg-warn-soft")}
        >
          <Rotulo>Paradas há {PARADA_DIAS} dias ou mais</Rotulo>
          <p className={cn(NUMERO_GRANDE, p.paradas.total > 0 && "text-warn")} data-testid="paradas-total">
            {p.paradas.total}
          </p>
          <p className={cn("text-sm", p.paradas.total > 0 ? "text-warn" : "text-ink-2")}>
            {p.paradas.total > 0
              ? `A mais antiga está há ${maisAntiga} ${maisAntiga === 1 ? "dia" : "dias"} na portaria.`
              : "Nenhuma — tudo em dia."}
          </p>
        </section>

        <section aria-label="Entregues" className={cn(CARTAO, "space-y-3 p-4")}>
          <Rotulo>Entregues</Rotulo>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["Hoje", p.entregues.hoje],
                ["7 dias", p.entregues.dias7],
                ["30 dias", p.entregues.dias30],
              ] as const
            ).map(([rotulo, valor]) => (
              <div key={rotulo}>
                <p className="font-heading text-3xl leading-none font-semibold tabular-nums">{valor}</p>
                <p className="mt-1.5 text-xs text-ink-2">{rotulo}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-3">Dias de calendário, contando hoje.</p>
        </section>

        <section aria-label="Tempo médio para retirar" className={cn(CARTAO, "space-y-3 p-4")}>
          <Rotulo>Tempo médio para retirar</Rotulo>
          <p className={cn(NUMERO_GRANDE, "text-4xl sm:text-5xl")} data-testid="tempo-medio">
            {formatarDuracao(p.tempoMedioMs)}
          </p>
          <p className="text-sm text-ink-2">
            {p.entregues.dias30 > 0
              ? `Da chegada à retirada, em ${p.entregues.dias30} entrega${p.entregues.dias30 === 1 ? "" : "s"} dos últimos 30 dias.`
              : "Sem entregas nos últimos 30 dias."}
          </p>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* paradas */}
        <section aria-labelledby="titulo-paradas" className="min-w-0 space-y-2 lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="titulo-paradas" className="font-heading text-lg font-semibold">
              Encomendas paradas
            </h2>
            <span className="text-xs text-ink-3">Aguardando há {PARADA_DIAS} dias ou mais · mais antigas primeiro</span>
          </div>
          {p.paradas.itens.length === 0 ? (
            <div className="flex items-center gap-3 rounded-[14px] border border-dashed border-line px-4 py-8 text-sm text-ink-2">
              <CircleCheck className="size-6 shrink-0 text-ok" aria-hidden />
              Nenhuma encomenda parada. Quem chegou está sendo retirado dentro do prazo.
            </div>
          ) : (
            <div className={cn(CARTAO, "overflow-hidden")}>
              <TabelaRolavel>
                <thead className="border-b border-line bg-paper">
                  <tr>
                    <th className={TH}>Código</th>
                    <th className={TH}>Apto</th>
                    <th className={TH}>Para</th>
                    <th className={TH}>Volume</th>
                    <th className={TH}>Recebida</th>
                    <th className={cn(TH, "text-right")}>Parada</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {p.paradas.itens.map((e) => (
                    <tr key={e.id}>
                      <td className={TD}>
                        <Link
                          href={`/portaria/encomenda/${e.id}`}
                          className="codigo inline-flex min-h-11 items-center text-base text-kraft-ink underline decoration-kraft/40 underline-offset-4 hover:decoration-kraft"
                          aria-label={`Abrir a encomenda ${e.codigo}`}
                        >
                          {e.codigo}
                        </Link>
                      </td>
                      <td className={cn(TD, "codigo")}>{e.apartamento}</td>
                      <td className={cn(TD, "max-w-[14rem] truncate")} title={e.destinatario}>
                        {e.destinatario}
                      </td>
                      <td className={cn(TD, "text-ink-2")}>
                        {e.tipoRotulo}
                        {e.transportadora && <span className="text-ink-3"> · {e.transportadora}</span>}
                      </td>
                      <td className={cn(TD, "text-xs tabular-nums whitespace-nowrap text-ink-2")}>{formatarDataHora(e.recebidaEm)}</td>
                      <td className={cn(TD, "text-right")}>
                        <Selo tom="aviso">
                          {e.dias} {e.dias === 1 ? "dia" : "dias"}
                        </Selo>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TabelaRolavel>
              {restantes > 0 && (
                <p className="border-t border-line bg-paper px-4 py-2.5 text-xs text-ink-2">
                  Mostrando as {PARADAS_NA_LISTA} mais antigas · e mais {restantes} parada{restantes === 1 ? "" : "s"} na portaria.
                </p>
              )}
            </div>
          )}
        </section>

        {/* por porteiro */}
        <section aria-labelledby="titulo-porteiros" className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="titulo-porteiros" className="font-heading text-lg font-semibold">
              Por porteiro (30 dias)
            </h2>
          </div>
          {p.porPorteiro.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-line px-4 py-8 text-sm text-ink-2">
              Nenhum porteiro cadastrado.{" "}
              <Link href="/admin/porteiros" className="font-semibold text-kraft-ink underline">
                Cadastrar porteiros
              </Link>
            </div>
          ) : (
            <div className={cn(CARTAO, "overflow-hidden")}>
              <TabelaRolavel>
                <thead className="border-b border-line bg-paper">
                  <tr>
                    <th className={TH}>Porteiro</th>
                    <th className={cn(TH, "text-right")}>Recebidas</th>
                    <th className={cn(TH, "text-right")}>Entregues</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {p.porPorteiro.map((x) => (
                    <tr key={x.id} className={cn(!x.ativo && "text-ink-3")}>
                      <td className={cn(TD, "font-semibold")}>
                        {x.nome}
                        {!x.ativo && <span className="ml-2 text-xs font-normal">(inativo)</span>}
                      </td>
                      <td className={cn(TD, "text-right tabular-nums")}>{x.recebidas}</td>
                      <td className={cn(TD, "text-right tabular-nums")}>{x.entregues}</td>
                    </tr>
                  ))}
                </tbody>
              </TabelaRolavel>
              <p className="border-t border-line bg-paper px-4 py-2.5 text-xs text-ink-2">
                Canceladas não entram na contagem de recebidas.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* últimos eventos */}
      <section aria-labelledby="titulo-eventos" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="titulo-eventos" className="font-heading text-lg font-semibold">
            Últimos eventos
          </h2>
          <Link href="/admin/logs" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-kraft-ink underline">
            Ver todos os logs
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
        {p.eventos.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-line px-4 py-8 text-sm text-ink-2">
            Ainda não há eventos registrados.
          </div>
        ) : (
          <div className={cn(CARTAO, "overflow-hidden")}>
            <TabelaRolavel larguraMin="min-w-[44rem]">
              <thead className="border-b border-line bg-paper">
                <tr>
                  <th className={TH}>Quando</th>
                  <th className={TH}>Tipo</th>
                  <th className={TH}>Usuário</th>
                  <th className={cn(TH, "w-full")}>Detalhe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {p.eventos.map((e) => (
                  <tr key={e.id}>
                    <td className={cn(TD, "text-xs tabular-nums whitespace-nowrap text-ink-2")}>{formatarRelativo(e.quando)}</td>
                    <td className={TD}>
                      <SeloTipoEvento tipo={e.tipo} />
                    </td>
                    <td className={cn(TD, "font-semibold whitespace-nowrap")}>{e.usuarioNome}</td>
                    <td className={cn(TD, "text-ink-2 [overflow-wrap:anywhere]")} title={e.detalhe ?? undefined}>
                      {resumirDetalhe(e.detalhe) ?? <span className="text-ink-3">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TabelaRolavel>
          </div>
        )}
      </section>
    </>
  );
}
