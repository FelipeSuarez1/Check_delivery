/**
 * Consultas e formatação da área do MORADOR (23/10/2026) — só servidor.
 *
 * Regras que valem para tudo daqui:
 *  - o apartamento vem SEMPRE da sessão (`apartamentoDaTela`); o `?apto=` só é
 *    honrado para o ADMIN (que olha a área do morador para conferir) — para o
 *    morador é ignorado, nunca amplia o que ele enxerga;
 *  - telefone de morador nunca é lido aqui (os selects pedem só o nome);
 *  - leitura apenas: o morador não escreve nada além da própria senha.
 * A leitura das encomendas em si reaproveita `lib/encomendas.ts` (contrato).
 */
import { prisma } from "@/lib/db";
import { formatarRelativo, inicioDoDiaDeTexto, partesLocais, type EntradaData } from "@/lib/datas";
import { listarHistoricoApartamento, type EncomendaResumo } from "@/lib/encomendas";
import type { PapelUsuario } from "@/lib/papeis";

/* ------------------------------------------------------------ apartamento */

export type ApartamentoDaTela = { id: number; numero: string };

const REGEX_APTO = /^\d{1,3}[AB]$/;

/**
 * Apartamento cuja área está sendo mostrada.
 *  - morador: o da sessão (parâmetro ignorado); sem apartamento → null;
 *  - admin: o do `?apto=` (ex. "11A"), ou null para a tela de escolha;
 *  - qualquer outro papel: null.
 */
export async function apartamentoDaTela(
  sessao: { papel: PapelUsuario; apartamentoId?: number | null },
  aptoParam?: string | string[] | null
): Promise<ApartamentoDaTela | null> {
  if (sessao.papel === "morador") {
    if (!sessao.apartamentoId) return null;
    return prisma.apartamento.findUnique({
      where: { id: sessao.apartamentoId },
      select: { id: true, numero: true },
    });
  }
  if (sessao.papel !== "admin") return null;
  const texto = (Array.isArray(aptoParam) ? aptoParam[0] : aptoParam)?.trim().toUpperCase();
  if (!texto || !REGEX_APTO.test(texto)) return null;
  return prisma.apartamento.findUnique({ where: { numero: texto }, select: { id: true, numero: true } });
}

const CONECTORES = new Set(["de", "da", "do", "das", "dos", "e"]);

/**
 * Nome para a TELA. O cadastro importado vem quase todo em CAIXA ALTA ("ANA REIS"):
 * nome 100% maiúsculo vira "Ana Reis" (conectores "da/de/do/e" ficam minúsculos).
 * Nome que já tem minúscula (digitado pelo porteiro, "Vizinho do 12A") não é tocado.
 * Só exibição — nada é regravado.
 */
export function nomeExibicao(nome: string): string {
  const t = nome.trim().replace(/\s+/g, " ");
  if (t === "" || t !== t.toLocaleUpperCase("pt-BR") || t === t.toLocaleLowerCase("pt-BR")) return t;
  return t
    .split(" ")
    .map((palavra, i) => {
      if (/\d/.test(palavra)) return palavra; // "12A", "B2": códigos ficam como estão
      const baixo = palavra.toLocaleLowerCase("pt-BR");
      if (i > 0 && CONECTORES.has(baixo)) return baixo;
      return baixo.replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, letra: string) => sep + letra.toLocaleUpperCase("pt-BR"));
    })
    .join(" ");
}

const nomeOuNull = (n: string | null | undefined): string | null => (n ? nomeExibicao(n) : null);

/** Nomes (só nomes, prontos para a tela) dos moradores ativos do apartamento, em ordem alfabética. */
export async function moradoresDoApartamento(apartamentoId: number): Promise<string[]> {
  if (!Number.isInteger(apartamentoId) || apartamentoId <= 0) return [];
  const ms = await prisma.morador.findMany({
    where: { apartamentoId, ativo: true },
    orderBy: [{ nome: "asc" }, { id: "asc" }],
    select: { nome: true },
  });
  return ms.map((m) => nomeExibicao(m.nome)).filter(Boolean);
}

/**
 * "Flavia Souza" → "Flavia". Se dois moradores do apto têm o mesmo primeiro
 * nome, ganham a inicial do último sobrenome ("Felipe S.") para se distinguir.
 */
export function nomesCurtos(nomes: string[]): string[] {
  const primeiros = nomes.map((n) => n.split(/\s+/)[0] ?? n);
  return nomes.map((n, i) => {
    const partes = n.split(/\s+/);
    const repetido = primeiros.filter((p) => p.toLowerCase() === primeiros[i].toLowerCase()).length > 1;
    return repetido && partes.length > 1 ? `${primeiros[i]} ${partes[partes.length - 1].charAt(0).toUpperCase()}.` : primeiros[i];
  });
}

/* ------------------------------------------------------------- consultas */

export type UltimaEntrega = {
  codigo: string;
  destinatarioNome: string;
  retiradaPor: string | null;
  retiradaPorTerceiro: boolean;
  entregueEm: string;
};

/** A encomenda ENTREGUE mais recente do apto (estado vazio de "Na portaria"). */
export async function ultimaEntrega(apartamentoId: number): Promise<UltimaEntrega | null> {
  if (!Number.isInteger(apartamentoId) || apartamentoId <= 0) return null;
  const e = await prisma.encomenda.findFirst({
    where: { apartamentoId, status: "entregue", entregueEm: { not: null } },
    orderBy: [{ entregueEm: "desc" }, { id: "desc" }],
    select: {
      codigo: true,
      destinatarioNome: true,
      entregueEm: true,
      retiradaTerceiroNome: true,
      retiradaPorMorador: { select: { nome: true } },
    },
  });
  if (!e || !e.entregueEm) return null;
  return {
    codigo: e.codigo,
    destinatarioNome: e.destinatarioNome,
    retiradaPor: nomeOuNull(e.retiradaPorMorador?.nome ?? e.retiradaTerceiroNome),
    retiradaPorTerceiro: e.retiradaTerceiroNome != null,
    entregueEm: e.entregueEm.toISOString(),
  };
}

/** Anos (relógio de São Paulo) com encomenda já encerrada no histórico, do mais novo ao mais antigo. */
export async function anosComRegistro(apartamentoId: number): Promise<number[]> {
  if (!Number.isInteger(apartamentoId) || apartamentoId <= 0) return [];
  const linhas = await prisma.encomenda.findMany({
    where: { apartamentoId, status: { not: "aguardando" } },
    select: { recebidaEm: true },
  });
  const anos = new Set(linhas.map((l) => partesLocais(l.recebidaEm).ano));
  return [...anos].sort((a, b) => b - a);
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca do histórico: cada palavra casa com código (aceita "k7-m3"), destinatário, tipo, transportadora, quem retirou ou motivo. */
export function correspondeBuscaMorador(e: EncomendaResumo, busca: string): boolean {
  const termos = semAcento(busca).split(/\s+/).filter(Boolean);
  if (termos.length === 0) return true;
  const codigo = e.codigo.toLowerCase();
  const textos = [e.destinatarioNome, e.tipoRotulo, e.transportadora, e.retiradaPor, e.local, e.canceladaMotivo]
    .filter((x): x is string => !!x)
    .map(semAcento);
  return termos.every((t) => {
    const semHifen = t.replace(/[-_]/g, "");
    return (semHifen !== "" && codigo.includes(semHifen)) || textos.some((x) => x.includes(t));
  });
}

export const LIMITE_HISTORICO = 600;

/**
 * Histórico do apto: encomendas já encerradas (entregue/cancelada), mais recentes
 * primeiro. As que ainda aguardam ficam em "Na portaria". `ano` filtra pela data
 * de recebimento (dia de São Paulo); `q` é a busca textual.
 */
export async function historicoDoApartamento(
  apartamentoId: number,
  opcoes: { ano?: number; q?: string } = {}
): Promise<EncomendaResumo[]> {
  if (!Number.isInteger(apartamentoId) || apartamentoId <= 0) return [];
  const periodo =
    opcoes.ano !== undefined
      ? { de: inicioDoDiaDeTexto(`${opcoes.ano}-01-01`), ate: inicioDoDiaDeTexto(`${opcoes.ano + 1}-01-01`) }
      : undefined;
  const todas = await listarHistoricoApartamento(apartamentoId, periodo, { limite: LIMITE_HISTORICO });
  return todas
    .filter((e) => e.status !== "aguardando")
    .filter((e) => (opcoes.q ? correspondeBuscaMorador(e, opcoes.q) : true));
}

/* ---------------------------------------------------------- formatação */

const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

export function nomeDoMes(mes: number): string {
  return MESES[mes - 1] ?? "";
}

/** "2 h 17 min", "35 min", "3 dias 4 h" — sem o "há " (quem usa decide). */
export function formatarDuracao(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) {
    const resto = min % 60;
    return resto ? `${horas} h ${resto} min` : `${horas} h`;
  }
  const dias = Math.floor(horas / 24);
  const h = horas % 24;
  const base = dias === 1 ? "1 dia" : `${dias} dias`;
  return h ? `${base} ${h} h` : base;
}

/** "hoje, 14:32" · "ontem, 09:12" · "sáb 18/10, 11:05" (vírgula antes da hora, como no mockup). */
export function quandoPorExtenso(d: EntradaData, agora: EntradaData = new Date()): string {
  return formatarRelativo(d, agora).replace(/ (\d{2}:\d{2})$/, ", $1");
}

/** "Guardada na prateleira A3" / "Guardada em Armário 2" — o porteiro digita o local livremente. */
export function textoLocalGuardado(local: string): string {
  const t = local.trim().replace(/\s+/g, " ");
  // "Prateleira A3" vira "prateleira A3"; siglas ("A3", "CX 2") ficam como estão
  const palavra = /^[A-ZÀ-Ý][a-zà-ÿ]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
  return /^prateleira\b/i.test(t) ? `Guardada na ${palavra}` : `Guardada em ${palavra}`;
}

/* ----------------------------------------------------- linha do tempo */

export type PassoTempo = {
  chave: string;
  titulo: string;
  /** linhas de detalhe abaixo do título */
  linhas: string[];
  /** ok = feito · espera = em andamento (marcador vazado) · alerta = parada · neutro = cancelada */
  marcador: "ok" | "espera" | "alerta" | "neutro";
};

/** Passos da encomenda na ordem em que aconteceram. Puro (recebe `agora`). */
export function montarLinhaDoTempo(e: EncomendaResumo, agora: Date = new Date()): PassoTempo[] {
  const passos: PassoTempo[] = [
    {
      chave: "recebida",
      titulo: "Recebida na portaria",
      linhas: [`${quandoPorExtenso(e.recebidaEm, agora)} · por ${nomeExibicao(e.recebidaPor)}`],
      marcador: "ok",
    },
  ];

  if (e.avisoWhatsAppEm) {
    passos.push({
      chave: "aviso",
      titulo: "Aviso enviado no WhatsApp",
      linhas: [quandoPorExtenso(e.avisoWhatsAppEm, agora)],
      marcador: "ok",
    });
  }

  if (e.status === "aguardando") {
    const decorrido = formatarDuracao(agora.getTime() - new Date(e.recebidaEm).getTime());
    passos.push({
      chave: "aguardando",
      titulo: "Aguardando retirada",
      linhas: [`há ${decorrido}`],
      marcador: e.parada ? "alerta" : "espera",
    });
  } else if (e.status === "entregue") {
    const quem = e.retiradaPor ? `${nomeExibicao(e.retiradaPor)}${e.retiradaPorTerceiro ? " (terceiro)" : ""}` : null;
    passos.push({
      chave: "entregue",
      titulo: "Entregue",
      linhas: [
        [e.entregueEm ? quandoPorExtenso(e.entregueEm, agora) : null, e.entreguePor ? `por ${nomeExibicao(e.entreguePor)}` : null]
          .filter(Boolean)
          .join(" · "),
        ...(quem ? [`Retirou: ${quem}`] : []),
      ].filter((l) => l !== ""),
      marcador: "ok",
    });
  } else {
    passos.push({
      chave: "cancelada",
      titulo: "Cancelada",
      linhas: [
        e.canceladaEm ? quandoPorExtenso(e.canceladaEm, agora) : "",
        ...(e.canceladaMotivo ? [`Motivo: ${e.canceladaMotivo}`] : []),
      ].filter((l) => l !== ""),
      marcador: "neutro",
    });
  }
  return passos;
}
