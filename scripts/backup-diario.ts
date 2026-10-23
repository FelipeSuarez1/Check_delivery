/**
 * Backup consistente do banco (VACUUM INTO) - nao precisa parar o app.
 *
 *   npx tsx scripts/backup-diario.ts              -> backups/encomendas-AAAA-MM-DD.db (raiz do projeto)
 *   npx tsx scripts/backup-diario.ts <destino>    -> <destino> pasta (vira <destino>/encomendas-AAAA-MM-DD.db)
 *                                                    ou arquivo terminado em .db
 *
 * Passos: VACUUM INTO para um arquivo .tmp -> confere a copia (PRAGMA integrity_check +
 * contagem das tabelas principais, abrindo a COPIA como outro banco) -> so entao troca o
 * .tmp pelo nome final (rodar duas vezes no mesmo dia substitui o do dia) -> apaga as copias
 * "encomendas-AAAA-MM-DD.db" da MESMA pasta com mais de 30 dias (data no nome do arquivo;
 * nada alem desse padrao e tocado). Copia que falha na conferencia nunca apaga backup antigo.
 *
 * NAO copia uploads/ (fotos das encomendas): elas expiram em 90 dias por design; se quiser
 * espelha-las, veja docs/operacao.md (robocopy). Saida em ASCII (console do Windows e cp1252).
 * Exit code 1 em qualquer falha - o Agendador de Tarefas registra o resultado.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { diaLocalISO, DIA_MS } from "../src/lib/datas";

const RETENCAO_DIAS = 30;
const PADRAO = /^encomendas-(\d{4}-\d{2}-\d{2})\.db$/;

const prisma = new PrismaClient();

/** Caminho que o SQLite entende (barras normais, aspas simples dobradas). */
const paraSql = (p: string) => p.replace(/\\/g, "/").replace(/'/g, "''");

type Destino = { arquivo: string; pasta: string; podeLimpar: boolean };

function resolverDestino(arg: string | undefined, hoje: string): Destino {
  const nome = `encomendas-${hoje}.db`;
  if (!arg) {
    const pasta = path.resolve(process.cwd(), "backups");
    return { arquivo: path.join(pasta, nome), pasta, podeLimpar: true };
  }
  const alvo = path.resolve(arg);
  const ehPasta = /[\\/]$/.test(arg) || (fs.existsSync(alvo) && fs.statSync(alvo).isDirectory()) || !/\.db$/i.test(alvo);
  if (ehPasta) return { arquivo: path.join(alvo, nome), pasta: alvo, podeLimpar: true };
  // arquivo explicito: nome livre, entao nao ha rotina de limpeza
  return { arquivo: alvo, pasta: path.dirname(alvo), podeLimpar: false };
}

async function bancoPrincipal(): Promise<string> {
  const linhas = await prisma.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const principal = linhas.find((l) => l.name === "main");
  if (!principal?.file) throw new Error("nao foi possivel descobrir o arquivo do banco (PRAGMA database_list)");
  return principal.file;
}

/** Abre a COPIA como banco independente e confere integridade e contagens. */
async function conferirCopia(arquivo: string): Promise<{ usuarios: number; encomendas: number; eventos: number }> {
  const copia = new PrismaClient({ datasources: { db: { url: "file:" + arquivo.replace(/\\/g, "/") } } });
  try {
    const integ = await copia.$queryRawUnsafe<{ integrity_check: string }[]>("PRAGMA integrity_check");
    if (integ.length !== 1 || integ[0].integrity_check !== "ok") {
      throw new Error("integrity_check da copia falhou: " + JSON.stringify(integ).slice(0, 300));
    }
    const [usuarios, encomendas, eventos] = await Promise.all([
      copia.usuario.count(),
      copia.encomenda.count(),
      copia.logEvento.count(),
    ]);
    return { usuarios, encomendas, eventos };
  } finally {
    await copia.$disconnect();
  }
}

/** Apaga copias do padrao com data anterior a (hoje - 29 dias): mantem 30 dias contando hoje. */
function limparAntigas(pasta: string, hoje: string): string[] {
  const [a, m, d] = hoje.split("-").map(Number);
  const limite = Date.UTC(a, m - 1, d) - (RETENCAO_DIAS - 1) * DIA_MS;
  const removidas: string[] = [];
  for (const nome of fs.readdirSync(pasta)) {
    const achou = PADRAO.exec(nome);
    if (!achou) continue;
    const [aa, mm, dd] = achou[1].split("-").map(Number);
    if (Date.UTC(aa, mm - 1, dd) < limite) {
      fs.unlinkSync(path.join(pasta, nome));
      removidas.push(nome);
    }
  }
  return removidas;
}

async function main() {
  const hoje = diaLocalISO(new Date());
  const destino = resolverDestino(process.argv[2], hoje);
  fs.mkdirSync(destino.pasta, { recursive: true });

  const origem = await bancoPrincipal();
  const temporario = destino.arquivo + ".tmp";
  if (path.resolve(temporario) === path.resolve(origem) || path.resolve(destino.arquivo) === path.resolve(origem)) {
    throw new Error("o destino nao pode ser o proprio banco");
  }
  fs.rmSync(temporario, { force: true });

  try {
    await prisma.$executeRawUnsafe(`VACUUM INTO '${paraSql(temporario)}'`);
    const contagens = await conferirCopia(temporario);
    fs.renameSync(temporario, destino.arquivo); // troca atomica no mesmo volume; substitui o do dia
    const mb = fs.statSync(destino.arquivo).size / 1024 / 1024;
    console.log(`Backup OK: ${destino.arquivo} (${mb.toFixed(2)} MB)`);
    console.log("Integridade: ok");
    console.log(`Registros na copia: usuarios=${contagens.usuarios} encomendas=${contagens.encomendas} eventos=${contagens.eventos}`);
    if (destino.podeLimpar) {
      const removidas = limparAntigas(destino.pasta, hoje);
      console.log(`Copias com mais de ${RETENCAO_DIAS} dias removidas: ${removidas.length}${removidas.length ? " (" + removidas.join(", ") + ")" : ""}`);
    }
  } finally {
    fs.rmSync(temporario, { force: true }); // sem .tmp orfao em caso de falha
  }
}

main()
  .catch((e) => {
    console.error("BACKUP FALHOU:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
