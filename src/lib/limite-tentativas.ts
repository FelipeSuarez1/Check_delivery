/**
 * Contenção de força bruta em memória (app de 1 processo). Usada pelo login
 * (chave = login + origem) e pela troca de senha (chave = usuário).
 *
 * Decisões herdadas do site financeiro:
 * - a chave do login NUNCA é só o login: senão qualquer um travaria a conta de
 *   outra pessoa, de fora, errando a senha de propósito (lockout como DoS);
 * - bloqueio vigente nunca é descartado para abrir espaço no mapa (era o furo
 *   que deixava um atacante encher o mapa e soltar quem estava contido);
 * - o estado fica em `globalThis`: em desenvolvimento o mesmo módulo pode ser
 *   carregado mais de uma vez (cada rota/bundle) e cada cópia teria o seu mapa.
 */

type Entrada = { falhas: number; bloqueadoAte: number; visto: number };

export type OpcoesLimitador = {
  /** falhas seguidas (dentro da janela) que disparam o bloqueio */
  maxFalhas: number;
  bloqueioMs: number;
  /** sem falhar de novo por esse tempo, a contagem da chave é descartada */
  janelaMs: number;
  /** teto de chaves guardadas */
  maxChaves: number;
};

export type Limitador = {
  bloqueado(chave: string): boolean;
  registrarFalha(chave: string): void;
  limpar(chave: string): void;
};

type Estado = { mapas: Map<string, Map<string, Entrada>>; vagas: Map<string, number> };
const g = globalThis as unknown as { __limiteTentativas?: Estado };
const estado: Estado = (g.__limiteTentativas ??= { mapas: new Map(), vagas: new Map() });

export function criarLimitador(nome: string, opcoes: OpcoesLimitador): Limitador {
  let mapa = estado.mapas.get(nome);
  if (!mapa) {
    mapa = new Map();
    estado.mapas.set(nome, mapa);
  }
  const tentativas = mapa;

  function limparExpiradas(agora: number) {
    for (const [chave, t] of tentativas) {
      if (t.bloqueadoAte > agora) continue;
      if (t.visto + opcoes.janelaMs < agora) tentativas.delete(chave);
    }
    // ainda cheio só de bloqueios vigentes: descarta o mais antigo
    while (tentativas.size >= opcoes.maxChaves) {
      const maisAntiga = [...tentativas.entries()].sort((a, b) => a[1].visto - b[1].visto)[0];
      if (!maisAntiga) break;
      tentativas.delete(maisAntiga[0]);
    }
  }

  return {
    bloqueado(chave) {
      const t = tentativas.get(chave);
      return !!t && Date.now() < t.bloqueadoAte;
    },
    registrarFalha(chave) {
      const agora = Date.now();
      if (tentativas.size >= opcoes.maxChaves) limparExpiradas(agora);
      const anterior = tentativas.get(chave);
      const t =
        anterior && anterior.visto + opcoes.janelaMs >= agora
          ? anterior
          : { falhas: 0, bloqueadoAte: 0, visto: agora };
      t.falhas += 1;
      t.visto = agora;
      if (t.falhas >= opcoes.maxFalhas) {
        t.bloqueadoAte = agora + opcoes.bloqueioMs;
        t.falhas = 0;
      }
      tentativas.set(chave, t);
    },
    limpar(chave) {
      tentativas.delete(chave);
    },
  };
}

/**
 * Teto de verificações de senha simultâneas: cada uma custa um scrypt (~16 MB).
 * Sem isso, uma enxurrada com logins sempre novos escaparia do bloqueio por
 * chave e consumiria CPU/memória à vontade. Devolve a função que libera a vaga
 * (chamar num `finally`) ou `null` se o teto foi atingido.
 */
export function reservarVaga(nome: string, max: number): (() => void) | null {
  const usadas = estado.vagas.get(nome) ?? 0;
  if (usadas >= max) return null;
  estado.vagas.set(nome, usadas + 1);
  let liberada = false;
  return () => {
    if (liberada) return;
    liberada = true;
    estado.vagas.set(nome, Math.max(0, (estado.vagas.get(nome) ?? 1) - 1));
  };
}
