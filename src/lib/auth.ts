/** Leitura da sessão no lado do servidor (pages/layouts/actions). */
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { normalizarPapel, papelOperaPortaria, type PapelUsuario } from "@/lib/papeis";
import { verificarSessao, type SessaoPayload } from "@/lib/sessao-token";
import { versaoSenha } from "@/lib/senha";
import { prisma } from "@/lib/db";

export const COOKIE_SESSAO = "sessao";
export const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

export function segredoAuth(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET ausente no .env");
  return s;
}

export async function lerSessao(): Promise<SessaoPayload | null> {
  const jar = await cookies();
  return verificarSessao(jar.get(COOKIE_SESSAO)?.value, segredoAuth());
}

export type EstadoSessao =
  | { estado: "valida"; sessao: SessaoPayload }
  | { estado: "inativa" }
  | { estado: "encerrada" }
  | { estado: "ausente" };

/**
 * Sessão reconferida no banco a cada uso: desativar um usuário, trocar o papel
 * ou redefinir a senha vale na navegação seguinte, não só quando o cookie
 * expirar. `cache()` = uma consulta por requisição. O papel e o apartamento
 * do BANCO mandam (o token pode estar velho).
 */
export const estadoDaSessao = cache(async (): Promise<EstadoSessao> => {
  const sessao = await lerSessao();
  if (!sessao) return { estado: "ausente" };
  const usuario = await prisma.usuario.findUnique({
    where: { id: sessao.id },
    select: { nome: true, papel: true, ativo: true, senhaHash: true, apartamentoId: true },
  });
  if (!usuario) return { estado: "encerrada" };
  if (!usuario.ativo) return { estado: "inativa" };
  const papel = normalizarPapel(usuario.papel);
  if (!papel) return { estado: "encerrada" };
  if (sessao.sv && sessao.sv !== versaoSenha(usuario.senhaHash)) return { estado: "encerrada" };
  return {
    estado: "valida",
    sessao: { ...sessao, nome: usuario.nome, papel, apartamentoId: usuario.apartamentoId ?? null },
  };
});

export async function lerSessaoVerificada(): Promise<SessaoPayload | null> {
  const r = await estadoDaSessao();
  return r.estado === "valida" ? r.sessao : null;
}

/** Guarda de leitura/escrita da portaria (admin também opera o balcão). */
export async function exigirPortariaOuAdmin(): Promise<SessaoPayload | null> {
  const sessao = await lerSessaoVerificada();
  return sessao && papelOperaPortaria(sessao.papel) ? sessao : null;
}

export async function exigirAdmin(): Promise<SessaoPayload | null> {
  const sessao = await lerSessaoVerificada();
  return sessao?.papel === "admin" ? sessao : null;
}

/** Sessão de MORADOR com apartamento (o apto vem da sessão, nunca da URL). */
export async function exigirMorador(): Promise<(SessaoPayload & { apartamentoId: number }) | null> {
  const sessao = await lerSessaoVerificada();
  if (!sessao || sessao.papel !== "morador" || !sessao.apartamentoId) return null;
  return { ...sessao, apartamentoId: sessao.apartamentoId };
}

/** Em PAGES: 404 quando o papel não é um dos aceitos (não revela a tela). */
export async function exigirPapelNaPagina(...papeis: PapelUsuario[]): Promise<SessaoPayload> {
  const sessao = await lerSessaoVerificada();
  if (!sessao || !papeis.includes(sessao.papel)) notFound();
  return sessao;
}

export const MSG_SESSAO_EXPIRADA = "Sessão expirada — faça login de novo";
export const MSG_SEM_PERMISSAO = "Sem permissão para esta ação";
export const MSG_SO_ADMIN = "Só o administrador pode fazer isso";
