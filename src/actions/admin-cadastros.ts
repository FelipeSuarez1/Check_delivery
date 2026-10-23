"use server";

/**
 * Cadastros do administrador (23/10/2026): moradores e porteiros.
 * Guarda `exigirAdmin()` (via guardaAdmin) em TODA action; zod em todo input;
 * log tipo "cadastro" por último. NADA é apagado: morador e porteiro têm
 * histórico (encomendas) — desativar é o único "remover".
 * Tudo que é EXPORTADO aqui vira endpoint de Server Action: só funções async;
 * as regras auxiliares ficam sem export.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { guardaAdmin } from "@/lib/admin";
import { chaveNome, limparNome, normalizarTelefone, temControle } from "@/lib/admin-formato";
import { registrarEvento } from "@/lib/log";
import type { SessaoPayload } from "@/lib/sessao-token";

export type ResultadoCadastro = { ok: true; aviso?: string } | { ok: false; erro: string };

const ROTA_MORADORES = "/admin/moradores";
const ROTA_PORTEIROS = "/admin/porteiros";

const idSchema = z.number({ error: "Registro inválido" }).int("Registro inválido").positive("Registro inválido");

const nomeSchema = z
  .string({ error: "Informe o nome" })
  .max(200, "Nome longo demais (máximo 80 caracteres)")
  .transform(limparNome)
  .refine((n) => n.length >= 2, "Informe o nome (mínimo 2 letras)")
  .refine((n) => n.length <= 80, "Nome longo demais (máximo 80 caracteres)")
  .refine((n) => !temControle(n), "O nome tem caracteres inválidos");

const telefoneSchema = z.string().max(40, "Telefone longo demais").nullish();

const criarMoradorSchema = z.object({ apartamentoId: idSchema, nome: nomeSchema, telefone: telefoneSchema });
const editarMoradorSchema = criarMoradorSchema.extend({ id: idSchema });
const soIdSchema = z.object({ id: idSchema });
const criarPorteiroSchema = z.object({ nome: nomeSchema });
const renomearPorteiroSchema = z.object({ id: idSchema, nome: nomeSchema });

function primeiroErro(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Dados inválidos";
}

async function aposEscrever(rotas: string[], alcancaPortaria: boolean): Promise<void> {
  for (const r of rotas) revalidatePath(r);
  revalidatePath("/admin");
  // chips "Para quem?" / "Quem retirou?" e o seletor de turno vivem na portaria
  if (alcancaPortaria) revalidatePath("/portaria", "layout");
}

function log(sessao: SessaoPayload, rota: string, detalhe: string): Promise<void> {
  return registrarEvento(sessao, "cadastro", rota, detalhe);
}

/* ================================================================ moradores */

type EntradaMorador = { apartamentoId: number; nome: string; telefone?: string | null };

/** Apartamento ATIVO que vai receber o morador, ou a mensagem de erro. */
async function apartamentoDestino(id: number): Promise<{ id: number; numero: string } | string> {
  const apto = await prisma.apartamento.findUnique({ where: { id }, select: { id: true, numero: true, ativo: true } });
  if (!apto) return "Apartamento não encontrado";
  if (!apto.ativo) return `O apartamento ${apto.numero} está inativo`;
  return { id: apto.id, numero: apto.numero };
}

/** Outro morador do apto com o mesmo nome (sem acento/caixa)? Devolve a mensagem de erro. */
async function nomeRepetido(apartamentoId: number, nome: string, exceto?: number): Promise<string | null> {
  const existentes = await prisma.morador.findMany({
    where: { apartamentoId, ...(exceto ? { NOT: { id: exceto } } : {}) },
    select: { nome: true, ativo: true },
  });
  const igual = existentes.find((m) => chaveNome(m.nome) === chaveNome(nome));
  if (!igual) return null;
  return igual.ativo
    ? "Já existe um morador com esse nome neste apartamento"
    : "Já existe um morador com esse nome neste apartamento, desativado — reative o cadastro existente";
}

export async function criarMorador(entrada: EntradaMorador): Promise<ResultadoCadastro & { id?: number }> {
  const g = await guardaAdmin();
  if ("erro" in g) return { ok: false, erro: g.erro };
  const parsed = criarMoradorSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: primeiroErro(parsed.error) };
  const { apartamentoId, nome, telefone } = parsed.data;
  const tel = normalizarTelefone(telefone);
  if (!tel.ok) return { ok: false, erro: tel.erro };

  try {
    const apto = await apartamentoDestino(apartamentoId);
    if (typeof apto === "string") return { ok: false, erro: apto };
    const repetido = await nomeRepetido(apto.id, nome);
    if (repetido) return { ok: false, erro: repetido };

    const m = await prisma.morador.create({ data: { apartamentoId: apto.id, nome, telefone: tel.telefone } });
    await log(g.sessao, ROTA_MORADORES, `Criou o morador "${nome}" no apto ${apto.numero}${tel.telefone ? " (com telefone)" : " (sem telefone)"}`);
    await aposEscrever([ROTA_MORADORES], true);
    return { ok: true, id: m.id };
  } catch (e) {
    return falhaInesperada("criarMorador", g.sessao, ROTA_MORADORES, e);
  }
}

export async function editarMorador(entrada: EntradaMorador & { id: number }): Promise<ResultadoCadastro> {
  const g = await guardaAdmin();
  if ("erro" in g) return { ok: false, erro: g.erro };
  const parsed = editarMoradorSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: primeiroErro(parsed.error) };
  const { id, apartamentoId, nome, telefone } = parsed.data;
  const tel = normalizarTelefone(telefone);
  if (!tel.ok) return { ok: false, erro: tel.erro };

  try {
    const atual = await prisma.morador.findUnique({ where: { id }, include: { apartamento: { select: { numero: true } } } });
    if (!atual) return { ok: false, erro: "Morador não encontrado" };

    const mudouApto = apartamentoId !== atual.apartamentoId;
    // mudar de apto exige destino ativo; ficar no mesmo não revalida (apto inativo continua editável)
    let numeroDestino = atual.apartamento.numero;
    if (mudouApto) {
      const apto = await apartamentoDestino(apartamentoId);
      if (typeof apto === "string") return { ok: false, erro: apto };
      numeroDestino = apto.numero;
    }
    const repetido = await nomeRepetido(apartamentoId, nome, id);
    if (repetido) return { ok: false, erro: repetido };

    const mudancas: string[] = [];
    if (nome !== atual.nome) mudancas.push(`nome "${atual.nome}" → "${nome}"`);
    if (mudouApto) mudancas.push(`apto ${atual.apartamento.numero} → ${numeroDestino}`);
    if ((tel.telefone ?? null) !== (atual.telefone ?? null)) {
      mudancas.push(tel.telefone ? (atual.telefone ? "telefone alterado" : "telefone informado") : "telefone removido");
    }
    if (mudancas.length === 0) return { ok: true, aviso: "Nada mudou" };

    await prisma.morador.update({ where: { id }, data: { nome, telefone: tel.telefone, apartamentoId } });
    await log(g.sessao, ROTA_MORADORES, `Editou o morador "${atual.nome}" (apto ${atual.apartamento.numero}): ${mudancas.join("; ")}`);
    await aposEscrever([ROTA_MORADORES], true);
    return { ok: true };
  } catch (e) {
    return falhaInesperada("editarMorador", g.sessao, ROTA_MORADORES, e);
  }
}

async function definirAtivoMorador(entrada: { id: number }, ativo: boolean): Promise<ResultadoCadastro> {
  const g = await guardaAdmin();
  if ("erro" in g) return { ok: false, erro: g.erro };
  const parsed = soIdSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: primeiroErro(parsed.error) };
  const { id } = parsed.data;

  try {
    const m = await prisma.morador.findUnique({ where: { id }, include: { apartamento: { select: { numero: true } } } });
    if (!m) return { ok: false, erro: "Morador não encontrado" };
    if (m.ativo === ativo) return { ok: true, aviso: ativo ? "O morador já estava ativo" : "O morador já estava desativado" };
    if (ativo) {
      // reativar ao lado de um homônimo ativo geraria duplicata
      const repetido = await nomeRepetido(m.apartamentoId, m.nome, m.id);
      if (repetido) return { ok: false, erro: repetido };
    }
    await prisma.morador.update({ where: { id }, data: { ativo } });
    await log(g.sessao, ROTA_MORADORES, `${ativo ? "Reativou" : "Desativou"} o morador "${m.nome}" (apto ${m.apartamento.numero})`);
    await aposEscrever([ROTA_MORADORES], true);
    return { ok: true };
  } catch (e) {
    return falhaInesperada(ativo ? "reativarMorador" : "desativarMorador", g.sessao, ROTA_MORADORES, e);
  }
}

export async function desativarMorador(entrada: { id: number }): Promise<ResultadoCadastro> {
  return definirAtivoMorador(entrada, false);
}

export async function reativarMorador(entrada: { id: number }): Promise<ResultadoCadastro> {
  return definirAtivoMorador(entrada, true);
}

/* ================================================================ porteiros */

/** Nome já usado por outro porteiro (ativo ou não)? Sem acento/caixa. */
async function porteiroRepetido(nome: string, exceto?: number): Promise<string | null> {
  const existentes = await prisma.porteiro.findMany({
    where: exceto ? { NOT: { id: exceto } } : {},
    select: { nome: true, ativo: true },
  });
  const igual = existentes.find((p) => chaveNome(p.nome) === chaveNome(nome));
  if (!igual) return null;
  return igual.ativo
    ? "Já existe um porteiro com esse nome"
    : "Já existe um porteiro com esse nome, desativado — reative o cadastro existente";
}

export async function criarPorteiro(entrada: { nome: string }): Promise<ResultadoCadastro & { id?: number }> {
  const g = await guardaAdmin();
  if ("erro" in g) return { ok: false, erro: g.erro };
  const parsed = criarPorteiroSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: primeiroErro(parsed.error) };
  const { nome } = parsed.data;

  try {
    const repetido = await porteiroRepetido(nome);
    if (repetido) return { ok: false, erro: repetido };
    const p = await prisma.porteiro.create({ data: { nome } });
    await log(g.sessao, ROTA_PORTEIROS, `Criou o porteiro "${nome}"`);
    await aposEscrever([ROTA_PORTEIROS], true);
    return { ok: true, id: p.id };
  } catch (e) {
    return falhaInesperada("criarPorteiro", g.sessao, ROTA_PORTEIROS, e);
  }
}

export async function renomearPorteiro(entrada: { id: number; nome: string }): Promise<ResultadoCadastro> {
  const g = await guardaAdmin();
  if ("erro" in g) return { ok: false, erro: g.erro };
  const parsed = renomearPorteiroSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: primeiroErro(parsed.error) };
  const { id, nome } = parsed.data;

  try {
    const p = await prisma.porteiro.findUnique({ where: { id } });
    if (!p) return { ok: false, erro: "Porteiro não encontrado" };
    if (p.nome === nome) return { ok: true, aviso: "Nada mudou" };
    const repetido = await porteiroRepetido(nome, id);
    if (repetido) return { ok: false, erro: repetido };
    await prisma.porteiro.update({ where: { id }, data: { nome } });
    await log(g.sessao, ROTA_PORTEIROS, `Renomeou o porteiro "${p.nome}" → "${nome}"`);
    await aposEscrever([ROTA_PORTEIROS], true);
    return { ok: true };
  } catch (e) {
    return falhaInesperada("renomearPorteiro", g.sessao, ROTA_PORTEIROS, e);
  }
}

async function definirAtivoPorteiro(entrada: { id: number }, ativo: boolean): Promise<ResultadoCadastro> {
  const g = await guardaAdmin();
  if ("erro" in g) return { ok: false, erro: g.erro };
  const parsed = soIdSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: primeiroErro(parsed.error) };
  const { id } = parsed.data;

  try {
    const p = await prisma.porteiro.findUnique({ where: { id } });
    if (!p) return { ok: false, erro: "Porteiro não encontrado" };
    if (p.ativo === ativo) return { ok: true, aviso: ativo ? "O porteiro já estava ativo" : "O porteiro já estava desativado" };
    if (!ativo) {
      // desativar quem está no balcão deixaria a portaria registrando em nome de um porteiro "inativo"
      const emTurno = await prisma.turno.count({ where: { fim: null, porteiroId: id } });
      if (emTurno > 0) return { ok: false, erro: `${p.nome} está de turno agora — encerre ou troque o turno na portaria antes de desativar` };
    }
    await prisma.porteiro.update({ where: { id }, data: { ativo } });
    await log(g.sessao, ROTA_PORTEIROS, `${ativo ? "Reativou" : "Desativou"} o porteiro "${p.nome}"`);
    await aposEscrever([ROTA_PORTEIROS], true);
    return { ok: true };
  } catch (e) {
    return falhaInesperada(ativo ? "reativarPorteiro" : "desativarPorteiro", g.sessao, ROTA_PORTEIROS, e);
  }
}

export async function desativarPorteiro(entrada: { id: number }): Promise<ResultadoCadastro> {
  return definirAtivoPorteiro(entrada, false);
}

export async function reativarPorteiro(entrada: { id: number }): Promise<ResultadoCadastro> {
  return definirAtivoPorteiro(entrada, true);
}

/* ------------------------------------------------------------------ comum */

/** Erro de infraestrutura: detalhe vai ao livro (tipo "erro"), a tela recebe mensagem genérica. */
async function falhaInesperada(
  acao: string,
  sessao: SessaoPayload,
  rota: string,
  e: unknown
): Promise<{ ok: false; erro: string }> {
  console.error(`${acao} falhou:`, e);
  await registrarEvento(sessao, "erro", rota, `${acao}: ${e instanceof Error ? e.message : String(e)}`);
  return { ok: false, erro: "Não foi possível salvar agora. Tente de novo." };
}
