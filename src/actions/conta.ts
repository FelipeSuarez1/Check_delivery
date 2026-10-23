"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { conferirSenhaAsync, gerarHashSenha, versaoSenha } from "@/lib/senha";
import { normalizarPapel } from "@/lib/papeis";
import { assinarSessao } from "@/lib/sessao-token";
import {
  COOKIE_SESSAO,
  DURACAO_SESSAO_MS,
  lerSessaoVerificada,
  MSG_SESSAO_EXPIRADA,
  segredoAuth,
} from "@/lib/auth";
import { criarLimitador } from "@/lib/limite-tentativas";
import { registrarEvento } from "@/lib/log";

// Quem conseguiu uma sessão aberta (aparelho esquecido) não pode usar a troca
// de senha como oráculo para descobrir a senha atual: 5 erros → 1 minuto.
const limiteTroca = criarLimitador("troca-senha", {
  maxFalhas: 5,
  bloqueioMs: 60_000,
  janelaMs: 15 * 60_000,
  maxChaves: 1_000,
});

// Senhas que ninguém deveria usar num app com os dados da portaria. Não é
// política de complexidade (o app é pequeno) — só barra o óbvio.
const OBVIAS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "87654321",
  "11111111",
  "00000000",
  "senha123",
  "senha1234",
  "password",
  "password1",
  "qwertyui",
  "abcd1234",
  "tangara123",
  "tangara2026",
  "condominio",
  "portaria123",
]);

const schema = z.object({
  atual: z.string().min(1, "Informe a senha atual").max(200),
  nova: z
    .string()
    .min(8, "A nova senha precisa ter pelo menos 8 caracteres")
    .max(72, "Senha longa demais (máximo 72 caracteres)"),
});

export type ResultadoTrocaSenha = { ok: boolean; erro?: string };

/**
 * Troca da PRÓPRIA senha — vale para os três papéis. Exige a senha atual, mínimo
 * de 8 caracteres e senha diferente da atual. Como o token carrega `sv` (marca
 * derivada do hash), trocar a senha derrubaria a sessão corrente: o cookie é
 * reemitido aqui com a marca nova. Sessões em OUTROS aparelhos caem na
 * navegação seguinte — é o desejado (quem troca a senha quer o resto deslogado).
 * Também zera `precisaTrocarSenha` (fluxo do primeiro acesso).
 */
export async function trocarSenha(entrada: { atual: string; nova: string }): Promise<ResultadoTrocaSenha> {
  const sessao = await lerSessaoVerificada();
  if (!sessao) return { ok: false, erro: MSG_SESSAO_EXPIRADA };

  const parsed = schema.safeParse({ atual: entrada?.atual ?? "", nova: entrada?.nova ?? "" });
  if (!parsed.success) return { ok: false, erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  const { atual, nova } = parsed.data;

  const chave = `conta|${sessao.id}`;
  if (limiteTroca.bloqueado(chave)) {
    return { ok: false, erro: "Muitas tentativas — aguarde um minuto e tente de novo." };
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: sessao.id } });
  if (!usuario || !usuario.ativo) return { ok: false, erro: MSG_SESSAO_EXPIRADA };
  const papel = normalizarPapel(usuario.papel);
  if (!papel) return { ok: false, erro: MSG_SESSAO_EXPIRADA };

  const confere = await conferirSenhaAsync(atual, usuario.senhaSalt, usuario.senhaHash);
  if (!confere) {
    limiteTroca.registrarFalha(chave);
    return { ok: false, erro: "Senha atual incorreta" };
  }
  limiteTroca.limpar(chave);

  if (nova === atual) return { ok: false, erro: "A nova senha precisa ser diferente da atual" };
  const minuscula = nova.toLowerCase();
  if (
    OBVIAS.has(minuscula) ||
    minuscula === usuario.login.toLowerCase() ||
    new Set(nova).size === 1
  ) {
    return { ok: false, erro: "Escolha uma senha menos óbvia (não use sequências, o seu usuário ou letras repetidas)" };
  }

  const { hash, salt } = gerarHashSenha(nova);
  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { senhaHash: hash, senhaSalt: salt, precisaTrocarSenha: false },
  });

  // reemite a sessão deste aparelho com a marca da senha nova
  const token = await assinarSessao(
    {
      id: usuario.id,
      nome: usuario.nome,
      papel,
      exp: Date.now() + DURACAO_SESSAO_MS,
      sv: versaoSenha(hash),
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

  await registrarEvento({ id: usuario.id, nome: usuario.nome, papel }, "usuario", "/conta/senha", "Trocou a própria senha");
  // o layout raiz decide o redirecionamento do primeiro acesso: precisa reler
  revalidatePath("/", "layout");
  return { ok: true };
}
