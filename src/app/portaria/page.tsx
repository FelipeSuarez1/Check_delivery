/**
 * /portaria - "Aguardando" (23/10/2026): a tela que fica ligada o dia todo no
 * tablet. Duas ações sempre à mão (registrar · confirmar retirada) e, embaixo,
 * a lista do que está na portaria - mais antigas primeiro, paradas (3 dias ou
 * mais) com borda vermelha. `?aba=hoje` troca a lista pelas entregas de hoje.
 * Filtros na URL: ?q= (apto/nome/código) ?torre=A|B ?paradas=1.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { PackageCheck, Plus, ScanQrCode, TriangleAlert } from "lucide-react";
import { BuscaPortaria } from "./busca-client";
import { param, qs, type SearchParams } from "./params";
import { CardEncomenda } from "@/components/encomenda/card-encomenda";
import { CodigoEncomenda } from "@/components/encomenda/codigo-encomenda";
import { classeBotao } from "@/components/portaria/botao";
import { EstadoVazio } from "@/components/portaria/estado-vazio";
import { FaixaSemTurno } from "@/components/portaria/faixa-sem-turno";
import { exigirPapelNaPagina } from "@/lib/auth";
import { formatarHora } from "@/lib/datas";
import { correspondeBusca, listarAguardando, listarEntreguesHoje, type EncomendaResumo } from "@/lib/encomendas";
import { buscarTurnoAberto } from "@/lib/turno";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Aguardando" };

type Aba = "aguardando" | "hoje";

function href(f: { aba: Aba; q?: string; torre?: "A" | "B"; paradas?: boolean }): string {
  return `/portaria${qs({ aba: f.aba === "hoje" ? "hoje" : undefined, q: f.q, torre: f.torre, paradas: f.paradas })}`;
}

function ChipFiltro({ ligado, href, children, aviso }: { ligado: boolean; href: string; children: React.ReactNode; aviso?: boolean }) {
  return (
    <Link
      href={href}
      replace
      scroll={false}
      aria-current={ligado ? "true" : undefined}
      className={cn(
        "chip h-11 cursor-pointer transition-colors",
        aviso
          ? ligado
            ? "border-warn bg-warn text-white"
            : "border-warn text-warn hover:bg-warn-soft"
          : ligado
            ? "chip-on"
            : "hover:bg-muted"
      )}
    >
      {children}
    </Link>
  );
}

export default async function PortariaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await exigirPapelNaPagina("portaria", "admin");
  const sp = await searchParams;
  const aba: Aba = param(sp, "aba") === "hoje" ? "hoje" : "aguardando";
  const q = param(sp, "q", 60);
  const torreParam = param(sp, "torre");
  const torre = torreParam === "A" || torreParam === "B" ? torreParam : undefined;
  const soParadas = param(sp, "paradas") === "1";

  const turno = await buscarTurnoAberto();

  // Lista base (só a busca aplicada): os números dos chips acompanham a busca
  const base: EncomendaResumo[] =
    aba === "hoje"
      ? (await listarEntreguesHoje()).filter((e) => correspondeBusca(e, q))
      : await listarAguardando({ busca: q });

  const total = base.length;
  const totalA = base.filter((e) => e.torre === "A").length;
  const totalB = base.filter((e) => e.torre === "B").length;
  const totalParadas = base.filter((e) => e.parada).length;
  const lista = base
    .filter((e) => (torre ? e.torre === torre : true))
    .filter((e) => (aba === "aguardando" && soParadas ? e.parada : true));

  const temFiltro = !!q || !!torre || soParadas;
  const limpar = href({ aba });

  return (
    <>
      {!turno && <FaixaSemTurno />}

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/portaria/registrar" className={classeBotao({ variante: "primary", grande: true, className: "grow lg:grow-0" })}>
          <Plus strokeWidth={2.5} aria-hidden />
          Registrar encomenda
        </Link>
        <Link href="/portaria/retirada" className={classeBotao({ grande: true, className: "grow lg:grow-0" })}>
          <ScanQrCode aria-hidden />
          Confirmar retirada
        </Link>
        <span className="hidden flex-1 lg:block" />
        <BuscaPortaria className="w-full lg:w-[300px]" />
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <ChipFiltro ligado={!torre && !soParadas} href={href({ aba, q })}>
          Todas · {total}
        </ChipFiltro>
        <ChipFiltro ligado={torre === "A"} href={href({ aba, q, torre: "A" })}>
          Torre A · {totalA}
        </ChipFiltro>
        <ChipFiltro ligado={torre === "B"} href={href({ aba, q, torre: "B" })}>
          Torre B · {totalB}
        </ChipFiltro>
        {aba === "aguardando" && (
          <ChipFiltro aviso ligado={soParadas} href={href({ aba, q, torre, paradas: !soParadas })}>
            <TriangleAlert className="size-3.5" aria-hidden />
            Há mais de 3 dias · {totalParadas}
          </ChipFiltro>
        )}
        <span className="flex-1" />
        <span className="hidden text-[13px] text-ink-3 md:inline">
          {aba === "hoje" ? "mais recentes primeiro" : "mais antigas primeiro"}
        </span>
      </div>

      {lista.length === 0 ? (
        temFiltro ? (
          <EstadoVazio
            icone={<PackageCheck aria-hidden />}
            titulo="Nenhuma encomenda encontrada"
            texto={q ? `Nada combina com “${q}” nesta lista. Confira o apartamento, o nome ou o código.` : "Nenhuma encomenda neste filtro."}
            acao={
              <Link href={limpar} className={classeBotao()}>
                Limpar filtros
              </Link>
            }
          />
        ) : aba === "hoje" ? (
          <EstadoVazio
            icone={<PackageCheck aria-hidden />}
            titulo="Nenhuma entrega hoje ainda"
            texto="As encomendas entregues hoje aparecem aqui, com quem retirou e a hora."
          />
        ) : (
          <EstadoVazio
            icone={<PackageCheck aria-hidden />}
            titulo="Nada aguardando — portaria em dia"
            texto="Quando chegar uma encomenda, toque em “Registrar encomenda”."
          />
        )
      ) : aba === "hoje" ? (
        <EntreguesHoje lista={lista} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3" aria-label="Encomendas aguardando">
          {lista.map((e) => (
            <li key={e.id} className="min-w-0">
              <CardEncomenda encomenda={e} href={`/portaria/encomenda/${e.id}`} className="h-full" />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function EntreguesHoje({ lista }: { lista: EncomendaResumo[] }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-card">
      <div className="overflow-x-auto [contain:layout]">
        <table className="w-full min-w-[760px] border-collapse text-[15px]">
          <thead>
            <tr>
              {["Hora", "Código", "Apto", "Para", "Retirou", "Entregue por", "Tipo"].map((t) => (
                <th
                  key={t}
                  scope="col"
                  className="border-b border-line px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[.08em] text-ink-3"
                >
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lista.map((e) => (
              <tr key={e.id} className="border-b border-line last:border-0 hover:bg-paper">
                <td className="px-3 py-3 align-top tabular-nums">{e.entregueEm ? formatarHora(e.entregueEm) : "—"}</td>
                <td className="px-3 py-3 align-top">
                  <Link href={`/portaria/encomenda/${e.id}`} className="underline-offset-4 hover:underline">
                    <CodigoEncomenda codigo={e.codigo} size="sm" className="text-base" />
                  </Link>
                </td>
                <td className="px-3 py-3 align-top font-heading font-semibold">{e.apartamento}</td>
                <td className="px-3 py-3 align-top">{e.destinatarioNome}</td>
                <td className="px-3 py-3 align-top">
                  {e.retiradaPor ?? "—"}
                  {e.retiradaPorTerceiro && <span className="ml-1.5 text-[13px] text-ink-2">(terceiro)</span>}
                </td>
                <td className="px-3 py-3 align-top text-ink-2">{e.entreguePor ?? "—"}</td>
                <td className="px-3 py-3 align-top text-ink-2">
                  {[e.tipoRotulo, e.transportadora].filter(Boolean).join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
