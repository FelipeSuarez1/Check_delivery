/**
 * /portaria/historico/[apto] - tudo o que já passou por um apartamento
 * (23/10/2026): moradores, resumo do período (padrão: este ano) e a tabela.
 * Serve ao porteiro ("a Dona Flavia disse que chegou algo semana passada") e ao
 * síndico (filtro "só paradas" e exportação em CSV, só para o admin).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Search, TriangleAlert } from "lucide-react";
import { CartaoNumero, ChipLink, Segmentado, TabelaHistorico } from "../comum";
import { hrefFiltros, intervaloEmTexto, lerFiltros, periodoDoFiltro, rotuloPeriodo } from "../filtros";
import { qs, type SearchParams } from "../../params";
import { classeBotao } from "@/components/portaria/botao";
import { EstadoVazio } from "@/components/portaria/estado-vazio";
import { LinkVoltar } from "@/components/portaria/link-voltar";
import { exigirPapelNaPagina } from "@/lib/auth";
import { partesLocais } from "@/lib/datas";
import { ROTULO_STATUS, STATUS } from "@/lib/encomenda-constantes";
import {
  buscarApartamentoPorNumero,
  listarAguardando,
  listarHistoricoApartamento,
  listarMoradoresDoApartamento,
} from "@/lib/encomendas";
import { formatarDuracaoCurta, resumirHistorico } from "@/lib/historico-portaria";

export const metadata: Metadata = { title: "Histórico do apartamento" };

const LIMITE_CONSULTA = 1000;
const LIMITE_TABELA = 300;

export default async function HistoricoApartamentoPage({
  params,
  searchParams,
}: {
  params: Promise<{ apto: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const sessao = await exigirPapelNaPagina("portaria", "admin");
  const { apto: aptoTexto } = await params;
  const apto = await buscarApartamentoPorNumero(aptoTexto);
  if (!apto) notFound();

  const base = `/portaria/historico/${apto.numero}`;
  const f = lerFiltros(await searchParams, "ano");

  const [todas, moradores, aguardandoAgora] = await Promise.all([
    listarHistoricoApartamento(apto.id, periodoDoFiltro(f), { limite: LIMITE_CONSULTA }),
    listarMoradoresDoApartamento(apto.id),
    listarAguardando({ apartamentoId: apto.id }),
  ]);
  const filtradas = f.status ? todas.filter((e) => e.status === f.status) : todas;
  const lista = f.paradas ? filtradas.filter((e) => e.status === "aguardando" && e.parada) : filtradas;
  const resumo = resumirHistorico(todas);
  const visiveis = lista.slice(0, LIMITE_TABELA);
  const anoAtual = partesLocais(new Date()).ano;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <LinkVoltar href="/portaria/historico">Histórico</LinkVoltar>
        <h1 className="text-2xl">
          Apto {apto.numero} <span className="font-medium text-ink-2">· Torre {apto.torre}</span>
        </h1>
        <span className="min-w-0 text-ink-3">
          {moradores.length > 0 ? moradores.map((m) => m.nome).join(" · ") : "Nenhum morador cadastrado"}
        </span>
        <span className="flex-1" />
        <form action="/portaria/historico" method="get" role="search" className="relative w-full md:w-[260px]">
          <label htmlFor="outro-apto" className="sr-only">
            Ver outro apartamento
          </label>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            id="outro-apto"
            name="q"
            type="search"
            enterKeyHint="go"
            autoComplete="off"
            maxLength={10}
            placeholder="outro apartamento…"
            className="h-12 w-full rounded-[10px] border border-line bg-card pl-10 pr-3 text-[15px] outline-none placeholder:text-ink-3 focus-visible:border-kraft focus-visible:ring-3 focus-visible:ring-kraft/30"
          />
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Segmentado
          rotulo="Período"
          itens={[
            { chave: "30", texto: "30 dias", href: hrefFiltros(base, f, { periodo: "30" }), ligado: f.periodo === "30" },
            { chave: "ano", texto: String(anoAtual), href: hrefFiltros(base, f, { periodo: "ano" }), ligado: f.periodo === "ano" },
            { chave: "tudo", texto: "Tudo", href: hrefFiltros(base, f, { periodo: "tudo" }), ligado: f.periodo === "tudo" },
          ]}
        />
        <Segmentado
          rotulo="Situação"
          itens={[
            { chave: "todos", texto: "Todas", href: hrefFiltros(base, f, { status: undefined, paradas: false }), ligado: !f.status && !f.paradas },
            ...STATUS.map((s) => ({
              chave: s,
              texto: ROTULO_STATUS[s],
              href: hrefFiltros(base, f, { status: s, paradas: false }),
              ligado: f.status === s && !f.paradas,
            })),
          ]}
        />
        <ChipLink aviso ligado={f.paradas} href={hrefFiltros(base, f, { paradas: !f.paradas, status: undefined })}>
          <TriangleAlert className="size-3.5" aria-hidden /> Só paradas
        </ChipLink>
        <span className="flex-1" />
        {sessao.papel === "admin" && (
          <a href={`/admin/exportar${qs({ ...intervaloEmTexto(f), torre: apto.torre, apto: apto.numero, status: f.status })}`} className={classeBotao()}>
            <Download aria-hidden /> Exportar CSV
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CartaoNumero
          rotulo={`Encomendas ${rotuloPeriodo(f)}`}
          valor={String(resumo.recebidas)}
          sub={resumo.canceladas > 0 ? `+ ${resumo.canceladas} cancelada${resumo.canceladas > 1 ? "s" : ""}` : null}
        />
        <CartaoNumero
          rotulo="Na portaria agora"
          valor={String(aguardandoAgora.length)}
          destaque
          sub={
            aguardandoAgora.some((e) => e.parada)
              ? `${aguardandoAgora.filter((e) => e.parada).length} há 3 dias ou mais`
              : null
          }
          subAviso
        />
        <CartaoNumero
          rotulo="Tempo médio p/ retirar"
          valor={resumo.tempoMedioMs === null ? "—" : formatarDuracaoCurta(resumo.tempoMedioMs)}
        />
        <CartaoNumero
          rotulo="Quem mais recebe"
          pequeno
          valor={resumo.quemMaisRecebe ? `${resumo.quemMaisRecebe.nome} · ${resumo.quemMaisRecebe.total}` : "—"}
        />
      </div>

      {lista.length === 0 ? (
        <EstadoVazio
          icone={<Search aria-hidden />}
          titulo={`Nenhuma encomenda do ${apto.numero} neste filtro`}
          texto="Tente outro período ou limpe os filtros."
          acao={
            <Link href={base} className={classeBotao()}>
              Limpar filtros
            </Link>
          }
        />
      ) : (
        <>
          <TabelaHistorico linhas={visiveis} mostrarApto={false} />
          {lista.length > LIMITE_TABELA && (
            <p className="text-[15px] text-ink-2">
              Mostrando as {LIMITE_TABELA} mais recentes de {lista.length}.
            </p>
          )}
        </>
      )}
    </>
  );
}
