/**
 * Números do histórico da portaria (23/10/2026) — funções PURAS sobre listas de
 * `EncomendaResumo` já carregadas (isomórficas: sem Prisma). Usadas pelos
 * cartões de resumo de /portaria/historico e /portaria/historico/[apto].
 */
import type { EncomendaResumo } from "@/lib/encomendas";
import { primeiroNome } from "@/lib/whatsapp";

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

export type ResumoHistorico = {
  /** recebidas no período, SEM as canceladas (cancelada = nunca chegou de verdade) */
  recebidas: number;
  entregues: number;
  canceladas: number;
  /** ainda aguardando (das que estão na lista) */
  aguardando: number;
  paradas: number;
  /** média entre recebida e entregue, em ms; null se nada foi entregue */
  tempoMedioMs: number | null;
  /** destinatário com mais encomendas na lista */
  quemMaisRecebe: { nome: string; total: number } | null;
};

export function resumirHistorico(lista: EncomendaResumo[]): ResumoHistorico {
  let entregues = 0;
  let canceladas = 0;
  let aguardando = 0;
  let paradas = 0;
  let somaMs = 0;
  const porDestinatario = new Map<string, { nome: string; total: number }>();

  for (const e of lista) {
    if (e.status === "cancelada") {
      canceladas++;
      continue;
    }
    if (e.status === "entregue") {
      entregues++;
      if (e.entregueEm) somaMs += Math.max(0, new Date(e.entregueEm).getTime() - new Date(e.recebidaEm).getTime());
    } else {
      aguardando++;
      if (e.parada) paradas++;
    }
    const chave = e.destinatarioNome.trim().toLowerCase();
    const atual = porDestinatario.get(chave);
    if (atual) atual.total++;
    else porDestinatario.set(chave, { nome: e.destinatarioNome.trim(), total: 1 });
  }

  let quemMaisRecebe: ResumoHistorico["quemMaisRecebe"] = null;
  for (const d of porDestinatario.values()) {
    if (!quemMaisRecebe || d.total > quemMaisRecebe.total) quemMaisRecebe = d;
  }

  return {
    recebidas: lista.length - canceladas,
    entregues,
    canceladas,
    aguardando,
    paradas,
    tempoMedioMs: entregues > 0 ? somaMs / entregues : null,
    quemMaisRecebe: quemMaisRecebe
      ? { nome: primeiroNome(quemMaisRecebe.nome) || quemMaisRecebe.nome, total: quemMaisRecebe.total }
      : null,
  };
}

const umaCasa = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 0 });

/**
 * Duração curta para cartões: "35 min", "5 h 20 min", "1,4 dia", "3 dias".
 * (A partir de 24 h vira dia com uma casa decimal, como no mockup.)
 */
export function formatarDuracaoCurta(ms: number): string {
  const x = Math.max(0, ms);
  if (x >= DIA_MS) {
    const dias = Math.round((x / DIA_MS) * 10) / 10;
    // em português "1,4 dia" fica no singular: o plural só começa em 2
    return `${umaCasa.format(dias)} ${dias < 2 ? "dia" : "dias"}`;
  }
  const minutos = Math.round(x / 60_000);
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "há 2 h 17 min" / "há 4 dias" — quanto tempo uma encomenda espera. */
export function formatarHa(desde: string | Date, agora: Date = new Date()): string {
  const ms = agora.getTime() - new Date(desde).getTime();
  if (ms < 60_000) return "há menos de 1 min";
  const minutos = Math.floor(ms / 60_000);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h ${String(minutos % 60).padStart(2, "0")} min`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}
