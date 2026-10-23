/**
 * /portaria/historico - histórico geral (23/10/2026): todas as encomendas do
 * condomínio, com período, torre, status, "só paradas" e busca. Digitar um
 * apartamento exato (ex.: 11A) leva a /portaria/historico/11A. O admin ganha o
 * link de exportação em CSV (a rota /admin/exportar é do painel).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, Search, TriangleAlert } from "lucide-react";
import { CartaoNumero, ChipLink, Segmentado, TabelaHistorico } from "./comum";
import { hrefFiltros, intervaloEmTexto, lerFiltros, periodoDoFiltro, rotuloPeriodo, type FiltrosHistorico } from "./filtros";
import { type SearchParams } from "../params";
import { classeBotao } from "@/components/portaria/botao";
import { EstadoVazio } from "@/components/portaria/estado-vazio";
import { exigirPapelNaPagina } from "@/lib/auth";
import { STATUS, ROTULO_STATUS } from "@/lib/encomenda-constantes";
import { buscarApartamentoPorNumero, listarAguardando, listarHistoricoGeral } from "@/lib/encomendas";
import { formatarDuracaoCurta, resumirHistorico } from "@/lib/historico-portaria";
import { qs } from "../params";

export const metadata: Metadata = { title: "Histórico" };

const BASE = "/portaria/historico";
const LIMITE_CONSULTA = 1000;
const LIMITE_TABELA = 300;

export default async function HistoricoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sessao = await exigirPapelNaPagina("portaria", "admin");
  const f = lerFiltros(await searchParams, "30");

  // "11A" digitado na busca = ir para o histórico daquele apartamento
  const m = f.q ? /^(\d{1,3})\s*([abAB])$/.exec(f.q.trim()) : null;
  if (m) {
    const apto = await buscarApartamentoPorNumero(`${m[1]}${m[2]}`);
    if (apto) redirect(`${BASE}/${apto.numero}`);
  }

  const periodo = periodoDoFiltro(f);
  const [consulta, aguardandoAgora] = await Promise.all([
    listarHistoricoGeral(periodo, { torre: f.torre, status: f.status, busca: f.q, limite: LIMITE_CONSULTA }),
    listarAguardando({ torre: f.torre, busca: f.q }),
  ]);
  const lista = f.paradas ? consulta.filter((e) => e.status === "aguardando" && e.parada) : consulta;
  const resumo = resumirHistorico(lista);
  const paradasAgora = aguardandoAgora.filter((e) => e.parada).length;
  const visiveis = lista.slice(0, LIMITE_TABELA);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-2xl">Histórico</h1>
        <span className="text-ink-3">todas as encomendas · {rotuloPeriodo(f)}</span>
        <span className="flex-1" />
        <form action={BASE} method="get" role="search" className="relative w-full md:w-[340px]">
          <FiltrosOcultos f={f} sem="q" />
          <label htmlFor="busca-historico" className="sr-only">
            Buscar por apartamento, nome ou código
          </label>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            id="busca-historico"
            name="q"
            type="search"
            defaultValue={f.q ?? ""}
            enterKeyHint="search"
            autoComplete="off"
            maxLength={60}
            placeholder="apto (11A), nome ou código"
            className="h-12 w-full rounded-[10px] border border-line bg-card pl-10 pr-24 text-[15px] outline-none placeholder:text-ink-3 focus-visible:border-kraft focus-visible:ring-3 focus-visible:ring-kraft/30"
          />
          <button type="submit" className={classeBotao({ variante: "escuro", className: "absolute right-1 top-1 h-10 px-3.5 text-sm" })}>
            Buscar
          </button>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Segmentado
          rotulo="Período"
          itens={[
            { chave: "7", texto: "7 dias", href: hrefFiltros(BASE, f, { periodo: "7" }), ligado: f.periodo === "7" },
            { chave: "30", texto: "30 dias", href: hrefFiltros(BASE, f, { periodo: "30" }), ligado: f.periodo === "30" },
            { chave: "90", texto: "90 dias", href: hrefFiltros(BASE, f, { periodo: "90" }), ligado: f.periodo === "90" },
            { chave: "ano", texto: "Este ano", href: hrefFiltros(BASE, f, { periodo: "ano" }), ligado: f.periodo === "ano" },
            { chave: "tudo", texto: "Tudo", href: hrefFiltros(BASE, f, { periodo: "tudo" }), ligado: f.periodo === "tudo" },
          ]}
        />
        <form action={BASE} method="get" className="flex flex-wrap items-center gap-2" aria-label="Período personalizado">
          <FiltrosOcultos f={f} sem="datas" />
          <label className="flex items-center gap-2 text-sm font-semibold text-ink-2">
            De
            <input
              type="date"
              name="de"
              defaultValue={intervaloEmTexto(f).de ?? ""}
              className="h-11 rounded-[10px] border border-line bg-card px-2.5 text-[15px] font-normal text-ink"
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink-2">
            até
            <input
              type="date"
              name="ate"
              defaultValue={intervaloEmTexto(f).ate ?? ""}
              className="h-11 rounded-[10px] border border-line bg-card px-2.5 text-[15px] font-normal text-ink"
            />
          </label>
          <button type="submit" className={classeBotao({ className: "h-11 px-4" })}>
            Aplicar
          </button>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Segmentado
          rotulo="Torre"
          itens={[
            { chave: "todas", texto: "Todas", href: hrefFiltros(BASE, f, { torre: undefined }), ligado: !f.torre },
            { chave: "A", texto: "Torre A", href: hrefFiltros(BASE, f, { torre: "A" }), ligado: f.torre === "A" },
            { chave: "B", texto: "Torre B", href: hrefFiltros(BASE, f, { torre: "B" }), ligado: f.torre === "B" },
          ]}
        />
        <Segmentado
          rotulo="Situação"
          itens={[
            { chave: "todos", texto: "Todas", href: hrefFiltros(BASE, f, { status: undefined, paradas: false }), ligado: !f.status && !f.paradas },
            ...STATUS.map((s) => ({
              chave: s,
              texto: ROTULO_STATUS[s],
              href: hrefFiltros(BASE, f, { status: s, paradas: false }),
              ligado: f.status === s && !f.paradas,
            })),
          ]}
        />
        <ChipLink aviso ligado={f.paradas} href={hrefFiltros(BASE, f, { paradas: !f.paradas, status: undefined })}>
          <TriangleAlert className="size-3.5" aria-hidden /> Só paradas
        </ChipLink>
        <span className="flex-1" />
        {sessao.papel === "admin" && (
          <a href={`/admin/exportar${qs({ ...intervaloEmTexto(f), torre: f.torre, status: f.status })}`} className={classeBotao()}>
            <Download aria-hidden /> Exportar CSV
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CartaoNumero
          rotulo="Recebidas no período"
          valor={String(resumo.recebidas)}
          sub={resumo.canceladas > 0 ? `+ ${resumo.canceladas} cancelada${resumo.canceladas > 1 ? "s" : ""}` : rotuloPeriodo(f)}
        />
        <CartaoNumero rotulo="Entregues" valor={String(resumo.entregues)} />
        <CartaoNumero
          rotulo="Aguardando agora"
          valor={String(aguardandoAgora.length)}
          destaque
          sub={paradasAgora > 0 ? `${paradasAgora} parada${paradasAgora > 1 ? "s" : ""} há 3 dias ou mais` : null}
          subAviso
        />
        <CartaoNumero
          rotulo="Tempo médio p/ retirar"
          valor={resumo.tempoMedioMs === null ? "—" : formatarDuracaoCurta(resumo.tempoMedioMs)}
        />
      </div>

      {lista.length === 0 ? (
        <EstadoVazio
          icone={<Search aria-hidden />}
          titulo="Nenhuma encomenda neste filtro"
          texto="Tente um período maior ou limpe os filtros."
          acao={
            <Link href={BASE} className={classeBotao()}>
              Limpar filtros
            </Link>
          }
        />
      ) : (
        <>
          <TabelaHistorico linhas={visiveis} mostrarApto />
          {lista.length > LIMITE_TABELA && (
            <p className="text-[15px] text-ink-2">
              Mostrando as {LIMITE_TABELA} mais recentes de {lista.length}. Use o período e os filtros para refinar.
            </p>
          )}
        </>
      )}
    </>
  );
}

/** Mantém os outros filtros ao enviar um formulário GET (cada form troca só o seu campo). */
function FiltrosOcultos({ f, sem }: { f: FiltrosHistorico; sem: "q" | "datas" }) {
  return (
    <>
      {f.periodo !== "custom" && <input type="hidden" name="periodo" value={f.periodo} />}
      {sem !== "datas" && f.de && <input type="hidden" name="de" value={f.de} />}
      {sem !== "datas" && f.ate && <input type="hidden" name="ate" value={f.ate} />}
      {f.torre && <input type="hidden" name="torre" value={f.torre} />}
      {f.status && <input type="hidden" name="status" value={f.status} />}
      {f.paradas && <input type="hidden" name="paradas" value="1" />}
      {sem !== "q" && f.q && <input type="hidden" name="q" value={f.q} />}
    </>
  );
}
