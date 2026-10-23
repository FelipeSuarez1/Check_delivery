import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirPapelNaPagina } from "@/lib/auth";
import { partesLocais } from "@/lib/datas";
import type { EncomendaResumo } from "@/lib/encomendas";
import {
  LIMITE_HISTORICO,
  anosComRegistro,
  apartamentoDaTela,
  historicoDoApartamento,
  nomeDoMes,
} from "@/lib/morador";
import { EscolherApartamento } from "../_componentes/escolher-apartamento";
import { FiltrosHistorico, type ChipFiltro } from "../_componentes/filtros-historico-client";
import { ItemHistorico } from "../_componentes/item-historico";

export const metadata: Metadata = { title: "Histórico" };

const texto = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

/** Monta "/app/historico?ano=…&q=…&apto=…" só com o que tem valor. */
function href(partes: { ano?: string; q?: string; apto?: string }): string {
  const p = new URLSearchParams();
  if (partes.ano) p.set("ano", partes.ano);
  if (partes.q) p.set("q", partes.q);
  if (partes.apto) p.set("apto", partes.apto);
  const s = p.toString();
  return s ? `/app/historico?${s}` : "/app/historico";
}

/**
 * Histórico do apartamento: tudo que já foi entregue ou cancelado, por mês.
 * `?ano=2026|tudo` e `?q=` filtram; o padrão é o ano mais recente com registro
 * (ou "Tudo" quando há busca). O apto vem da sessão; `?apto=` só vale para o admin.
 */
export default async function HistoricoPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const sessao = await exigirPapelNaPagina("morador", "admin");
  const sp = await searchParams;
  const apto = await apartamentoDaTela(sessao, sp.apto);
  if (!apto) {
    if (sessao.papel === "admin") return <EscolherApartamento rota="/app/historico" />;
    notFound();
  }
  const aptoDoAdmin = sessao.papel === "admin" ? apto.numero : "";

  const q = texto(sp.q).trim().replace(/\s+/g, " ").slice(0, 60);
  const anoPedido = texto(sp.ano).trim();
  const anos = await anosComRegistro(apto.id);

  // o que o morador escolheu de fato ("tudo", ou um ano que tenha registro); o resto é padrão
  const anoMantido =
    anoPedido === "tudo" ? "tudo" : /^\d{4}$/.test(anoPedido) && anos.includes(Number(anoPedido)) ? anoPedido : "";
  // sem escolha: a busca olha tudo; sem busca, o ano mais novo com registro
  const escolha: number | "tudo" =
    anoMantido === "tudo"
      ? "tudo"
      : anoMantido !== ""
        ? Number(anoMantido)
        : q !== "" || anos.length === 0
          ? "tudo"
          : anos[0];

  const itens = await historicoDoApartamento(apto.id, {
    ano: escolha === "tudo" ? undefined : escolha,
    q: q || undefined,
  });

  const chips: ChipFiltro[] = [
    ...anos.map((a) => ({
      rotulo: String(a),
      href: href({ ano: String(a), q, apto: aptoDoAdmin }),
      ativo: escolha === a,
    })),
    { rotulo: "Tudo", href: href({ ano: "tudo", q, apto: aptoDoAdmin }), ativo: escolha === "tudo" },
  ];

  // agrupa por mês (a lista já vem do mais recente para o mais antigo)
  const grupos: { chave: string; rotulo: string; itens: EncomendaResumo[] }[] = [];
  for (const e of itens) {
    const { ano, mes } = partesLocais(e.recebidaEm);
    const chave = `${ano}-${mes}`;
    let grupo = grupos.at(-1);
    if (!grupo || grupo.chave !== chave) {
      grupo = { chave, rotulo: escolha === "tudo" ? `${nomeDoMes(mes)} de ${ano}` : nomeDoMes(mes), itens: [] };
      grupos.push(grupo);
    }
    grupo.itens.push(e);
  }

  return (
    <>
      <div>
        <div className="eyebrow">Apto {apto.numero}</div>
        <h1 className="text-[22px]">Histórico</h1>
      </div>

      <FiltrosHistorico
        chips={chips}
        q={q}
        ano={anoMantido}
        apto={aptoDoAdmin}
        hrefLimpar={href({ ano: anoMantido, apto: aptoDoAdmin })}
      />

      {grupos.length > 0 ? (
        <div className="flex flex-col rounded-[14px] border border-line bg-card px-4 py-1">
          {grupos.map((g) => (
            <section key={g.chave} aria-label={g.rotulo} className="flex flex-col">
              <h2 className="eyebrow pt-3 pb-1 font-sans text-[11px] tracking-[.12em]">{g.rotulo}</h2>
              {g.itens.map((e) => (
                <ItemHistorico key={e.id} encomenda={e} />
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 rounded-[14px] border border-line bg-card px-5 py-8 text-center">
          <h2 className="text-[17px]">{q ? "Nada encontrado" : "Nada por aqui ainda"}</h2>
          <p className="text-[13px] text-ink-2">
            {q
              ? `Nenhuma encomenda entregue ou cancelada combina com “${q}”.`
              : "As encomendas que você retirar aparecem aqui."}
          </p>
          {q && (
            <Link
              href={href({ ano: anoMantido, apto: aptoDoAdmin })}
              className="mt-1 inline-flex h-11 items-center rounded-[10px] border border-line bg-card px-4 text-sm font-semibold hover:border-kraft"
            >
              Limpar busca
            </Link>
          )}
        </div>
      )}

      {itens.length >= LIMITE_HISTORICO && (
        <p className="text-center text-xs text-ink-3">Mostrando as {LIMITE_HISTORICO} mais recentes.</p>
      )}
      <p className="text-center text-xs text-ink-3">A foto fica guardada por 90 dias depois da entrega.</p>
    </>
  );
}
