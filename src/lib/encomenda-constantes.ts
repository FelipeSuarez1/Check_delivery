/**
 * Constantes e regras PURAS das encomendas (22/10/2026) — sem Prisma, sem node:*.
 * Existe separado de `encomendas.ts` porque componentes client (chips, cartões)
 * precisam de TIPOS/rótulos e importar `encomendas.ts` arrastaria o Prisma para
 * o bundle do navegador. `encomendas.ts` reexporta tudo daqui.
 */
import { diasEntre, type EntradaData } from "@/lib/datas";

export const TIPOS = ["caixa", "envelope", "sacola", "mercado", "perecivel"] as const;
export type TipoEncomenda = (typeof TIPOS)[number];

export const ROTULO_TIPO: Record<TipoEncomenda, string> = {
  caixa: "Caixa",
  envelope: "Envelope",
  sacola: "Sacola",
  mercado: "Mercado",
  perecivel: "Perecível",
};

export function ehTipo(v: unknown): v is TipoEncomenda {
  return typeof v === "string" && (TIPOS as readonly string[]).includes(v);
}

/** Rótulo de exibição; tipo desconhecido (dado antigo) vira o próprio texto capitalizado. */
export function rotuloTipo(tipo: string): string {
  if (ehTipo(tipo)) return ROTULO_TIPO[tipo];
  return tipo ? tipo.charAt(0).toUpperCase() + tipo.slice(1) : "Encomenda";
}

export const STATUS = ["aguardando", "entregue", "cancelada"] as const;
export type StatusEncomenda = (typeof STATUS)[number];

export const ROTULO_STATUS: Record<StatusEncomenda, string> = {
  aguardando: "Aguardando",
  entregue: "Entregue",
  cancelada: "Cancelada",
};

export function ehStatus(v: unknown): v is StatusEncomenda {
  return typeof v === "string" && (STATUS as readonly string[]).includes(v);
}

/** Chips da tela de registro (+ "Outro" com texto livre). */
export const TRANSPORTADORAS_SUGERIDAS = ["Correios", "Mercado Livre", "Amazon", "Shopee"] as const;

/** Aguardando há 3 dias completos (72 h) ou mais = parada (vermelho). */
export const PARADA_DIAS = 3;

/** Fotos por encomenda: 1 a 3 (etiqueta + volume). */
export const FOTOS_MIN = 1;
export const FOTOS_MAX = 3;

/**
 * Dias completos que a encomenda está aguardando. 0 para quem não está
 * `aguardando` (entregue/cancelada não "param").
 */
export function diasParada(
  e: { status: string; recebidaEm: EntradaData },
  agora: EntradaData = new Date()
): number {
  return e.status === "aguardando" ? diasEntre(e.recebidaEm, agora) : 0;
}

export function estaParada(
  e: { status: string; recebidaEm: EntradaData },
  agora: EntradaData = new Date()
): boolean {
  return diasParada(e, agora) >= PARADA_DIAS;
}
