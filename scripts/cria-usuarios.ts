/**
 * Cria os logins do app (idempotente) e gera uma senha INICIAL aleatoria e
 * propria para cada um (nunca uma senha unica para todos).
 *
 *   npx tsx scripts/cria-usuarios.ts                       # cria so os que faltam
 *   npx tsx scripts/cria-usuarios.ts --resetar             # reemite a senha dos que AINDA nao trocaram a propria
 *   npx tsx scripts/cria-usuarios.ts --resetar=ap11a,portaria   # reemite estes logins (em qualquer estado)
 *   npx tsx scripts/cria-usuarios.ts --resetar --todos     # reemite TODOS (derruba quem ja escolheu senha!)
 *
 * Contas: felipe e achilles (admin), portaria (portaria) e um login por apartamento
 * "ap<numero em minusculas>" (ap11a ... ap261b; nome "Apto 11A"; papel morador).
 * Todas nascem com precisaTrocarSenha=true: o app obriga a escolher a propria senha
 * no primeiro acesso. Rode scripts/importa-cadastro.ts antes (precisa dos apartamentos).
 *
 * As senhas geradas vao SO para dados/senhas-iniciais-AAAA-MM-DD.txt (texto puro,
 * pasta ignorada pelo git) — o console mostra apenas o resumo. Entregue as senhas
 * e APAGUE o arquivo (a pasta do projeto fica no OneDrive).
 * Saida em ASCII (o console do Windows e cp1252).
 */
import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { gerarHashSenha } from "../src/lib/senha";

const prisma = new PrismaClient();

// 31 simbolos sem ambiguos (sem i l o 0 1); 10 posicoes ~ 49 bits, sorteio uniforme
const ALFABETO = "abcdefghjkmnpqrstuvwxyz23456789";
function senhaLegivel(tamanho = 10): string {
  let s = "";
  for (let i = 0; i < tamanho; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return s;
}

type Conta = { login: string; nome: string; papel: "admin" | "portaria" | "morador"; apartamentoId: number | null; ativo: boolean };

type Emitida = { login: string; nome: string; senha: string };

function dataLocal(): string {
  return new Date().toLocaleDateString("sv-SE"); // AAAA-MM-DD no fuso da maquina
}

/** Mescla as senhas novas no arquivo do dia (preserva as ainda validas de rodadas anteriores). */
function gravaArquivoSenhas(emitidas: Emitida[]): string {
  const dir = path.resolve(process.cwd(), "dados");
  fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, `senhas-iniciais-${dataLocal()}.txt`);

  const entradas = new Map<string, Emitida>();
  if (fs.existsSync(arquivo)) {
    for (const linha of fs.readFileSync(arquivo, "utf8").split(/\r?\n/)) {
      if (!linha.trim() || linha.startsWith("#")) continue;
      const [login, senha, ...nome] = linha.trim().split(/\s+/);
      if (login && senha) entradas.set(login, { login, senha, nome: nome.join(" ") });
    }
  }
  for (const e of emitidas) entradas.set(e.login, e);

  const corpo = [...entradas.values()]
    .map((e) => `${e.login.padEnd(12)}${e.senha.padEnd(14)}${e.nome}`)
    .join("\n");
  const texto =
    "# SENHAS INICIAIS - texto puro. Entregue e APAGUE este arquivo.\n" +
    "# Cada senha serve so para o primeiro acesso: o app obriga a trocar.\n" +
    "# login       senha         nome\n" +
    corpo +
    "\n";
  fs.writeFileSync(arquivo, texto, { encoding: "utf8", mode: 0o600 });
  return arquivo;
}

async function main() {
  const args = process.argv.slice(2);
  const argResetar = args.find((a) => a === "--resetar" || a.startsWith("--resetar="));
  const resetarTodos = args.includes("--todos");
  const resetarLogins = argResetar?.startsWith("--resetar=")
    ? new Set(
        argResetar
          .slice("--resetar=".length)
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      )
    : null;

  const apartamentos = await prisma.apartamento.findMany({ orderBy: [{ andar: "asc" }, { torre: "asc" }] });
  if (apartamentos.length === 0) {
    console.log("AVISO: nenhum apartamento no banco - rode antes: npx tsx scripts/importa-cadastro.ts --aplicar");
  }

  const contas: Conta[] = [
    { login: "felipe", nome: "Felipe", papel: "admin", apartamentoId: null, ativo: true },
    { login: "achilles", nome: "Achilles", papel: "admin", apartamentoId: null, ativo: true },
    { login: "portaria", nome: "Portaria", papel: "portaria", apartamentoId: null, ativo: true },
    ...apartamentos.map((a) => ({
      login: `ap${a.numero.toLowerCase()}`,
      nome: `Apto ${a.numero}`,
      papel: "morador" as const,
      apartamentoId: a.id,
      ativo: a.ativo,
    })),
  ];

  if (resetarLogins) {
    const conhecidos = new Set(contas.map((c) => c.login));
    const desconhecidos = [...resetarLogins].filter((l) => !conhecidos.has(l));
    if (desconhecidos.length > 0) {
      console.error(`login(s) fora do conjunto deste script: ${desconhecidos.join(", ")}`);
      process.exitCode = 1;
      return;
    }
  }

  const existentes = new Map((await prisma.usuario.findMany()).map((u) => [u.login, u]));
  const emitidas: Emitida[] = [];
  let criados = 0;
  let reemitidos = 0;
  let mantidos = 0;
  let poupados = 0; // existentes que o --resetar escolhido nao alcanca

  let arquivo: string | null = null;
  try {
    for (const c of contas) {
      const ex = existentes.get(c.login);
      if (!ex) {
        const senha = senhaLegivel();
        const { hash, salt } = gerarHashSenha(senha);
        await prisma.usuario.create({
          data: {
            login: c.login,
            nome: c.nome,
            papel: c.papel,
            apartamentoId: c.apartamentoId,
            ativo: c.ativo,
            senhaHash: hash,
            senhaSalt: salt,
            precisaTrocarSenha: true,
          },
        });
        emitidas.push({ login: c.login, nome: c.nome, senha });
        criados++;
        continue;
      }
      if (!argResetar) {
        mantidos++;
        continue;
      }
      const alvo = resetarLogins
        ? resetarLogins.has(c.login)
        : resetarTodos || ex.precisaTrocarSenha; // sem lista: so quem nunca trocou
      if (!alvo) {
        poupados++;
        continue;
      }
      const senha = senhaLegivel();
      const { hash, salt } = gerarHashSenha(senha);
      // `ativo` fica como esta: quem foi desativado de proposito nao volta por reset
      await prisma.usuario.update({
        where: { id: ex.id },
        data: {
          nome: c.nome,
          papel: c.papel,
          apartamentoId: c.apartamentoId,
          senhaHash: hash,
          senhaSalt: salt,
          precisaTrocarSenha: true,
        },
      });
      emitidas.push({ login: c.login, nome: c.nome, senha });
      reemitidos++;
    }
  } finally {
    // mesmo que algo falhe no meio, as senhas ja gravadas no banco nao se perdem
    if (emitidas.length > 0) arquivo = gravaArquivoSenhas(emitidas);
  }

  const totais = await prisma.usuario.groupBy({ by: ["papel"], _count: { _all: true } });
  const porPapel = Object.fromEntries(totais.map((t) => [t.papel, t._count._all]));
  console.log(
    `contas: ${criados} criada(s), ${reemitidos} com senha reemitida, ${mantidos} ja existiam (senha mantida)` +
      (poupados ? `, ${poupados} fora do escopo do --resetar (senha mantida)` : "")
  );
  console.log(
    `no banco agora: admin=${porPapel.admin ?? 0} portaria=${porPapel.portaria ?? 0} morador=${porPapel.morador ?? 0}`
  );
  if (arquivo) {
    console.log(`${emitidas.length} senha(s) inicial(is) gravada(s) em: ${path.relative(process.cwd(), arquivo)}`);
    console.log("Entregue as senhas e APAGUE o arquivo (esta pasta e sincronizada pelo OneDrive).");
  } else {
    console.log("Nenhuma senha nova foi gerada.");
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
