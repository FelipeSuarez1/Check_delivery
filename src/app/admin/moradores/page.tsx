import type { Metadata } from "next";
import Link from "next/link";
import { SearchX, Search } from "lucide-react";
import { exigirPapelNaPagina } from "@/lib/auth";
import { listarApartamentosAdmin } from "@/lib/admin";
import { Input } from "@/components/ui/input";
import { MoradoresClient, type SecaoTorre } from "./moradores-client";
import {
  BTN_SECUNDARIO,
  CAMPO,
  CHIP_FILTRO,
  CHIP_FILTRO_OFF,
  CHIP_FILTRO_ON,
  CabecalhoPagina,
  EstadoVazio,
  Selo,
} from "../_componentes/ui-admin";

export const metadata: Metadata = { title: "Moradores" };

type Params = Record<string, string | string[] | undefined>;

const um = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function MoradoresPage({ searchParams }: { searchParams: Promise<Params> }) {
  await exigirPapelNaPagina("admin");
  const sp = await searchParams;
  const q = um(sp.q).trim().slice(0, 80);
  const t = um(sp.torre).toUpperCase();
  const torre = t === "A" || t === "B" ? t : undefined;

  const { aptos, resumo, opcoes } = await listarApartamentosAdmin({ torre, q });
  const secoes: SecaoTorre[] = (["A", "B"] as const)
    .map((tt) => ({ torre: tt, aptos: aptos.filter((a) => a.torre === tt) }))
    .filter((s) => s.aptos.length > 0);

  const href = (novaTorre?: "A" | "B") => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (novaTorre) p.set("torre", novaTorre);
    const s = p.toString();
    return s ? `/admin/moradores?${s}` : "/admin/moradores";
  };

  return (
    <>
      <CabecalhoPagina
        titulo="Moradores"
        descricao={
          <>
            {resumo.apartamentos} apartamentos · {resumo.moradoresAtivos} moradores ativos
            {resumo.moradoresInativos > 0 && <> · {resumo.moradoresInativos} inativos</>}. Ninguém é apagado: quem saiu fica
            desativado e o histórico de encomendas continua inteiro.
          </>
        }
      >
        {resumo.semTelefone > 0 && <Selo tom="aviso">{resumo.semTelefone} sem telefone</Selo>}
        {resumo.recusaramWhatsApp > 0 && (
          <Selo tom="kraft">
            {resumo.recusaramWhatsApp} {resumo.recusaramWhatsApp === 1 ? "recusou" : "recusaram"} WhatsApp
          </Selo>
        )}
        {resumo.semMoradorAtivo > 0 && <Selo tom="aviso">{resumo.semMoradorAtivo} apto(s) sem morador ativo</Selo>}
      </CabecalhoPagina>

      <form method="get" action="/admin/moradores" role="search" className="flex flex-wrap items-center gap-2">
        {torre && <input type="hidden" name="torre" value={torre} />}
        <div className="relative min-w-[220px] flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Buscar por apto, nome ou telefone"
            aria-label="Buscar moradores"
            className={`${CAMPO} pl-9`}
            maxLength={80}
            autoComplete="off"
          />
        </div>
        <button type="submit" className={BTN_SECUNDARIO}>
          Buscar
        </button>
        {(q || torre) && (
          <Link href="/admin/moradores" className="inline-flex h-11 items-center px-2 text-sm font-semibold text-kraft-ink underline">
            Limpar
          </Link>
        )}
        <nav aria-label="Filtrar por torre" className="flex gap-2 sm:ml-auto">
          {([undefined, "A", "B"] as const).map((tt) => (
            <Link
              key={tt ?? "todas"}
              href={href(tt)}
              aria-current={torre === tt ? "true" : undefined}
              className={`${CHIP_FILTRO} ${torre === tt ? CHIP_FILTRO_ON : CHIP_FILTRO_OFF}`}
            >
              {tt ? `Torre ${tt}` : "Todas"}
            </Link>
          ))}
        </nav>
      </form>

      {secoes.length === 0 ? (
        <EstadoVazio icone={<SearchX className="size-6 text-ink-3" aria-hidden />}>
          Nenhum apartamento ou morador encontrado{q ? <> para “{q}”</> : null}. Tente o número do apto (ex.: 11A) ou parte do nome.
        </EstadoVazio>
      ) : (
        <MoradoresClient secoes={secoes} opcoes={opcoes} />
      )}
    </>
  );
}
