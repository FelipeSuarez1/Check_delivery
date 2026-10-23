"use server";

/**
 * Usuários do app (23/10/2026) — só o administrador. Guarda `exigirAdmin()`
 * (via guardaAdmin) em TODA action; zod; log tipo "usuario" por último.
 *
 * Proteções (o servidor decide; a UI só esconde):
 *  - ninguém se desativa, se rebaixa, se exclui nem redefine a PRÓPRIA senha
 *    por aqui (a troca da própria senha é /conta/senha, que exige a atual);
 *  - sempre resta ao menos 1 administrador ativo (conferido dentro de uma
 *    transação, para dois admins desativando um ao outro não zerarem a conta);
 *  - exclusão definitiva só de usuário desativado e sem nenhum evento no livro
 *    (a trilha de auditoria precisa continuar apontando para alguém); fora
 *    disso o usuário apenas fica desativado.
 *
 * Senhas: geradas aqui (legíveis, uma por usuário), devolvidas UMA vez ao
 * administrador e nunca gravadas em log. Todo usuário nasce — e todo reset
 * deixa — com `precisaTrocarSenha = true`. Trocar o hash muda o `sv` do token e
 * derruba as sessões abertas daquele usuário.
 * Só funções async são exportadas (endpoints de Server Action).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { aptosSemLogin, guardaAdmin, loginDoApartamento } from "@/lib/admin";
import { limparNome, temControle } from "@/lib/admin-formato";
import { registrarEvento } from "@/lib/log";
import { PAPEIS, ROTULO_PAPEL, normalizarPapel, type PapelUsuario } from "@/lib/papeis";
import { gerarHashSenha } from "@/lib/senha";
import { gerarSenhaLegivel } from "@/lib/senha-legivel";
import type { SessaoPayload } from "@/lib/sessao-token";

export type SenhaEmitida = { login: string; nome: string; senha: string };
export type ResultadoUsuario<T extends object = object> = ({ ok: true } & T) | { ok: false; erro: string };

const ROTA = "/admin/usuarios";

const idSchema = z.number({ error: "Usuário inválido" }).int("Usuário inválido").positive("Usuário inválido");
const soIdSchema = z.object({ id: idSchema });

const loginSchema = z
  .string({ error: "Informe o login" })
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9._-]{1,29}$/,
    "Login inválido — use letras minúsculas, números, ponto, hífen ou _ (2 a 30 caracteres, começando por letra)"
  );

const nomeSchema = z
  .string({ error: "Informe o nome" })
  .max(200, "Nome longo demais (máximo 80 caracteres)")
  .transform(limparNome)
  .refine((n) => n.length >= 1, "Informe o nome")
  .refine((n) => n.length <= 80, "Nome longo demais (máximo 80 caracteres)")
  .refine((n) => !temControle(n), "O nome tem caracteres inválidos");

const papelSchema = z.enum(PAPEIS as [PapelUsuario, ...PapelUsuario[]], { error: "Escolha o papel" });
const aptoSchema = z.number({ error: "Apartamento inválido" }).int("Apartamento inválido").positive("Apartamento inválido").nullish();

const criarSchema = z.object({ login: loginSchema, nome: nomeSchema, papel: papelSchema, apartamentoId: aptoSchema });
const editarSchema = z.object({ id: idSchema, nome: nomeSchema, papel: papelSchema, apartamentoId: aptoSchema });

const primeiroErro = (e: z.ZodError): string => e.issues[0]?.message ?? "Dados inválidos";
const rotuloPapel = (p: string): string => {
  const n = normalizarPapel(p);
  return n ? ROTULO_PAPEL[n] : p;
};

function revalidar(): void {
  revalidatePath(ROTA);
  revalidatePath("/admin/logs");
}

const cederVez = (): Promise<void> => new Promise((r) => setImmediate(r));

type Cliente = Prisma.TransactionClient | typeof prisma;

/** Existe outro administrador ATIVO além de `exceto`? */
async function haOutroAdminAtivo(db: Cliente, exceto: number): Promise<boolean> {
  return (await db.usuario.count({ where: { papel: "admin", ativo: true, NOT: { id: exceto } } })) > 0;
}

/** Apartamento ATIVO para o login de morador, ou a mensagem de erro. */
async function aptoDoMorador(id: number | null | undefined): Promise<{ id: number; numero: string } | string> {
  if (!id) return "Escolha o apartamento do morador";
  const apto = await prisma.apartamento.findUnique({ where: { id }, select: { id: true, numero: true, ativo: true } });
  if (!apto) return "Apartamento não encontrado";
  if (!apto.ativo) return `O apartamento ${apto.numero} está inativo`;
  return { id: apto.id, numero: apto.numero };
}

const log = (sessao: SessaoPayload, detalhe: string): Promise<void> => registrarEvento(sessao, "usuario", ROTA, detalhe);

async function falhaInesperada(acao: string, sessao: SessaoPayload, e: unknown): Promise<{ ok: false; erro: string }> {
  console.error(`${acao} falhou:`, e);
  await registrarEvento(sessao, "erro", ROTA, `${acao}: ${e instanceof Error ? e.message : String(e)}`);
  return { ok: false, erro: "Não foi possível salvar agora. Tente de novo." };
}

/* ------------------------------------------------------------------ criar */

export async function criarUsuario(entrada: {
  login: string;
  nome: string;
  papel: PapelUsuario;
  apartamentoId?: number | null;
}): Promise<ResultadoUsuario<{ emitida: SenhaEmitida }>> {
  const g = await guardaAdmin();
  if ("erro" in g) return { ok: false, erro: g.erro };
  const parsed = criarSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: primeiroErro(parsed.error) };
  const { login, nome, papel } = parsed.data;

  try {
    let apto: { id: number; numero: string } | null = null;
    if (papel === "morador") {
      const r = await aptoDoMorador(parsed.data.apartamentoId);
      if (typeof r === "string") return { ok: false, erro: r };
      apto = r;
    }
    const senha = gerarSenhaLegivel();
    const { hash, salt } = gerarHashSenha(senha);
    await prisma.usuario.create({
      data: {
        login,
        nome,
        papel,
        apartamentoId: apto?.id ?? null,
        senhaHash: hash,
        senhaSalt: salt,
        precisaTrocarSenha: true,
      },
    });
    await log(g.sessao, `Criou o usuário "${login}" (${rotuloPapel(papel)}${apto ? `, apto ${apto.numero}` : ""})`);
    revalidar();
    return { ok: true, emitida: { login, nome, senha } };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, erro: "Já existe um usuário com esse login" };
    }
    return falhaInesperada("criarUsuario", g.sessao, e);
  }
}

/* ----------------------------------------------------------------- editar */

export async function editarUsuario(entrada: {
  id: number;
  nome: string;
  papel: PapelUsuario;
  apartamentoId?: number | null;
}): Promise<ResultadoUsuario<{ aviso?: string }>> {
  const g = await guardaAdmin();
  if ("erro" in g) return { ok: false, erro: g.erro };
  const parsed = editarSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: primeiroErro(parsed.error) };
  const { id, nome, papel } = parsed.data;

  try {
    const alvo = await prisma.usuario.findUnique({ where: { id }, include: { apartamento: { select: { numero: true } } } });
    if (!alvo) return { ok: false, erro: "Usuário não encontrado" };

    const papelAtual = normalizarPapel(alvo.papel);
    if (alvo.id === g.sessao.id && papel !== "admin") {
      return { ok: false, erro: "Você não pode tirar o seu próprio acesso de administrador" };
    }

    let apto: { id: number; numero: string } | null = null;
    if (papel === "morador") {
      // o apto só é revalidado (ativo) quando muda; manter o atual é sempre aceito
      if (parsed.data.apartamentoId && parsed.data.apartamentoId === alvo.apartamentoId) {
        apto = { id: alvo.apartamentoId, numero: alvo.apartamento?.numero ?? "" };
      } else {
        const r = await aptoDoMorador(parsed.data.apartamentoId);
        if (typeof r === "string") return { ok: false, erro: r };
        apto = r;
      }
    }

    const mudancas: string[] = [];
    if (nome !== alvo.nome) mudancas.push(`nome "${alvo.nome}" → "${nome}"`);
    if (papel !== papelAtual) mudancas.push(`papel ${rotuloPapel(alvo.papel)} → ${rotuloPapel(papel)}`);
    if ((apto?.id ?? null) !== alvo.apartamentoId) {
      mudancas.push(`apto ${alvo.apartamento?.numero ?? "nenhum"} → ${apto?.numero ?? "nenhum"}`);
    }
    if (mudancas.length === 0) return { ok: true, aviso: "Nada mudou" };

    const tiraAdmin = papelAtual === "admin" && papel !== "admin";
    const negado = await prisma.$transaction(async (tx) => {
      if (tiraAdmin && alvo.ativo && !(await haOutroAdminAtivo(tx, alvo.id))) {
        return "É preciso manter pelo menos um administrador ativo";
      }
      await tx.usuario.update({
        where: { id },
        data: { nome, papel, apartamentoId: apto?.id ?? null },
      });
      return null;
    });
    if (negado) return { ok: false, erro: negado };

    await log(g.sessao, `Editou o usuário "${alvo.login}": ${mudancas.join("; ")}`);
    revalidar();
    return { ok: true };
  } catch (e) {
    return falhaInesperada("editarUsuario", g.sessao, e);
  }
}

/* ----------------------------------------------------------- redefinir senha */

export async function redefinirSenha(entrada: { id: number }): Promise<ResultadoUsuario<{ emitida: SenhaEmitida }>> {
  const g = await guardaAdmin();
  if ("erro" in g) return { ok: false, erro: g.erro };
  const parsed = soIdSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: primeiroErro(parsed.error) };
  const { id } = parsed.data;

  try {
    const alvo = await prisma.usuario.findUnique({ where: { id } });
    if (!alvo) return { ok: false, erro: "Usuário não encontrado" };
    if (alvo.id === g.sessao.id) {
      return { ok: false, erro: "Para trocar a sua própria senha use “Trocar minha senha” (ela exige a senha atual)" };
    }
    const senha = gerarSenhaLegivel();
    const { hash, salt } = gerarHashSenha(senha);
    await prisma.usuario.update({
      where: { id },
      data: { senhaHash: hash, senhaSalt: salt, precisaTrocarSenha: true },
    });
    await log(g.sessao, `Redefiniu a senha de "${alvo.login}" (sessões abertas encerradas; troca obrigatória no próximo acesso)`);
    revalidar();
    return { ok: true, emitida: { login: alvo.login, nome: alvo.nome, senha } };
  } catch (e) {
    return falhaInesperada("redefinirSenha", g.sessao, e);
  }
}

/* ------------------------------------------------------ desativar / reativar */

/** Desativa respeitando as proteções. Devolve a mensagem de erro, ou null quando desativou. */
async function desativarComProtecao(
  alvo: { id: number; papel: string; ativo: boolean },
  sessao: SessaoPayload
): Promise<string | null> {
  if (alvo.id === sessao.id) return "Você não pode desativar a si mesmo";
  return prisma.$transaction(async (tx) => {
    if (alvo.papel === "admin" && alvo.ativo && !(await haOutroAdminAtivo(tx, alvo.id))) {
      return "É preciso manter pelo menos um administrador ativo";
    }
    await tx.usuario.update({ where: { id: alvo.id }, data: { ativo: false } });
    return null;
  });
}

export async function desativarUsuario(entrada: { id: number }): Promise<ResultadoUsuario<{ aviso?: string }>> {
  const g = await guardaAdmin();
  if ("erro" in g) return { ok: false, erro: g.erro };
  const parsed = soIdSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: primeiroErro(parsed.error) };

  try {
    const alvo = await prisma.usuario.findUnique({ where: { id: parsed.data.id } });
    if (!alvo) return { ok: false, erro: "Usuário não encontrado" };
    if (!alvo.ativo) return { ok: true, aviso: "O usuário já estava desativado" };
    const negado = await desativarComProtecao(alvo, g.sessao);
    if (negado) return { ok: false, erro: negado };
    await log(g.sessao, `Desativou o usuário "${alvo.login}"`);
    revalidar();
    return { ok: true };
  } catch (e) {
    return falhaInesperada("desativarUsuario", g.sessao, e);
  }
}

export async function reativarUsuario(entrada: { id: number }): Promise<ResultadoUsuario<{ aviso?: string }>> {
  const g = await guardaAdmin();
  if ("erro" in g) return { ok: false, erro: g.erro };
  const parsed = soIdSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: primeiroErro(parsed.error) };

  try {
    const alvo = await prisma.usuario.findUnique({ where: { id: parsed.data.id }, include: { apartamento: { select: { ativo: true, numero: true } } } });
    if (!alvo) return { ok: false, erro: "Usuário não encontrado" };
    if (alvo.ativo) return { ok: true, aviso: "O usuário já estava ativo" };
    if (alvo.papel === "morador" && alvo.apartamento && !alvo.apartamento.ativo) {
      return { ok: false, erro: `O apartamento ${alvo.apartamento.numero} está inativo` };
    }
    await prisma.usuario.update({ where: { id: alvo.id }, data: { ativo: true } });
    await log(g.sessao, `Reativou o usuário "${alvo.login}"`);
    revalidar();
    return { ok: true };
  } catch (e) {
    return falhaInesperada("reativarUsuario", g.sessao, e);
  }
}

/* ------------------------------------------------------------------ excluir */

export async function excluirUsuario(
  entrada: { id: number }
): Promise<ResultadoUsuario<{ excluido: boolean; desativado: boolean; aviso: string }>> {
  const g = await guardaAdmin();
  if ("erro" in g) return { ok: false, erro: g.erro };
  const parsed = soIdSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: primeiroErro(parsed.error) };

  try {
    const alvo = await prisma.usuario.findUnique({ where: { id: parsed.data.id } });
    if (!alvo) return { ok: false, erro: "Usuário não encontrado" };
    if (alvo.id === g.sessao.id) return { ok: false, erro: "Você não pode excluir a si mesmo" };

    const [eventos, inscricoes] = await Promise.all([
      prisma.logEvento.count({ where: { usuarioId: alvo.id } }),
      prisma.pushInscricao.count({ where: { usuarioId: alvo.id } }),
    ]);

    if (!alvo.ativo && eventos === 0 && inscricoes === 0) {
      await prisma.usuario.delete({ where: { id: alvo.id } });
      await log(g.sessao, `Excluiu o usuário "${alvo.login}"`);
      revalidar();
      return { ok: true, excluido: true, desativado: false, aviso: `Usuário “${alvo.login}” excluído` };
    }

    // não pode excluir: fica (ou passa a ficar) apenas desativado
    const motivo =
      eventos > 0 || inscricoes > 0
        ? `tem ${eventos} evento(s) no livro${inscricoes > 0 ? " e inscrições de notificação" : ""} e a trilha precisa ser preservada`
        : "só se exclui quem já está desativado";
    if (!alvo.ativo) {
      return { ok: true, excluido: false, desativado: false, aviso: `Não foi excluído: ${motivo}. Segue desativado.` };
    }
    const negado = await desativarComProtecao(alvo, g.sessao);
    if (negado) return { ok: false, erro: negado };
    await log(g.sessao, `Exclusão de "${alvo.login}" não permitida (${motivo}); o usuário foi apenas desativado`);
    revalidar();
    return { ok: true, excluido: false, desativado: true, aviso: `Não foi excluído (${motivo}); o usuário foi desativado.` };
  } catch (e) {
    return falhaInesperada("excluirUsuario", g.sessao, e);
  }
}

/* --------------------------------------------------- logins faltantes (aptos) */

/**
 * Para todo apartamento ATIVO sem o usuário `ap<numero>` cria um (morador,
 * senha própria, troca obrigatória). Útil quando entra apto novo ou o login
 * de um apto foi excluído. As senhas voltam UMA vez para o administrador.
 */
export async function gerarLoginsFaltantes(): Promise<
  ResultadoUsuario<{ emitidas: SenhaEmitida[]; aviso?: string }>
> {
  const g = await guardaAdmin();
  if ("erro" in g) return { ok: false, erro: g.erro };

  try {
    const faltantes = await aptosSemLogin();
    if (faltantes.length === 0) {
      return { ok: true, emitidas: [], aviso: "Todos os apartamentos ativos já têm login" };
    }

    const emitidas: SenhaEmitida[] = [];
    const dados: Prisma.UsuarioUncheckedCreateInput[] = [];
    for (const a of faltantes) {
      const senha = gerarSenhaLegivel();
      const { hash, salt } = gerarHashSenha(senha); // scrypt síncrono: cede a vez entre um e outro
      const login = loginDoApartamento(a.numero);
      const nome = `Apto ${a.numero}`;
      dados.push({ login, nome, papel: "morador", apartamentoId: a.id, senhaHash: hash, senhaSalt: salt, precisaTrocarSenha: true });
      emitidas.push({ login, nome, senha });
      await cederVez();
    }
    await prisma.$transaction(dados.map((data) => prisma.usuario.create({ data })));

    await log(g.sessao, `Gerou ${emitidas.length} login(s) de moradores: ${emitidas.map((e) => e.login).join(", ")}`);
    revalidar();
    return { ok: true, emitidas };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, erro: "Algum login foi criado ao mesmo tempo — recarregue a página e tente de novo" };
    }
    return falhaInesperada("gerarLoginsFaltantes", g.sessao, e);
  }
}
