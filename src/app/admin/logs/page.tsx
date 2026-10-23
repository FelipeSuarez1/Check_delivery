import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText, Search } from "lucide-react";
import { exigirPapelNaPagina } from "@/lib/auth";
import { LIMITE_EVENTOS, listarEventos } from "@/lib/admin";
import { resumirUserAgent } from "@/lib/admin-formato";
import { formatarDataHoraCompleta } from "@/lib/datas";
import { normalizarPapel, ROTULO_PAPEL } from "@/lib/papeis";
import { Input } from "@/components/ui/input";
import { SeloTipoEvento, TIPOS_EVENTO } from "../_componentes/tipo-evento";
import {
  BTN_SECUNDARIO,
  CAMPO,
  CARTAO,
  CabecalhoPagina,
  EstadoVazio,
  SELECT_NATIVO,
  TD,
  TH,
  TabelaRolavel,
} from "../_componentes/ui-admin";

export const metadata: Metadata = { title: "Logs" };

type Params = Record<string, string | string[] | undefined>;
const um = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function LogsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await exigirPapelNaPagina("admin");
  const sp = await searchParams;
  const tipo = um(sp.tipo).trim().slice(0, 30);
  const usuario = um(sp.usuario).trim().slice(0, 60);
  const q = um(sp.q).trim().slice(0, 80);

  const { eventos, truncado } = await listarEventos({ tipo, usuario, q });
  const filtrando = !!(tipo || usuario || q);

  return (
    <>
      <CabecalhoPagina
        titulo="Logs"
        descricao={`O livro do sistema: quem fez o quê e quando (horário de Brasília). Os ${LIMITE_EVENTOS} eventos mais recentes; senhas nunca são gravadas.`}
      />

      <form method="get" action="/admin/logs" role="search" className="flex flex-wrap items-center gap-2">
        <select name="tipo" defaultValue={tipo} aria-label="Filtrar por tipo" className={`${SELECT_NATIVO} min-w-44`}>
          <option value="">Todos os tipos</option>
          {TIPOS_EVENTO.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.rotulo}
            </option>
          ))}
        </select>
        <Input
          name="usuario"
          defaultValue={usuario}
          placeholder="Usuário (nome ou login)"
          aria-label="Filtrar por usuário"
          className={`${CAMPO} sm:w-56`}
          maxLength={60}
          autoComplete="off"
        />
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Buscar no detalhe ou na rota"
            aria-label="Buscar nos eventos"
            className={`${CAMPO} pl-9`}
            maxLength={80}
            autoComplete="off"
          />
        </div>
        <button type="submit" className={BTN_SECUNDARIO}>
          Filtrar
        </button>
        {filtrando && (
          <Link href="/admin/logs" className="inline-flex h-11 items-center px-2 text-sm font-semibold text-kraft-ink underline">
            Limpar
          </Link>
        )}
      </form>

      {eventos.length === 0 ? (
        <EstadoVazio icone={<ScrollText className="size-6 text-ink-3" aria-hidden />}>
          {filtrando ? "Nenhum evento com esses filtros." : "Ainda não há eventos registrados."}
        </EstadoVazio>
      ) : (
        <>
          <p className="text-sm text-ink-2">
            <b className="text-ink tabular-nums">{eventos.length}</b> evento{eventos.length === 1 ? "" : "s"}
            {truncado && <> (há mais antigos — refine os filtros para encontrá-los)</>}.
          </p>
          <div className={`${CARTAO} overflow-hidden`}>
            <TabelaRolavel larguraMin="min-w-[64rem]">
              <thead className="border-b border-line bg-paper">
                <tr>
                  <th className={TH}>Quando</th>
                  <th className={TH}>Tipo</th>
                  <th className={TH}>Usuário</th>
                  <th className={TH}>Rota</th>
                  <th className={`${TH} w-full`}>Detalhe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {eventos.map((e) => {
                  const papel = normalizarPapel(e.papel);
                  return (
                    <tr key={e.id} className="align-top">
                      <td className={`${TD} text-xs tabular-nums whitespace-nowrap text-ink-2`}>
                        {formatarDataHoraCompleta(e.quando)}
                      </td>
                      <td className={TD}>
                        <SeloTipoEvento tipo={e.tipo} />
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>
                        <span className="font-semibold">{e.usuarioNome}</span>
                        {papel && <span className="ml-1.5 text-xs text-ink-3">{ROTULO_PAPEL[papel]}</span>}
                      </td>
                      <td className={`${TD} font-mono text-xs whitespace-nowrap text-ink-2`}>{e.rota}</td>
                      <td className={`${TD} text-ink-2 [overflow-wrap:anywhere]`} title={e.detalhe ?? undefined}>
                        {resumirUserAgent(e.detalhe) ? `Entrou pelo ${resumirUserAgent(e.detalhe)}` : (e.detalhe ?? <span className="text-ink-3">—</span>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TabelaRolavel>
          </div>
        </>
      )}
    </>
  );
}
