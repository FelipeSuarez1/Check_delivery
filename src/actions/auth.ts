"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { conferirSenhaAsync, gerarHashSenha, versaoSenha } from "@/lib/senha";
import { normalizarPapel } from "@/lib/papeis";
import { assinarSessao, destinoPosLoginParaPapel } from "@/lib/sessao-token";
import { COOKIE_SESSAO, DURACAO_SESSAO_MS, lerSessao, segredoAuth } from "@/lib/auth";
import { criarLimitador, reservarVaga } from "@/lib/limite-tentativas";
import { registrarEvento } from "@/lib/log";

// hash de referência: login inexistente custa o mesmo scrypt que senha errada
// (sem ele, a resposta mais rápida entregava quais logins existem)
const DUMMY = gerarHashSenha("senha-de-referencia-nunca-valida");

// 5 falhas seguidas do MESMO login vindo da MESMA origem → 1 minuto de bloqueio.
const limiteLogin = criarLimitador("login", {
  maxFalhas: 5,
  bloqueioMs: 60_000,
  janelaMs: 15 * 60_000,
  maxChaves: 5_000,
});
const MAX_EM_ANDAMENTO = 8;

/**
 * Identifica a origem da tentativa. Atrás de um proxy o cliente pode ANEXAR
 * cabeçalhos de encaminhamento: usar o primeiro valor de x-forwarded-for deixa o
 * atacante escolher a chave e o bloqueio nunca dispara. Vale o que o hop mais
 * próximo escreveu — `cf-connecting-ip` (posto pelo Cloudflare, que descarta o
 * que vier de fora) ou o ÚLTIMO elemento da cadeia.
 */
async function origemDaRequisicao(): Promise<string> {
  const h = await headers();
  const doCloudflare = h.get("cf-connecting-ip")?.trim();
  if (doCloudflare) return doCloudflare.slice(0, 64);
  const ultimo = h.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return (ultimo || h.get("x-real-ip")?.trim() || "local").slice(0, 64);
}

const entrarSchema = z.object({
  login: z.string().trim().toLowerCase().min(1).max(60),
  senha: z.string().min(1).max(200),
  next: z.string().max(500).optional().default(""),
});

/**
 * Entra com login + senha. Sempre termina em redirect: sucesso → tela inicial
 * do papel (ou o `next` validado); falha → /login?erro=… (funciona sem JS).
 * Erros: 1 = usuário/senha incorretos · 2 = muitas tentativas.
 */
export async function entrar(formData: FormData): Promise<void> {
  const parsed = entrarSchema.safeParse({
    login: formData.get("login") ?? "",
    senha: formData.get("senha") ?? "",
    next: formData.get("next") ?? "",
  });
  if (!parsed.success) redirect("/login?erro=1");
  const { login, senha, next } = parsed.data;
  // o erro volta preservando o login digitado e o destino original (a senha
  // nunca vai para a URL)
  const volta = (erro: string) =>
    `/login?erro=${erro}&login=${encodeURIComponent(login)}` +
    (next ? `&next=${encodeURIComponent(next)}` : "");

  const chave = `${login}|${await origemDaRequisicao()}`;
  if (limiteLogin.bloqueado(chave)) redirect(volta("2"));
  const liberarVaga = reservarVaga("login", MAX_EM_ANDAMENTO);
  if (!liberarVaga) redirect(volta("2"));

  let autenticado: {
    id: number;
    nome: string;
    papel: string;
    senhaHash: string;
    apartamentoId: number | null;
    precisaTrocarSenha: boolean;
  } | null = null;
  try {
    const usuario = await prisma.usuario.findUnique({ where: { login } });
    // sempre um scrypt, mesmo com login inexistente ou conta desativada — a
    // diferença de tempo entregaria quais logins existem e quais estão inativos
    const senhaConfere = usuario
      ? await conferirSenhaAsync(senha, usuario.senhaSalt, usuario.senhaHash)
      : await conferirSenhaAsync(senha, DUMMY.salt, DUMMY.hash);
    if (usuario && usuario.ativo && senhaConfere) autenticado = usuario;
  } finally {
    liberarVaga();
  }

  if (!autenticado) {
    limiteLogin.registrarFalha(chave);
    redirect(volta("1"));
  }
  const usuario = autenticado;
  // papel fora da lista (dado corrompido) não vira sessão — mesma decisão de
  // estadoDaSessao, que já encerraria a sessão na navegação seguinte
  const papel = normalizarPapel(usuario.papel);
  if (!papel) {
    limiteLogin.registrarFalha(chave);
    redirect(volta("1"));
  }
  limiteLogin.limpar(chave);

  const token = await assinarSessao(
    {
      id: usuario.id,
      nome: usuario.nome,
      papel,
      exp: Date.now() + DURACAO_SESSAO_MS,
      sv: versaoSenha(usuario.senhaHash),
      apartamentoId: usuario.apartamentoId,
    },
    segredoAuth()
  );
  const jar = await cookies();
  jar.set(COOKIE_SESSAO, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: DURACAO_SESSAO_MS / 1000,
    path: "/",
  });
  const ua = (await headers()).get("user-agent")?.slice(0, 200);
  await registrarEvento({ id: usuario.id, nome: usuario.nome, papel }, "login", "/login", ua ? `ua: ${ua}` : undefined);
  // Primeiro acesso: direto para a troca de senha (o layout raiz não re-renderiza
  // nesta navegação suave, então não dá para deixar só com ele). O `next` fica
  // perdido de propósito: depois da troca o usuário cai na tela do papel.
  if (usuario.precisaTrocarSenha) redirect("/conta/senha");
  // `next` que o papel não pode abrir cai na tela inicial do papel
  redirect(destinoPosLoginParaPapel(next, papel));
}

/** Encerra a sessão deste aparelho (as de outros aparelhos seguem valendo). */
export async function sair(): Promise<void> {
  const sessao = await lerSessao();
  if (sessao) await registrarEvento(sessao, "logout", "/login");
  const jar = await cookies();
  jar.delete(COOKIE_SESSAO);
  redirect("/login");
}
