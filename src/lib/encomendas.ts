/**
 * Leitura das encomendas (22/10/2026) — regra de negócio pura sobre o Prisma,
 * sem UI e sem sessão (as guardas ficam nas actions/pages). Tipos de saída são
 * SERIALIZÁVEIS: datas viram ISO string (UTC) e não há telefone em nenhum deles
 * (telefone só aparece dentro do link do WhatsApp, devolvido a portaria/admin).
 * Escrita (registrar/retirar/cancelar): `encomendas-escrita.ts`.
 *
 * Client components devem importar TIPOS daqui (`import type`) e VALORES de
 * `encomenda-constantes.ts` — este módulo puxa o Prisma.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { gerarCodigoCandidato, validarCodigo } from "@/lib/codigo";
import { DIA_MS, formatarDataHora, inicioDoDiaLocal, type Periodo } from "@/lib/datas";
import {
  PARADA_DIAS,
  diasParada as calcularDiasParada,
  ehStatus,
  ehTipo,
  rotuloTipo,
  type StatusEncomenda,
  type TipoEncomenda,
} from "@/lib/encomenda-constantes";
import { linkWhatsApp, mensagemWhatsApp, telefoneParaWhatsApp } from "@/lib/whatsapp";
import { correspondeBusca } from "@/lib/busca-encomenda";

export {
  FOTOS_MAX,
  FOTOS_MIN,
  PARADA_DIAS,
  ROTULO_STATUS,
  ROTULO_TIPO,
  STATUS,
  TIPOS,
  TRANSPORTADORAS_SUGERIDAS,
  diasParada,
  ehStatus,
  ehTipo,
  estaParada,
  rotuloTipo,
} from "@/lib/encomenda-constantes";
export type { StatusEncomenda, TipoEncomenda } from "@/lib/encomenda-constantes";
// contrato do CLAUDE.md lista estas duas em encomendas.ts; a implementacao fica em whatsapp.ts
export { linkWhatsApp, mensagemWhatsApp } from "@/lib/whatsapp";
export type { Periodo } from "@/lib/datas";
// a busca vive em busca-encomenda.ts (pura) para as telas client poderem filtrar listas sem puxar o Prisma
export { correspondeBusca } from "@/lib/busca-encomenda";

/* ------------------------------------------------------------------ tipos */

export type FotoInfo = { id: number; ordem: number };

export type EncomendaResumo = {
  id: number;
  codigo: string;
  apartamentoId: number;
  /** número do apto, ex. "11A" */
  apartamento: string;
  torre: "A" | "B";
  destinatarioMoradorId: number | null;
  destinatarioNome: string;
  tipo: TipoEncomenda;
  tipoRotulo: string;
  transportadora: string | null;
  observacao: string | null;
  local: string | null;
  status: StatusEncomenda;
  /** ISO UTC */
  recebidaEm: string;
  /** nome do porteiro que recebeu */
  recebidaPor: string;
  entregueEm: string | null;
  /** nome do porteiro que entregou */
  entreguePor: string | null;
  /** quem retirou: morador do apto ou terceiro */
  retiradaPor: string | null;
  retiradaPorTerceiro: boolean;
  canceladaEm: string | null;
  canceladaMotivo: string | null;
  avisoWhatsAppEm: string | null;
  /** fotos que ainda existem no disco (a retenção remove as antigas) */
  fotos: FotoInfo[];
  /** id da 1ª foto, ou null */
  fotoId: number | null;
  /** dias completos aguardando (0 se não estiver aguardando) */
  diasParada: number;
  /** diasParada maior ou igual a PARADA_DIAS */
  parada: boolean;
};

/** Visão da portaria/admin: inclui o documento do terceiro (dado pessoal de outra pessoa). */
export type EncomendaDetalhe = EncomendaResumo & { retiradaTerceiroDoc: string | null };

export type ApartamentoInfo = { id: number; numero: string; torre: "A" | "B"; andar: number };
export type MoradorInfo = {
  id: number;
  nome: string;
  temTelefone: boolean;
  /** false = o morador recusou avisos por WhatsApp (LGPD, 23/10/2026) */
  avisoWhatsApp: boolean;
};

export type FiltroAguardando = { torre?: "A" | "B"; apartamentoId?: number; busca?: string };
export type FiltroHistorico = {
  torre?: "A" | "B";
  apartamentoId?: number;
  status?: StatusEncomenda;
  busca?: string;
  /** máximo de linhas (padrão 300) */
  limite?: number;
};

/* --------------------------------------------------------------- internos */

const INCLUIR_RESUMO = {
  apartamento: { select: { numero: true, torre: true } },
  recebidaPorPorteiro: { select: { nome: true } },
  entreguePorPorteiro: { select: { nome: true } },
  retiradaPorMorador: { select: { nome: true } },
  fotos: { where: { apagadaEm: null }, orderBy: { ordem: "asc" }, select: { id: true, ordem: true } },
} satisfies Prisma.EncomendaInclude;

type LinhaResumo = Prisma.EncomendaGetPayload<{ include: typeof INCLUIR_RESUMO }>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function paraResumo(l: LinhaResumo, agora: Date): EncomendaResumo {
  const tipo = (ehTipo(l.tipo) ? l.tipo : "caixa") as TipoEncomenda;
  const status = (ehStatus(l.status) ? l.status : "aguardando") as StatusEncomenda;
  const dias = calcularDiasParada({ status, recebidaEm: l.recebidaEm }, agora);
  const terceiro = l.retiradaTerceiroNome != null;
  return {
    id: l.id,
    codigo: l.codigo,
    apartamentoId: l.apartamentoId,
    apartamento: l.apartamento.numero,
    torre: l.apartamento.torre === "B" ? "B" : "A",
    destinatarioMoradorId: l.destinatarioMoradorId,
    destinatarioNome: l.destinatarioNome,
    tipo,
    tipoRotulo: rotuloTipo(l.tipo),
    transportadora: l.transportadora,
    observacao: l.observacao,
    local: l.local,
    status,
    recebidaEm: l.recebidaEm.toISOString(),
    recebidaPor: l.recebidaPorPorteiro.nome,
    entregueEm: iso(l.entregueEm),
    entreguePor: l.entreguePorPorteiro?.nome ?? null,
    retiradaPor: l.retiradaPorMorador?.nome ?? l.retiradaTerceiroNome ?? null,
    retiradaPorTerceiro: terceiro,
    canceladaEm: iso(l.canceladaEm),
    canceladaMotivo: l.canceladaMotivo,
    avisoWhatsAppEm: iso(l.avisoWhatsAppEm),
    fotos: l.fotos.map((f) => ({ id: f.id, ordem: f.ordem })),
    fotoId: l.fotos[0]?.id ?? null,
    diasParada: dias,
    parada: dias >= PARADA_DIAS,
  };
}

function paraDetalhe(l: LinhaResumo, agora: Date): EncomendaDetalhe {
  return { ...paraResumo(l, agora), retiradaTerceiroDoc: l.retiradaTerceiroDoc };
}

const idValido = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;

function whereBase(f?: { torre?: string; apartamentoId?: number }): Prisma.EncomendaWhereInput {
  const w: Prisma.EncomendaWhereInput = {};
  if (f?.apartamentoId !== undefined) w.apartamentoId = idValido(f.apartamentoId) ? f.apartamentoId : -1;
  if (f?.torre === "A" || f?.torre === "B") w.apartamento = { torre: f.torre };
  return w;
}

function wherePeriodo(p?: Periodo): Prisma.EncomendaWhereInput {
  const filtro: Prisma.DateTimeFilter = {};
  const de = p?.de != null ? new Date(p.de) : null;
  const ate = p?.ate != null ? new Date(p.ate) : null;
  if (de && !Number.isNaN(de.getTime())) filtro.gte = de;
  if (ate && !Number.isNaN(ate.getTime())) filtro.lt = ate;
  return Object.keys(filtro).length > 0 ? { recebidaEm: filtro } : {};
}

async function consultar(
  where: Prisma.EncomendaWhereInput,
  orderBy: Prisma.EncomendaOrderByWithRelationInput[],
  opcoes: { busca?: string; limite?: number } = {}
): Promise<EncomendaResumo[]> {
  const temBusca = !!opcoes.busca && opcoes.busca.trim() !== "";
  const limite = opcoes.limite !== undefined && idValido(opcoes.limite) ? opcoes.limite : undefined;
  const linhas = await prisma.encomenda.findMany({
    where,
    orderBy,
    include: INCLUIR_RESUMO,
    // com busca o filtro final é em JS (acento/caixa), então lê mais e corta depois
    ...(!temBusca && limite ? { take: limite } : temBusca ? { take: 5000 } : {}),
  });
  const agora = new Date();
  let lista = linhas.map((l) => paraResumo(l, agora));
  if (temBusca) lista = lista.filter((e) => correspondeBusca(e, opcoes.busca));
  return limite ? lista.slice(0, limite) : lista;
}

/* ------------------------------------------------------------------ código */

/** Código único (nunca usado antes, em qualquer status). A constraint UNIQUE ainda é a palavra final. */
export async function gerarCodigo(): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const candidato = gerarCodigoCandidato();
    const existe = await prisma.encomenda.findUnique({ where: { codigo: candidato }, select: { id: true } });
    if (!existe) return candidato;
  }
  throw new Error("Não foi possível gerar um código único");
}

/* ----------------------------------------------------------------- listas */

/** Aguardando, MAIS ANTIGAS PRIMEIRO (as paradas aparecem no topo). */
export async function listarAguardando(filtro?: FiltroAguardando): Promise<EncomendaResumo[]> {
  return consultar(
    { status: "aguardando", ...whereBase(filtro) },
    [{ recebidaEm: "asc" }, { id: "asc" }],
    { busca: filtro?.busca }
  );
}

/** Entregues desde 00:00 de hoje (São Paulo), a mais recente primeiro. */
export async function listarEntreguesHoje(): Promise<EncomendaResumo[]> {
  return consultar(
    { status: "entregue", entregueEm: { gte: inicioDoDiaLocal() } },
    [{ entregueEm: "desc" }, { id: "desc" }]
  );
}

/** Todas as encomendas do apto (qualquer status) recebidas no período; mais recente primeiro. */
export async function listarHistoricoApartamento(
  apartamentoId: number,
  periodo?: Periodo,
  opcoes?: { limite?: number }
): Promise<EncomendaResumo[]> {
  return consultar(
    { ...whereBase({ apartamentoId }), ...wherePeriodo(periodo) },
    [{ recebidaEm: "desc" }, { id: "desc" }],
    { limite: opcoes?.limite ?? 300 }
  );
}

/** Histórico geral (portaria/admin): período por data de recebimento; `ate` é exclusivo. */
export async function listarHistoricoGeral(
  periodo: Periodo | undefined,
  filtros: FiltroHistorico = {}
): Promise<EncomendaResumo[]> {
  return consultar(
    {
      ...whereBase(filtros),
      ...wherePeriodo(periodo),
      ...(filtros.status && ehStatus(filtros.status) ? { status: filtros.status } : {}),
    },
    [{ recebidaEm: "desc" }, { id: "desc" }],
    { busca: filtros.busca, limite: filtros.limite ?? 300 }
  );
}

/** Contadores da barra da portaria (Todas, Torre A, Torre B, paradas, entregues hoje). */
export async function resumoPortaria(): Promise<{
  aguardando: number;
  torreA: number;
  torreB: number;
  paradas: number;
  entreguesHoje: number;
}> {
  const agora = Date.now();
  const [aguardando, torreA, torreB, paradas, entreguesHoje] = await Promise.all([
    prisma.encomenda.count({ where: { status: "aguardando" } }),
    prisma.encomenda.count({ where: { status: "aguardando", apartamento: { torre: "A" } } }),
    prisma.encomenda.count({ where: { status: "aguardando", apartamento: { torre: "B" } } }),
    prisma.encomenda.count({
      where: { status: "aguardando", recebidaEm: { lte: new Date(agora - PARADA_DIAS * DIA_MS) } },
    }),
    prisma.encomenda.count({ where: { status: "entregue", entregueEm: { gte: inicioDoDiaLocal() } } }),
  ]);
  return { aguardando, torreA, torreB, paradas, entreguesHoje };
}

/* ------------------------------------------------------------ busca única */

/** Por código (aceita minúsculas/hífen). Inválido ou inexistente → null. Qualquer status. */
export async function buscarPorCodigo(codigo: string): Promise<EncomendaDetalhe | null> {
  const v = validarCodigo(codigo);
  if (!v.ok) return null;
  const l = await prisma.encomenda.findUnique({ where: { codigo: v.codigo }, include: INCLUIR_RESUMO });
  return l ? paraDetalhe(l, new Date()) : null;
}

export async function buscarPorId(id: number): Promise<EncomendaDetalhe | null> {
  if (!idValido(id)) return null;
  const l = await prisma.encomenda.findUnique({ where: { id }, include: INCLUIR_RESUMO });
  return l ? paraDetalhe(l, new Date()) : null;
}

/* ---------------------------------------------------------------- morador */

/**
 * Encomenda SÓ se for do apartamento da sessão (senão null — a tela devolve 404
 * sem revelar que existe). O apto vem da sessão, nunca de parâmetro de URL.
 */
export async function encomendaParaMorador(
  id: number,
  apartamentoIdDaSessao: number
): Promise<EncomendaResumo | null> {
  if (!idValido(id) || !idValido(apartamentoIdDaSessao)) return null;
  const l = await prisma.encomenda.findFirst({
    where: { id, apartamentoId: apartamentoIdDaSessao },
    include: INCLUIR_RESUMO,
  });
  return l ? paraResumo(l, new Date()) : null;
}

/** Idem, pela URL `/app/encomenda/[codigo]`. */
export async function encomendaParaMoradorPorCodigo(
  codigo: string,
  apartamentoIdDaSessao: number
): Promise<EncomendaResumo | null> {
  const v = validarCodigo(codigo);
  if (!v.ok || !idValido(apartamentoIdDaSessao)) return null;
  const l = await prisma.encomenda.findFirst({
    where: { codigo: v.codigo, apartamentoId: apartamentoIdDaSessao },
    include: INCLUIR_RESUMO,
  });
  return l ? paraResumo(l, new Date()) : null;
}

/** Tela inicial do morador: o que está na portaria (mais antigas primeiro) + histórico recente. */
export async function listarDoApartamento(
  apartamentoId: number,
  opcoes?: { limiteHistorico?: number }
): Promise<{ aguardando: EncomendaResumo[]; historico: EncomendaResumo[] }> {
  if (!idValido(apartamentoId)) return { aguardando: [], historico: [] };
  const [aguardando, historico] = await Promise.all([
    consultar({ apartamentoId, status: "aguardando" }, [{ recebidaEm: "asc" }, { id: "asc" }]),
    consultar({ apartamentoId, status: { not: "aguardando" } }, [{ recebidaEm: "desc" }, { id: "desc" }], {
      limite: opcoes?.limiteHistorico ?? 100,
    }),
  ]);
  return { aguardando, historico };
}

/* -------------------------------------- apartamentos e moradores (portaria) */

export async function listarApartamentos(): Promise<ApartamentoInfo[]> {
  const aptos = await prisma.apartamento.findMany({
    where: { ativo: true },
    orderBy: [{ torre: "asc" }, { andar: "asc" }],
    select: { id: true, numero: true, torre: true, andar: true },
  });
  return aptos.map((a) => ({ ...a, torre: a.torre === "B" ? "B" : "A" }));
}

/** "11a" ou " 11A " vira o apto ativo, ou null. */
export async function buscarApartamentoPorNumero(numero: string): Promise<ApartamentoInfo | null> {
  const n = numero.trim().toUpperCase();
  if (!/^\d{1,3}[AB]$/.test(n)) return null;
  const a = await prisma.apartamento.findFirst({
    where: { numero: n, ativo: true },
    select: { id: true, numero: true, torre: true, andar: true },
  });
  return a ? { ...a, torre: a.torre === "B" ? "B" : "A" } : null;
}

/** Moradores ativos do apto (chips "Para quem?" e "Quem retirou?"). Sem o telefone. */
export async function listarMoradoresDoApartamento(apartamentoId: number): Promise<MoradorInfo[]> {
  if (!idValido(apartamentoId)) return [];
  const ms = await prisma.morador.findMany({
    where: { apartamentoId, ativo: true },
    orderBy: [{ nome: "asc" }, { id: "asc" }],
    select: { id: true, nome: true, telefone: true, avisoWhatsApp: true },
  });
  return ms.map((m) => ({
    id: m.id,
    nome: m.nome,
    temTelefone: !!m.telefone && m.telefone.replace(/\D/g, "").length >= 10,
    avisoWhatsApp: m.avisoWhatsApp,
  }));
}

export type ApartamentoComMoradores = ApartamentoInfo & {
  moradores: { id: number; nome: string; avisoWhatsApp: boolean }[];
};

/**
 * Todos os aptos ativos com os moradores ativos (id, nome e se aceitam aviso por
 * WhatsApp — sem telefone). A tela de registro carrega isso UMA vez e troca os
 * chips "Para quem?" sem ir ao servidor a cada apartamento digitado (52 aptos,
 * ~100 nomes); o marcador de quem recusou o WhatsApp sai do mesmo carregamento.
 */
export async function listarApartamentosComMoradores(): Promise<ApartamentoComMoradores[]> {
  const aptos = await prisma.apartamento.findMany({
    where: { ativo: true },
    orderBy: [{ torre: "asc" }, { andar: "asc" }],
    select: {
      id: true,
      numero: true,
      torre: true,
      andar: true,
      moradores: {
        where: { ativo: true },
        orderBy: [{ nome: "asc" }, { id: "asc" }],
        select: { id: true, nome: true, avisoWhatsApp: true },
      },
    },
  });
  return aptos.map((a) => ({ ...a, torre: a.torre === "B" ? "B" : "A" }));
}

export type BuscaParaRetirada =
  | { ok: true; encomenda: EncomendaDetalhe; moradores: MoradorInfo[] }
  | { ok: false; erro: string };

/**
 * Tela de retirada: acha a encomenda `aguardando` do código e os moradores do
 * apto (chips "Quem está retirando?"). Código inexistente, já entregue ou
 * cancelado devolve SÓ uma mensagem — nunca dados da encomenda.
 */
export async function buscarParaRetirada(codigo: string): Promise<BuscaParaRetirada> {
  const v = validarCodigo(codigo);
  if (!v.ok) return { ok: false, erro: v.erro };
  const e = await buscarPorCodigo(v.codigo);
  if (!e) return { ok: false, erro: `Código ${v.codigo} não encontrado. Confira a etiqueta ou o celular do morador.` };
  if (e.status === "entregue") {
    return {
      ok: false,
      erro: `O código ${e.codigo} já foi entregue${e.entregueEm ? ` (${formatarDataHora(e.entregueEm)})` : ""}.`,
    };
  }
  if (e.status === "cancelada") {
    return {
      ok: false,
      erro: `O código ${e.codigo} foi cancelado${e.canceladaMotivo ? ` (${e.canceladaMotivo})` : ""}.`,
    };
  }
  return { ok: true, encomenda: e, moradores: await listarMoradoresDoApartamento(e.apartamentoId) };
}

/* --------------------------------------------------------------- WhatsApp */

export type AvisoPreparado =
  | { ok: true; link: string; paraNome: string; codigo: string }
  | {
      ok: false;
      link: null;
      erro: string;
      /**
       * recusou = a recusa (LGPD) impede o aviso; sem_telefone = ninguém do apto tem telefone
       * utilizável; indisponivel = encomenda inexistente/inválida.
       */
      motivo: "recusou" | "sem_telefone" | "indisponivel";
    };

/**
 * Link do WhatsApp para avisar a encomenda (LGPD, 23/10/2026: a recusa é da PESSOA):
 *  - destinatário cadastrado que recusou → NENHUM link, e ninguém cobre por ele;
 *  - destinatário com telefone e que aceita → o telefone dele;
 *  - destinatário sem telefone utilizável, ou "outro nome" (sem morador vinculado) →
 *    o 1º morador ativo do apto que tenha telefone E não tenha recusado.
 * Não grava nada.
 */
export async function prepararAviso(encomendaId: number): Promise<AvisoPreparado> {
  if (!idValido(encomendaId)) return { ok: false, link: null, erro: "Encomenda não encontrada", motivo: "indisponivel" };
  const e = await prisma.encomenda.findUnique({
    where: { id: encomendaId },
    include: {
      apartamento: { select: { numero: true } },
      destinatarioMorador: { select: { id: true, nome: true, telefone: true, avisoWhatsApp: true } },
    },
  });
  if (!e) return { ok: false, link: null, erro: "Encomenda não encontrada", motivo: "indisponivel" };

  const destinatario = e.destinatarioMorador;
  if (destinatario && !destinatario.avisoWhatsApp) {
    return {
      ok: false,
      link: null,
      erro: `${destinatario.nome} pediu para não receber avisos no WhatsApp`,
      motivo: "recusou",
    };
  }

  const moradores = await prisma.morador.findMany({
    where: { apartamentoId: e.apartamentoId, ativo: true },
    orderBy: { id: "asc" },
    select: { id: true, nome: true, telefone: true, avisoWhatsApp: true },
  });
  const candidatos = [
    ...(destinatario ? [destinatario] : []),
    ...moradores.filter((m) => m.avisoWhatsApp && m.id !== destinatario?.id),
  ];
  const dados = {
    codigo: e.codigo,
    tipo: e.tipo,
    transportadora: e.transportadora,
    destinatarioNome: e.destinatarioNome,
    apartamento: e.apartamento.numero,
  };
  for (const m of candidatos) {
    const mensagem = mensagemWhatsApp(dados, { saudacaoNome: m.nome });
    const link = linkWhatsApp(m.telefone, mensagem);
    if (link) return { ok: true, link, paraNome: m.nome, codigo: e.codigo };
  }

  // sem link: foi a recusa que fechou a porta (há telefone, mas só de quem recusou) ou não há telefone mesmo?
  const recusaram = moradores.filter((m) => !m.avisoWhatsApp && telefoneParaWhatsApp(m.telefone) !== null);
  if (recusaram.length > 0) {
    const nomes = recusaram.map((m) => m.nome).join(", ");
    return {
      ok: false,
      link: null,
      erro:
        recusaram.length === 1
          ? `${nomes}, único morador do ${e.apartamento.numero} com telefone cadastrado, pediu para não receber avisos no WhatsApp - avise por outro meio`
          : `Os moradores do ${e.apartamento.numero} com telefone cadastrado (${nomes}) pediram para não receber avisos no WhatsApp - avise por outro meio`,
      motivo: "recusou",
    };
  }
  return {
    ok: false,
    link: null,
    erro: `Nenhum morador do ${e.apartamento.numero} tem telefone cadastrado - avise por outro meio`,
    motivo: "sem_telefone",
  };
}
