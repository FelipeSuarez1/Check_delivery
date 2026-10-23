/**
 * Consultas da área administrativa (23/10/2026) — Prisma direto, sem UI.
 * Tipos de saída SERIALIZÁVEIS (datas viram ISO string). O telefone completo só
 * existe no tipo da tela de edição; a lista recebe a versão mascarada.
 * Só servidor: client components importam TIPOS daqui (`import type`) e
 * funções puras de `admin-formato.ts`.
 *
 * Escrita: `actions/admin-cadastros.ts` e `actions/admin-usuarios.ts`.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  MSG_SESSAO_EXPIRADA,
  MSG_SO_ADMIN,
  exigirAdmin,
  lerSessaoVerificada,
} from "@/lib/auth";
import {
  DIA_MS,
  diaLocalISO,
  formatarDataHoraCompleta,
  inicioDoDiaDeTexto,
  inicioDoDiaLocal,
  periodoDeDias,
  somarDiasLocal,
  type Periodo,
} from "@/lib/datas";
import {
  PARADA_DIAS,
  ROTULO_STATUS,
  STATUS,
  diasParada,
  ehStatus,
  rotuloTipo,
  type StatusEncomenda,
} from "@/lib/encomenda-constantes";
import { montarCsv, formatarTelefone, mascararTelefone, semAcento } from "@/lib/admin-formato";
import { normalizarPapel, type PapelUsuario } from "@/lib/papeis";
import type { SessaoPayload } from "@/lib/sessao-token";

/* ------------------------------------------------------------------ guarda */

/**
 * Guarda de toda action de /admin: `exigirAdmin()` primeiro; a mensagem
 * distingue sessão vencida de papel sem permissão. UI só esconde — é aqui que
 * o servidor decide.
 */
export async function guardaAdmin(): Promise<{ sessao: SessaoPayload } | { erro: string }> {
  const sessao = await exigirAdmin();
  if (sessao) return { sessao };
  return { erro: (await lerSessaoVerificada()) ? MSG_SO_ADMIN : MSG_SESSAO_EXPIRADA };
}

/**
 * Evento fora do vocabulário de `TipoEvento` (lib/log.ts): a exportação de CSV
 * leva dados pessoais para fora do sistema e precisa de rastro próprio. A
 * coluna `tipo` é texto livre. Nunca lança.
 */
export async function registrarExportacao(
  sessao: Pick<SessaoPayload, "id" | "nome" | "papel">,
  detalhe: string
): Promise<void> {
  try {
    await prisma.logEvento.create({
      data: {
        usuarioId: sessao.id,
        usuarioNome: sessao.nome,
        papel: sessao.papel,
        tipo: "exportacao",
        rota: "/admin/exportar/csv",
        detalhe: detalhe.slice(0, 2000),
      },
    });
  } catch (e) {
    console.error("registrarExportacao falhou:", e);
  }
}

/* ------------------------------------------------------------------ eventos */

export type EventoAdmin = {
  id: number;
  /** ISO UTC */
  quando: string;
  usuarioNome: string;
  papel: string | null;
  tipo: string;
  rota: string;
  detalhe: string | null;
};

type LinhaEvento = {
  id: number;
  criadoEm: Date;
  usuarioNome: string;
  papel: string | null;
  tipo: string;
  rota: string;
  detalhe: string | null;
};

const paraEvento = (e: LinhaEvento): EventoAdmin => ({
  id: e.id,
  quando: e.criadoEm.toISOString(),
  usuarioNome: e.usuarioNome,
  papel: e.papel,
  tipo: e.tipo,
  rota: e.rota,
  detalhe: e.detalhe,
});

const SELECIONAR_EVENTO = {
  id: true,
  criadoEm: true,
  usuarioNome: true,
  papel: true,
  tipo: true,
  rota: true,
  detalhe: true,
} satisfies Prisma.LogEventoSelect;

export type FiltroEventos = { tipo?: string; usuario?: string; q?: string };
export const LIMITE_EVENTOS = 500;

/** Últimos eventos (mais recente primeiro). `truncado` = havia mais que o limite. */
export async function listarEventos(
  filtro: FiltroEventos = {},
  limite = LIMITE_EVENTOS
): Promise<{ eventos: EventoAdmin[]; truncado: boolean }> {
  const e: Prisma.LogEventoWhereInput[] = [];
  const tipo = filtro.tipo?.trim();
  const usuario = filtro.usuario?.trim();
  const q = filtro.q?.trim();
  if (tipo) e.push({ tipo });
  if (usuario) e.push({ OR: [{ usuarioNome: { contains: usuario } }, { usuario: { login: { contains: usuario } } }] });
  if (q) e.push({ OR: [{ detalhe: { contains: q } }, { rota: { contains: q } }] });
  const linhas = await prisma.logEvento.findMany({
    where: e.length > 0 ? { AND: e } : {},
    orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
    take: limite + 1,
    select: SELECIONAR_EVENTO,
  });
  return { eventos: linhas.slice(0, limite).map(paraEvento), truncado: linhas.length > limite };
}

/* ------------------------------------------------------------------- painel */

export type ParadaItem = {
  id: number;
  codigo: string;
  apartamento: string;
  destinatario: string;
  transportadora: string | null;
  tipoRotulo: string;
  recebidaEm: string;
  dias: number;
};

export type PorPorteiro = { id: number; nome: string; ativo: boolean; recebidas: number; entregues: number };

export type PainelAdmin = {
  geradoEm: string;
  aguardando: { total: number; torreA: number; torreB: number };
  paradas: { total: number; itens: ParadaItem[] };
  entregues: { hoje: number; dias7: number; dias30: number };
  /** média (ms) entre recebimento e retirada das entregues nos últimos 30 dias; null sem entregas */
  tempoMedioMs: number | null;
  turno: { porteiroNome: string; inicioISO: string } | null;
  porPorteiro: PorPorteiro[];
  eventos: EventoAdmin[];
};

/** Itens da lista de paradas na tela; o restante vira "e mais N". */
export const PARADAS_NA_LISTA = 12;

/**
 * Painel do administrador. Janelas em dias de calendário de São Paulo,
 * INCLUINDO hoje: "7 dias" = hoje + 6 anteriores; "30 dias" = hoje + 29.
 */
export async function carregarPainel(agora = new Date()): Promise<PainelAdmin> {
  const hoje = inicioDoDiaLocal(agora);
  const ini7 = somarDiasLocal(agora, -6);
  const ini30 = somarDiasLocal(agora, -29);
  const limiteParada = new Date(agora.getTime() - PARADA_DIAS * DIA_MS);
  const aguardandoWhere = { status: "aguardando" } as const;

  const [
    aguardandoTotal,
    aguardandoA,
    aguardandoB,
    paradasTotal,
    paradasLinhas,
    entreguesHoje,
    entregues7,
    entregues30,
    entregues30Datas,
    turno,
    recebidasPorPorteiro,
    entreguesPorPorteiro,
    porteiros,
    eventos,
  ] = await Promise.all([
    prisma.encomenda.count({ where: aguardandoWhere }),
    prisma.encomenda.count({ where: { ...aguardandoWhere, apartamento: { torre: "A" } } }),
    prisma.encomenda.count({ where: { ...aguardandoWhere, apartamento: { torre: "B" } } }),
    prisma.encomenda.count({ where: { ...aguardandoWhere, recebidaEm: { lte: limiteParada } } }),
    prisma.encomenda.findMany({
      where: { ...aguardandoWhere, recebidaEm: { lte: limiteParada } },
      orderBy: [{ recebidaEm: "asc" }, { id: "asc" }],
      take: PARADAS_NA_LISTA,
      select: {
        id: true,
        codigo: true,
        destinatarioNome: true,
        transportadora: true,
        tipo: true,
        recebidaEm: true,
        apartamento: { select: { numero: true } },
      },
    }),
    prisma.encomenda.count({ where: { status: "entregue", entregueEm: { gte: hoje } } }),
    prisma.encomenda.count({ where: { status: "entregue", entregueEm: { gte: ini7 } } }),
    prisma.encomenda.count({ where: { status: "entregue", entregueEm: { gte: ini30 } } }),
    prisma.encomenda.findMany({
      where: { status: "entregue", entregueEm: { gte: ini30 } },
      select: { recebidaEm: true, entregueEm: true },
    }),
    prisma.turno.findFirst({
      where: { fim: null },
      orderBy: [{ inicio: "desc" }, { id: "desc" }],
      select: { inicio: true, porteiro: { select: { nome: true } } },
    }),
    prisma.encomenda.groupBy({
      by: ["recebidaPorPorteiroId"],
      where: { status: { not: "cancelada" }, recebidaEm: { gte: ini30 } },
      _count: { _all: true },
    }),
    prisma.encomenda.groupBy({
      by: ["entreguePorPorteiroId"],
      where: { status: "entregue", entreguePorPorteiroId: { not: null }, entregueEm: { gte: ini30 } },
      _count: { _all: true },
    }),
    prisma.porteiro.findMany({ orderBy: [{ nome: "asc" }, { id: "asc" }], select: { id: true, nome: true, ativo: true } }),
    prisma.logEvento.findMany({
      orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
      take: 10,
      select: SELECIONAR_EVENTO,
    }),
  ]);

  const duracoes = entregues30Datas
    .filter((e): e is { recebidaEm: Date; entregueEm: Date } => e.entregueEm !== null)
    .map((e) => e.entregueEm.getTime() - e.recebidaEm.getTime())
    .filter((ms) => ms >= 0);
  const tempoMedioMs = duracoes.length > 0 ? duracoes.reduce((a, b) => a + b, 0) / duracoes.length : null;

  const recebidas = new Map(recebidasPorPorteiro.map((r) => [r.recebidaPorPorteiroId, r._count._all]));
  const entreguesMapa = new Map<number, number>();
  for (const r of entreguesPorPorteiro) {
    if (r.entreguePorPorteiroId !== null) entreguesMapa.set(r.entreguePorPorteiroId, r._count._all);
  }
  // porteiros ativos sempre aparecem (mesmo com zero); inativos só se tiveram movimento na janela
  const porPorteiro = porteiros
    .map((p) => ({
      id: p.id,
      nome: p.nome,
      ativo: p.ativo,
      recebidas: recebidas.get(p.id) ?? 0,
      entregues: entreguesMapa.get(p.id) ?? 0,
    }))
    .filter((p) => p.ativo || p.recebidas > 0 || p.entregues > 0)
    .sort((a, b) => b.recebidas + b.entregues - (a.recebidas + a.entregues) || a.nome.localeCompare(b.nome, "pt-BR"));

  return {
    geradoEm: agora.toISOString(),
    aguardando: { total: aguardandoTotal, torreA: aguardandoA, torreB: aguardandoB },
    paradas: {
      total: paradasTotal,
      itens: paradasLinhas.map((l) => ({
        id: l.id,
        codigo: l.codigo,
        apartamento: l.apartamento.numero,
        destinatario: l.destinatarioNome,
        transportadora: l.transportadora,
        tipoRotulo: rotuloTipo(l.tipo),
        recebidaEm: l.recebidaEm.toISOString(),
        dias: diasParada({ status: "aguardando", recebidaEm: l.recebidaEm }, agora),
      })),
    },
    entregues: { hoje: entreguesHoje, dias7: entregues7, dias30: entregues30 },
    tempoMedioMs,
    turno: turno ? { porteiroNome: turno.porteiro.nome, inicioISO: turno.inicio.toISOString() } : null,
    porPorteiro,
    eventos: eventos.map(paraEvento),
  };
}

/* ---------------------------------------------------------------- moradores */

export type MoradorAdmin = {
  id: number;
  nome: string;
  /** "(11) 9****-6682" — o que a LISTA mostra */
  telefoneMascarado: string;
  /** "(11) 94300-6682" — só para o diálogo de edição ("" sem telefone) */
  telefoneCompleto: string;
  ativo: boolean;
};

export type ApartamentoAdmin = {
  id: number;
  numero: string;
  torre: "A" | "B";
  andar: number;
  ativo: boolean;
  moradores: MoradorAdmin[];
};

export type OpcaoApartamento = { id: number; numero: string; torre: "A" | "B" };

export type ResumoCadastro = {
  apartamentos: number;
  moradoresAtivos: number;
  moradoresInativos: number;
  /** ativos sem telefone — sem ele o aviso de WhatsApp não sai */
  semTelefone: number;
  /** apartamentos ativos sem nenhum morador ativo */
  semMoradorAtivo: number;
};

export type FiltroMoradores = { torre?: "A" | "B"; q?: string };

function aptoCasaTermo(numero: string, termo: string): boolean {
  const apto = numero.toLowerCase();
  if (/^\d+[a-z]$/.test(termo)) return apto === termo;
  if (/^\d+$/.test(termo)) return apto.slice(0, -1) === termo;
  return false;
}

/**
 * Apartamentos com seus moradores (ativos e inativos). A busca exige que TODAS
 * as palavras casem: apto ("11a" exato, "11" = 11A e 11B), nome (sem acento,
 * sem caixa) ou telefone (só com 5+ dígitos). O apartamento aparece completo.
 */
export async function listarApartamentosAdmin(
  filtro: FiltroMoradores = {}
): Promise<{ aptos: ApartamentoAdmin[]; resumo: ResumoCadastro; opcoes: OpcaoApartamento[] }> {
  const aptosDb = await prisma.apartamento.findMany({
    orderBy: [{ torre: "asc" }, { andar: "asc" }, { id: "asc" }],
    include: { moradores: { orderBy: [{ ativo: "desc" }, { nome: "asc" }, { id: "asc" }] } },
  });

  const todos: (ApartamentoAdmin & { telefones: string[] })[] = aptosDb.map((a) => ({
    id: a.id,
    numero: a.numero,
    torre: a.torre === "B" ? "B" : "A",
    andar: a.andar,
    ativo: a.ativo,
    telefones: a.moradores.map((m) => m.telefone ?? ""),
    moradores: a.moradores.map((m) => ({
      id: m.id,
      nome: m.nome,
      telefoneMascarado: mascararTelefone(m.telefone),
      telefoneCompleto: formatarTelefone(m.telefone),
      ativo: m.ativo,
    })),
  }));

  const ativos = aptosDb.flatMap((a) => (a.ativo ? a.moradores.filter((m) => m.ativo) : []));
  const resumo: ResumoCadastro = {
    apartamentos: aptosDb.length,
    moradoresAtivos: aptosDb.reduce((n, a) => n + a.moradores.filter((m) => m.ativo).length, 0),
    moradoresInativos: aptosDb.reduce((n, a) => n + a.moradores.filter((m) => !m.ativo).length, 0),
    semTelefone: ativos.filter((m) => !m.telefone || m.telefone.replace(/\D/g, "").length < 10).length,
    semMoradorAtivo: aptosDb.filter((a) => a.ativo && !a.moradores.some((m) => m.ativo)).length,
  };

  const termos = semAcento(filtro.q ?? "").split(/\s+/).filter(Boolean);
  const aptos = todos
    .filter((a) => !filtro.torre || a.torre === filtro.torre)
    .filter((a) =>
      termos.every(
        (t) =>
          aptoCasaTermo(a.numero, t) ||
          a.moradores.some((m) => semAcento(m.nome).includes(t)) ||
          (/^\d{5,}$/.test(t) && a.telefones.some((tel) => tel.includes(t)))
      )
    )
    .map((a) => ({ id: a.id, numero: a.numero, torre: a.torre, andar: a.andar, ativo: a.ativo, moradores: a.moradores }));

  const opcoes = todos
    .filter((a) => a.ativo)
    .map((a) => ({ id: a.id, numero: a.numero, torre: a.torre }));
  return { aptos, resumo, opcoes };
}

/* ---------------------------------------------------------------- porteiros */

export type PorteiroAdmin = {
  id: number;
  nome: string;
  ativo: boolean;
  criadoEm: string;
  /** total histórico (não só 30 dias): serve para saber se o nome já consta no livro */
  recebidas: number;
  entregues: number;
  deTurno: boolean;
};

export async function listarPorteirosAdmin(): Promise<PorteiroAdmin[]> {
  const [porteiros, recebidas, entregues, turno] = await Promise.all([
    prisma.porteiro.findMany({ orderBy: [{ ativo: "desc" }, { nome: "asc" }, { id: "asc" }] }),
    prisma.encomenda.groupBy({
      by: ["recebidaPorPorteiroId"],
      where: { status: { not: "cancelada" } },
      _count: { _all: true },
    }),
    prisma.encomenda.groupBy({
      by: ["entreguePorPorteiroId"],
      where: { status: "entregue", entreguePorPorteiroId: { not: null } },
      _count: { _all: true },
    }),
    prisma.turno.findFirst({ where: { fim: null }, orderBy: [{ inicio: "desc" }, { id: "desc" }], select: { porteiroId: true } }),
  ]);
  const r = new Map(recebidas.map((x) => [x.recebidaPorPorteiroId, x._count._all]));
  const e = new Map<number, number>();
  for (const x of entregues) if (x.entreguePorPorteiroId !== null) e.set(x.entreguePorPorteiroId, x._count._all);
  return porteiros.map((p) => ({
    id: p.id,
    nome: p.nome,
    ativo: p.ativo,
    criadoEm: p.criadoEm.toISOString(),
    recebidas: r.get(p.id) ?? 0,
    entregues: e.get(p.id) ?? 0,
    deTurno: turno?.porteiroId === p.id,
  }));
}

/* ----------------------------------------------------------------- usuários */

export type UsuarioAdmin = {
  id: number;
  login: string;
  nome: string;
  papel: PapelUsuario;
  apartamentoId: number | null;
  apartamento: string | null;
  ativo: boolean;
  precisaTrocarSenha: boolean;
  criadoEm: string;
  /** último LogEvento tipo "login" (ISO), ou null */
  ultimoLogin: string | null;
  /** desativado E sem nenhum evento/inscrição: a exclusão definitiva é permitida */
  podeExcluir: boolean;
};

export type SituacaoUsuario = "ativos" | "desativados" | "pendentes";
export type FiltroUsuarios = { papel?: PapelUsuario; q?: string; situacao?: SituacaoUsuario };

export type ResumoUsuarios = { total: number; ativos: number; pendentes: number };

export async function listarUsuariosAdmin(
  filtro: FiltroUsuarios = {}
): Promise<{ usuarios: UsuarioAdmin[]; resumo: ResumoUsuarios }> {
  const [linhas, logins, eventos, pushes] = await Promise.all([
    prisma.usuario.findMany({
      orderBy: [{ ativo: "desc" }, { papel: "asc" }, { login: "asc" }],
      include: { apartamento: { select: { numero: true } } },
    }),
    prisma.logEvento.groupBy({
      by: ["usuarioId"],
      where: { tipo: "login", usuarioId: { not: null } },
      _max: { criadoEm: true },
    }),
    prisma.logEvento.groupBy({ by: ["usuarioId"], where: { usuarioId: { not: null } }, _count: { _all: true } }),
    prisma.pushInscricao.groupBy({ by: ["usuarioId"], _count: { _all: true } }),
  ]);
  const ultimo = new Map(logins.map((l) => [l.usuarioId as number, l._max.criadoEm]));
  const comEventos = new Set(eventos.map((l) => l.usuarioId as number));
  const comPush = new Set(pushes.map((p) => p.usuarioId));

  const todos: UsuarioAdmin[] = linhas.map((u) => ({
    id: u.id,
    login: u.login,
    nome: u.nome,
    papel: normalizarPapel(u.papel) ?? "morador",
    apartamentoId: u.apartamentoId,
    apartamento: u.apartamento?.numero ?? null,
    ativo: u.ativo,
    precisaTrocarSenha: u.precisaTrocarSenha,
    criadoEm: u.criadoEm.toISOString(),
    ultimoLogin: ultimo.get(u.id)?.toISOString() ?? null,
    podeExcluir: !u.ativo && !comEventos.has(u.id) && !comPush.has(u.id),
  }));

  const termos = semAcento(filtro.q ?? "").split(/\s+/).filter(Boolean);
  const usuarios = todos
    .filter((u) => !filtro.papel || u.papel === filtro.papel)
    .filter((u) => {
      if (filtro.situacao === "ativos") return u.ativo;
      if (filtro.situacao === "desativados") return !u.ativo;
      if (filtro.situacao === "pendentes") return u.ativo && u.precisaTrocarSenha;
      return true;
    })
    .filter((u) => {
      const alvo = semAcento(`${u.login} ${u.nome} ${u.apartamento ?? ""}`);
      return termos.every((t) => alvo.includes(t));
    });

  return {
    usuarios,
    resumo: {
      total: todos.length,
      ativos: todos.filter((u) => u.ativo).length,
      pendentes: todos.filter((u) => u.ativo && u.precisaTrocarSenha).length,
    },
  };
}

/** Login padrão de morador: "ap" + número do apto em minúsculas (ap11a, ap261b). */
export const loginDoApartamento = (numero: string): string => `ap${numero.toLowerCase()}`;

/** Apartamentos ATIVOS sem nenhum usuário com o login padrão (nem desativado). */
export async function aptosSemLogin(): Promise<{ id: number; numero: string }[]> {
  const [aptos, existentes] = await Promise.all([
    prisma.apartamento.findMany({
      where: { ativo: true },
      orderBy: [{ andar: "asc" }, { torre: "asc" }],
      select: { id: true, numero: true },
    }),
    prisma.usuario.findMany({ select: { login: true } }),
  ]);
  const logins = new Set(existentes.map((u) => u.login));
  return aptos.filter((a) => !logins.has(loginDoApartamento(a.numero)));
}

/* ---------------------------------------------------------------- exportação */

export const CABECALHO_CSV = [
  "Código",
  "Apto",
  "Torre",
  "Destinatário",
  "Tipo",
  "Transportadora",
  "Recebida em",
  "Recebida por",
  "Entregue em",
  "Entregue por",
  "Retirada por",
  "Status",
  "Motivo cancelamento",
  "Aviso WhatsApp em",
] as const;

export type FiltroExportacao = {
  /** AAAA-MM-DD (inclusivo) ou null = sem limite */
  de: string | null;
  ate: string | null;
  torre: "A" | "B" | null;
  status: StatusEncomenda | null;
};

type EntradaParams = Record<string, string | string[] | undefined> | URLSearchParams;

function lerParam(p: EntradaParams, chave: string): string {
  const v = p instanceof URLSearchParams ? p.get(chave) : p[chave];
  const s = Array.isArray(v) ? v[0] : v;
  return (s ?? "").trim();
}

/**
 * Filtro da exportação a partir da querystring. Valor malformado é ERRO (nunca
 * vira "sem filtro" em silêncio: uma data digitada errada exportaria o banco
 * inteiro). O período é por data de RECEBIMENTO e ambas as pontas são inclusivas.
 */
export function lerFiltroExportacao(
  params: EntradaParams
): { ok: true; filtro: FiltroExportacao } | { ok: false; erro: string } {
  const de = lerParam(params, "de");
  const ate = lerParam(params, "ate");
  const torre = lerParam(params, "torre").toUpperCase();
  const status = lerParam(params, "status").toLowerCase();

  if (de && !inicioDoDiaDeTexto(de)) return { ok: false, erro: "Data inicial inválida — use AAAA-MM-DD" };
  if (ate && !inicioDoDiaDeTexto(ate)) return { ok: false, erro: "Data final inválida — use AAAA-MM-DD" };
  if (de && ate && de > ate) return { ok: false, erro: "A data inicial é posterior à final" };
  if (torre && torre !== "A" && torre !== "B") return { ok: false, erro: "Torre inválida — use A ou B" };
  if (status && !ehStatus(status)) return { ok: false, erro: `Status inválido — use ${STATUS.join(", ")}` };

  return {
    ok: true,
    filtro: {
      de: de || null,
      ate: ate || null,
      torre: torre === "A" || torre === "B" ? torre : null,
      status: status && ehStatus(status) ? status : null,
    },
  };
}

function whereExportacao(f: FiltroExportacao): Prisma.EncomendaWhereInput {
  const periodo: Periodo = periodoDeDias(f.de, f.ate);
  const recebidaEm: Prisma.DateTimeFilter = {};
  if (periodo.de) recebidaEm.gte = new Date(periodo.de);
  if (periodo.ate) recebidaEm.lt = new Date(periodo.ate);
  return {
    ...(Object.keys(recebidaEm).length > 0 ? { recebidaEm } : {}),
    ...(f.torre ? { apartamento: { torre: f.torre } } : {}),
    ...(f.status ? { status: f.status } : {}),
  };
}

export async function contarParaExportacao(f: FiltroExportacao): Promise<number> {
  return prisma.encomenda.count({ where: whereExportacao(f) });
}

const SELECIONAR_EXPORTACAO = {
  id: true,
  codigo: true,
  tipo: true,
  transportadora: true,
  destinatarioNome: true,
  status: true,
  recebidaEm: true,
  entregueEm: true,
  canceladaMotivo: true,
  avisoWhatsAppEm: true,
  retiradaTerceiroNome: true,
  apartamento: { select: { numero: true, torre: true } },
  recebidaPorPorteiro: { select: { nome: true } },
  entreguePorPorteiro: { select: { nome: true } },
  retiradaPorMorador: { select: { nome: true } },
} satisfies Prisma.EncomendaSelect;

export type LinhaExportacao = Prisma.EncomendaGetPayload<{ select: typeof SELECIONAR_EXPORTACAO }>;

/** Em ordem cronológica de recebimento (a planilha lê de cima para baixo). */
export async function listarParaExportacao(f: FiltroExportacao, limite?: number): Promise<LinhaExportacao[]> {
  return prisma.encomenda.findMany({
    where: whereExportacao(f),
    orderBy: [{ recebidaEm: "asc" }, { id: "asc" }],
    select: SELECIONAR_EXPORTACAO,
    ...(limite ? { take: limite } : {}),
  });
}

const dataOuVazio = (d: Date | null): string => (d ? formatarDataHoraCompleta(d) : "");

/** Uma encomenda → uma linha do CSV, na ordem de CABECALHO_CSV. */
export function linhaDeExportacao(r: LinhaExportacao): (string | null)[] {
  const retirada = r.retiradaPorMorador?.nome ?? (r.retiradaTerceiroNome ? `${r.retiradaTerceiroNome} (terceiro)` : "");
  return [
    r.codigo,
    r.apartamento.numero,
    r.apartamento.torre,
    r.destinatarioNome,
    rotuloTipo(r.tipo),
    r.transportadora,
    formatarDataHoraCompleta(r.recebidaEm),
    r.recebidaPorPorteiro.nome,
    dataOuVazio(r.entregueEm),
    r.entreguePorPorteiro?.nome ?? "",
    retirada,
    ehStatus(r.status) ? ROTULO_STATUS[r.status] : r.status,
    r.canceladaMotivo,
    dataOuVazio(r.avisoWhatsAppEm),
  ];
}

export function montarCsvDeExportacao(linhas: readonly LinhaExportacao[]): string {
  return montarCsv(CABECALHO_CSV, linhas.map(linhaDeExportacao));
}

/** encomendas-<de>-<ate>.csv; ponta aberta: "inicio" / data de hoje. Só caracteres seguros. */
export function nomeArquivoCsv(f: FiltroExportacao, agora = new Date()): string {
  return `encomendas-${f.de ?? "inicio"}-${f.ate ?? diaLocalISO(agora)}.csv`;
}

/** Resumo do filtro para o log/tela: "de 2026-10-01 até 2026-10-22 · torre A · status entregue". */
export function descreverFiltro(f: FiltroExportacao): string {
  return [
    f.de ? `de ${f.de}` : "desde o início",
    f.ate ? `até ${f.ate}` : "até hoje",
    f.torre ? `torre ${f.torre}` : "todas as torres",
    f.status ? `status ${f.status}` : "todos os status",
  ].join(" · ");
}

/** Apartamentos ativos para <select> (leve: sem moradores). */
export async function listarOpcoesApartamento(): Promise<OpcaoApartamento[]> {
  const aptos = await prisma.apartamento.findMany({
    where: { ativo: true },
    orderBy: [{ torre: "asc" }, { andar: "asc" }],
    select: { id: true, numero: true, torre: true },
  });
  return aptos.map((a) => ({ id: a.id, numero: a.numero, torre: a.torre === "B" ? "B" : "A" }));
}
