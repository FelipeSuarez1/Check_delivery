"use server";

/**
 * Turno da portaria (22/10/2026). Guarda: `portaria` e `admin`. Um turno aberto
 * por vez; o porteiro dele é gravado em cada registro/entrega.
 * Tudo que é EXPORTADO aqui vira endpoint público de Server Action: só as 3
 * actions saem deste arquivo (a regra mora em `lib/turno.ts`).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  MSG_SEM_PERMISSAO,
  MSG_SESSAO_EXPIRADA,
  exigirPortariaOuAdmin,
  lerSessaoVerificada,
} from "@/lib/auth";
import { ErroDominio } from "@/lib/erro-dominio";
import { registrarEvento } from "@/lib/log";
import { abrirTurno, buscarTurnoAberto, fecharTurno, type TurnoAberto } from "@/lib/turno";

export type TurnoAbertoDTO = TurnoAberto;

export type ResultadoIniciarTurno =
  | { ok: true; turno: TurnoAbertoDTO; /** false = o turno desse porteiro já estava aberto */ trocou: boolean }
  | { ok: false; erro: string };

export type ResultadoEncerrarTurno = { ok: true; turno: TurnoAbertoDTO } | { ok: false; erro: string };

const schemaIniciar = z.object({
  porteiroId: z.number({ error: "Escolha o porteiro" }).int().positive("Escolha o porteiro"),
});

function revalidarTurno(): void {
  // o chip do turno aparece no cabeçalho de toda a área da portaria e do admin
  revalidatePath("/portaria", "layout");
  revalidatePath("/admin", "layout");
}

/** Abre o turno de `porteiroId`, encerrando qualquer outro aberto. */
export async function iniciarTurno(entrada: { porteiroId: number }): Promise<ResultadoIniciarTurno> {
  const sessao = await exigirPortariaOuAdmin();
  if (!sessao) {
    return { ok: false, erro: (await lerSessaoVerificada()) ? MSG_SEM_PERMISSAO : MSG_SESSAO_EXPIRADA };
  }
  const parsed = schemaIniciar.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  try {
    const r = await abrirTurno(parsed.data.porteiroId);
    if (!r.reaproveitado) {
      await registrarEvento(
        sessao,
        "turno",
        "/portaria/turno",
        r.anterior
          ? `Turno iniciado: ${r.turno.porteiroNome} (encerrou o turno de ${r.anterior.porteiroNome})`
          : `Turno iniciado: ${r.turno.porteiroNome}`
      );
      revalidarTurno();
    }
    return { ok: true, turno: r.turno, trocou: !r.reaproveitado };
  } catch (e) {
    if (e instanceof ErroDominio) return { ok: false, erro: e.message };
    console.error("iniciarTurno falhou:", e);
    await registrarEvento(sessao, "erro", "/portaria/turno", `iniciarTurno: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, erro: "Não foi possível abrir o turno agora. Tente de novo." };
  }
}

/** Encerra o turno aberto. Sem turno aberto: erro (a tela já deveria mostrar "abrir turno"). */
export async function encerrarTurno(): Promise<ResultadoEncerrarTurno> {
  const sessao = await exigirPortariaOuAdmin();
  if (!sessao) {
    return { ok: false, erro: (await lerSessaoVerificada()) ? MSG_SEM_PERMISSAO : MSG_SESSAO_EXPIRADA };
  }
  try {
    const fechado = await fecharTurno();
    if (!fechado) return { ok: false, erro: "Não há turno aberto" };
    await registrarEvento(sessao, "turno", "/portaria/turno", `Turno encerrado: ${fechado.porteiroNome}`);
    revalidarTurno();
    return { ok: true, turno: fechado };
  } catch (e) {
    console.error("encerrarTurno falhou:", e);
    await registrarEvento(sessao, "erro", "/portaria/turno", `encerrarTurno: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, erro: "Não foi possível encerrar o turno agora. Tente de novo." };
  }
}

/** Leitura: turno aberto agora, ou null (também null para quem não opera a portaria). */
export async function turnoAberto(): Promise<TurnoAbertoDTO | null> {
  const sessao = await exigirPortariaOuAdmin();
  if (!sessao) return null;
  return buscarTurnoAberto();
}
