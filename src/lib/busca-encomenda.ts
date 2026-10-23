/**
 * Busca da portaria (23/10/2026) — função PURA, isomórfica (sem Prisma), para
 * servir tanto às consultas do servidor (`lib/encomendas.ts`) quanto às telas
 * client que filtram uma lista já carregada (ex.: "pendentes do apartamento"
 * na retirada). `encomendas.ts` reexporta `correspondeBusca` (contrato antigo).
 */
import type { EncomendaResumo } from "@/lib/encomendas";

export const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

type Pesquisavel = Pick<
  EncomendaResumo,
  "apartamento" | "codigo" | "destinatarioNome" | "transportadora" | "local" | "observacao" | "retiradaPor" | "tipoRotulo"
>;

/**
 * Cada palavra precisa casar (E). Casa com código (aceita "k7-m3"), apto (exato:
 * "11a" ou "11" para 11A/11B, nunca 111A), destinatário, transportadora, local,
 * observação, quem retirou e o tipo. Sem acento/caixa.
 */
export function correspondeBusca(e: Pesquisavel, busca: string | undefined | null): boolean {
  const termos = semAcento(busca ?? "").split(/\s+/).filter(Boolean);
  if (termos.length === 0) return true;
  const apto = e.apartamento.toLowerCase();
  const codigo = e.codigo.toLowerCase();
  const textos = [e.destinatarioNome, e.transportadora, e.local, e.observacao, e.retiradaPor, e.tipoRotulo]
    .filter((x): x is string => !!x)
    .map(semAcento);
  return termos.every((t) => {
    if (/^\d+[a-z]$/.test(t) && apto === t) return true;
    if (/^\d+$/.test(t) && apto.slice(0, -1) === t) return true;
    const semHifen = t.replace(/[-_]/g, "");
    if (semHifen && codigo.includes(semHifen)) return true;
    return textos.some((x) => x.includes(t));
  });
}
