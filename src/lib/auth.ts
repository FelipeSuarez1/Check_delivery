/** Leitura da sessão no lado do servidor (pages/layouts/actions). */
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { normalizarPapel, papelOperaPortaria, type PapelUsuario } from "@/lib/papeis";
import { COOKIE_SESSAO, segredoSessaoValido, verificarSessao, type SessaoPayload } from "@/lib/sessao-token";
import { versaoSenha } from "@/lib/senha";
import { prisma } from "@/lib/db";

// O nome do cookie vive em sessao-token.ts (o middleware, que é edge, não pode
// importar este arquivo). 22/10/2026: não é mais "sessao" — em localhost o site
// financeiro (porta 3000) e este app (3001) dividiam o mesmo cookie e um login
// derrubava o outro.
export { COOKIE_SESSAO };
export const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

export function segredoAuth(): string {
  const s = process.env.AUTH_SECRET;
  if (!segredoSessaoValido(s)) {
    throw new Error("AUTH_SECRET ausente, curto (< 32 caracteres) ou ainda é o valor de exemplo no .env");
  }
  return s;
}

export async function lerSessao(): Promise<SessaoPayload | null> {
  const jar = await cookies();
  return verificarSessao(jar.get(COOKIE_SESSAO)?.value, segredoAuth());
}

export type EstadoSessao =
  | { estado: "valida"; sessao: SessaoPayload; precisaTrocarSenha: boolean }
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
    select: {
      nome: true,
      papel: true,
      ativo: true,
      senhaHash: true,
      apartamentoId: true,
      precisaTrocarSenha: true,
    },
  });
  if (!usuario) return { estado: "encerrada" };
  if (!usuario.ativo) return { estado: "inativa" };
  const papel = normalizarPapel(usuario.papel);
  if (!papel) return { estado: "encerrada" };
  // `sv` é obrigatório (todo token nosso o carrega): token sem ele não vale
  if (sessao.sv !== versaoSenha(usuario.senhaHash)) return { estado: "encerrada" };
  return {
    estado: "valida",
    sessao: { ...sessao, nome: usuario.nome, papel, apartamentoId: usuario.apartamentoId ?? null },
    precisaTrocarSenha: usuario.precisaTrocarSenha,
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

/**
 * Em PAGES e layouts de área: 404 quando o papel não é um dos aceitos (não
 * revela a tela); senha inicial ainda não trocada → /conta/senha.
 *
 * O desvio para /conta/senha mora AQUI (e não só no layout raiz) porque o
 * layout raiz não re-renderiza em navegação suave (ex.: o redirect do login
 * para /app), enquanto cada page re-renderiza a cada navegação.
 */
export async function exigirPapelNaPagina(...papeis: PapelUsuario[]): Promise<SessaoPayload> {
  const estado = await estadoDaSessao();
  if (estado.estado !== "valida" || !papeis.includes(estado.sessao.papel)) notFound();
  if (estado.precisaTrocarSenha) redirect("/conta/senha");
  return estado.sessao;
}

export const MSG_SESSAO_EXPIRADA = "Sessão expirada — faça login de novo";
export const MSG_SEM_PERMISSAO = "Sem permissão para esta ação";
export const MSG_SO_ADMIN = "Só o administrador pode fazer isso";
