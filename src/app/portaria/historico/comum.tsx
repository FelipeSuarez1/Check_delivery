/**
 * Peças compartilhadas do histórico (23/10/2026): segmentado em links, chip de
 * filtro, cartão de número e a tabela do mockup HistoricoApto. Server components.
 */
import Link from "next/link";
import { Check } from "lucide-react";
import { CodigoEncomenda } from "@/components/encomenda/codigo-encomenda";
import { StampStatus } from "@/components/encomenda/stamp-status";
import { CLASSE_SEG, classeSegItem } from "@/components/portaria/botao";
import { diasEntre, formatarDataHora } from "@/lib/datas";
import { PARADA_DIAS } from "@/lib/encomenda-constantes";
import type { EncomendaResumo } from "@/lib/encomendas";
import { cn } from "@/lib/utils";

export function Segmentado({
  rotulo,
  itens,
}: {
  rotulo: string;
  itens: { chave: string; texto: string; href: string; ligado: boolean }[];
}) {
  return (
    <nav aria-label={rotulo} className={cn(CLASSE_SEG, "max-w-full overflow-x-auto")}>
      {itens.map((i) => (
        <Link
          key={i.chave}
          href={i.href}
          replace
          scroll={false}
          aria-current={i.ligado ? "true" : undefined}
          className={classeSegItem(i.ligado)}
        >
          {i.texto}
        </Link>
      ))}
    </nav>
  );
}

export function ChipLink({
  href,
  ligado,
  aviso,
  children,
}: {
  href: string;
  ligado: boolean;
  aviso?: boolean;
  children: React.ReactNode;
}) {
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

export function CartaoNumero({
  rotulo,
  valor,
  destaque,
  sub,
  subAviso,
  pequeno,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
  sub?: string | null;
  subAviso?: boolean;
  /** valor em texto (ex. nome) usa fonte menor */
  pequeno?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[14px] border border-line bg-card p-4">
      <span className="eyebrow">{rotulo}</span>
      <span
        className={cn(
          "truncate font-heading font-semibold tabular-nums leading-tight",
          pequeno ? "text-[22px]" : "text-[28px]",
          destaque && "text-kraft-ink"
        )}
      >
        {valor}
      </span>
      {sub && <span className={cn("truncate text-[13px]", subAviso ? "font-semibold text-warn" : "text-ink-2")}>{sub}</span>}
    </div>
  );
}

function CelulaStatus({ e }: { e: EncomendaResumo }) {
  if (e.status === "entregue" && e.entregueEm) {
    const dias = diasEntre(e.recebidaEm, e.entregueEm);
    if (dias >= PARADA_DIAS) {
      return (
        <span className="stamp stamp-done">
          <Check className="size-3" aria-hidden /> Entregue · {dias} dias
        </span>
      );
    }
  }
  return <StampStatus status={e.status} diasParada={e.diasParada} />;
}

const TH = "border-b border-line px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[.08em] text-ink-3";
const TD = "px-3 py-3 align-top";

export function TabelaHistorico({
  linhas,
  mostrarApto,
}: {
  linhas: EncomendaResumo[];
  /** no histórico geral há a coluna do apartamento; no do apto ela é redundante */
  mostrarApto: boolean;
}) {
  const colunas = ["Código", ...(mostrarApto ? ["Apto"] : []), "Recebida", "Para", "Entregue", "Retirou", "Tipo", "Status"];
  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-card">
      <div className="overflow-x-auto [contain:layout]">
        <table className="w-full min-w-[980px] border-collapse text-[15px]">
          <thead>
            <tr>
              {colunas.map((c) => (
                <th key={c} scope="col" className={TH}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((e) => {
              return (
                <tr key={e.id} className="border-b border-line last:border-0 hover:bg-paper">
                  <td className={TD}>
                    <Link
                      href={`/portaria/encomenda/${e.id}`}
                      aria-label={`Abrir a encomenda ${e.codigo}`}
                      className="underline-offset-4 hover:underline"
                    >
                      <CodigoEncomenda codigo={e.codigo} size="sm" className="text-base text-ink" />
                    </Link>
                  </td>
                  {mostrarApto && (
                    <td className={cn(TD, "font-heading font-semibold")}>
                      <Link href={`/portaria/historico/${e.apartamento}`} className="underline-offset-4 hover:text-kraft-ink hover:underline">
                        {e.apartamento}
                      </Link>
                    </td>
                  )}
                  <td className={cn(TD, "whitespace-nowrap tabular-nums")}>
                    {formatarDataHora(e.recebidaEm)} · {e.recebidaPor}
                  </td>
                  <td className={TD}>{e.destinatarioNome}</td>
                  <td className={cn(TD, "whitespace-nowrap tabular-nums")}>
                    {e.entregueEm ? `${formatarDataHora(e.entregueEm)} · ${e.entreguePor ?? "—"}` : "—"}
                  </td>
                  <td className={TD}>
                    {e.retiradaPor ? (
                      e.retiradaPorTerceiro ? (
                        // o documento do terceiro só aparece no detalhe da encomenda
                        <>Terceiro: {e.retiradaPor}</>
                      ) : (
                        e.retiradaPor
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={cn(TD, "text-ink-2")}>{[e.tipoRotulo, e.transportadora].filter(Boolean).join(" · ")}</td>
                  <td className={TD}>
                    <CelulaStatus e={e} />
                    {e.status === "cancelada" && e.canceladaMotivo && (
                      <div className="mt-1 max-w-[190px] break-words text-[13px] text-ink-2">{e.canceladaMotivo}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
