/**
 * Datas do app (22/10/2026): o banco guarda UTC; a EXIBIÇÃO e a noção de "dia"
 * (hoje/ontem, entregues hoje, período do histórico) usam America/Sao_Paulo.
 * Isomórfico (só Intl) — serve a server e client components.
 * Todas as funções aceitam Date | ISO string | epoch ms.
 */

export const FUSO = "America/Sao_Paulo";
export const DIA_MS = 86_400_000;

export type EntradaData = Date | string | number;

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

const FORMATADOR = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function paraData(d: EntradaData): Date {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) throw new RangeError("Data inválida");
  return x;
}

const dois = (n: number) => String(n).padStart(2, "0");

export type PartesLocais = {
  ano: number;
  mes: number; // 1-12
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
  diaSemana: number; // 0 = domingo
};

/** Decompõe o instante no relógio de São Paulo. */
export function partesLocais(d: EntradaData): PartesLocais {
  const partes = FORMATADOR.formatToParts(paraData(d));
  const n = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  const ano = n("year");
  const mes = n("month");
  const dia = n("day");
  return {
    ano,
    mes,
    dia,
    hora: n("hour") % 24,
    minuto: n("minute"),
    segundo: n("second"),
    diaSemana: new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay(),
  };
}

/** "22/10 16:48" */
export function formatarDataHora(d: EntradaData): string {
  const p = partesLocais(d);
  return `${dois(p.dia)}/${dois(p.mes)} ${dois(p.hora)}:${dois(p.minuto)}`;
}

/** "22/10/2026 16:48" — exportações e telas de auditoria. */
export function formatarDataHoraCompleta(d: EntradaData): string {
  const p = partesLocais(d);
  return `${dois(p.dia)}/${dois(p.mes)}/${p.ano} ${dois(p.hora)}:${dois(p.minuto)}`;
}

/** "16:48" */
export function formatarHora(d: EntradaData): string {
  const p = partesLocais(d);
  return `${dois(p.hora)}:${dois(p.minuto)}`;
}

/** "qui 22/10" */
export function formatarDiaSemana(d: EntradaData): string {
  const p = partesLocais(d);
  return `${SEMANA[p.diaSemana]} ${dois(p.dia)}/${dois(p.mes)}`;
}

/** Dias de calendário (SP) entre as datas: hoje − d. 0 = mesmo dia, 1 = ontem. */
export function diasCalendarioEntre(a: EntradaData, b: EntradaData): number {
  const pa = partesLocais(a);
  const pb = partesLocais(b);
  const ua = Date.UTC(pa.ano, pa.mes - 1, pa.dia);
  const ub = Date.UTC(pb.ano, pb.mes - 1, pb.dia);
  return Math.round((ub - ua) / DIA_MS);
}

/**
 * "hoje 14:32", "ontem 09:12", "sáb 18/10 11:05" (com ano se for de outro ano).
 * `agora` existe para teste; o padrão é o relógio real.
 */
export function formatarRelativo(d: EntradaData, agora: EntradaData = new Date()): string {
  const p = partesLocais(d);
  const hora = `${dois(p.hora)}:${dois(p.minuto)}`;
  const dif = diasCalendarioEntre(d, agora);
  if (dif === 0) return `hoje ${hora}`;
  if (dif === 1) return `ontem ${hora}`;
  const hoje = partesLocais(agora);
  const ano = p.ano !== hoje.ano ? `/${p.ano}` : "";
  return `${SEMANA[p.diaSemana]} ${dois(p.dia)}/${dois(p.mes)}${ano} ${hora}`;
}

/**
 * Dias COMPLETOS (blocos de 24 h) decorridos entre `a` e `b` (padrão: agora).
 * Nunca negativo. É a base de `diasParada`: uma encomenda de domingo 23:00 só
 * vira "3 dias" na quarta 23:00, não na quarta 00:01.
 */
export function diasEntre(a: EntradaData, b: EntradaData = new Date()): number {
  const dif = paraData(b).getTime() - paraData(a).getTime();
  return dif <= 0 ? 0 : Math.floor(dif / DIA_MS);
}

function deslocamentoMs(instante: number): number {
  const p = partesLocais(instante);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - Math.floor(instante / 1000) * 1000;
}

/** Instante (UTC) em que começa o dia de `d` no relógio de São Paulo (00:00 local). */
export function inicioDoDiaLocal(d: EntradaData = new Date()): Date {
  const p = partesLocais(d);
  const alvoComoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, 0, 0, 0);
  let t = alvoComoUtc - deslocamentoMs(alvoComoUtc);
  t = alvoComoUtc - deslocamentoMs(t); // 2ª passada: garante o offset do próprio instante
  return new Date(t);
}

/** Início do dia local `n` dias depois (n pode ser negativo). */
export function somarDiasLocal(d: EntradaData, n: number): Date {
  // início do dia + n×24 h + 12 h cai no meio do dia-alvo, mesmo se houver mudança de horário
  return inicioDoDiaLocal(inicioDoDiaLocal(d).getTime() + n * DIA_MS + 12 * 3_600_000);
}

/** "2026-10-22" — para <input type="date"> e filtros de URL. */
export function diaLocalISO(d: EntradaData): string {
  const p = partesLocais(d);
  return `${p.ano}-${dois(p.mes)}-${dois(p.dia)}`;
}

/** "2026-10-22" → início desse dia em SP; null se o texto não for uma data real. */
export function inicioDoDiaDeTexto(texto: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto ?? "");
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const teste = new Date(Date.UTC(ano, mes - 1, dia));
  if (teste.getUTCFullYear() !== ano || teste.getUTCMonth() !== mes - 1 || teste.getUTCDate() !== dia) return null;
  // meio-dia UTC do dia pedido cai no mesmo dia em SP (UTC-2/-3) → início local desse dia
  return inicioDoDiaLocal(Date.UTC(ano, mes - 1, dia, 12));
}

/** Intervalo de datas dos filtros. `ate` é EXCLUSIVO (use `periodoDeDias` para datas inclusivas). */
export type Periodo = { de?: EntradaData | null; ate?: EntradaData | null };

/**
 * Filtros de tela ("2026-10-01" até "2026-10-22", ambos INCLUSIVOS) → Periodo.
 * Texto inválido/ausente = lado aberto.
 */
export function periodoDeDias(de?: string | null, ate?: string | null): Periodo {
  const ini = inicioDoDiaDeTexto(de);
  const fim = inicioDoDiaDeTexto(ate);
  return { de: ini, ate: fim ? somarDiasLocal(fim, 1) : null };
}
