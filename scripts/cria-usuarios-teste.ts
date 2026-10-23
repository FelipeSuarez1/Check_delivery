/**
 * Contas de TESTE dos tres papeis, para validar na pratica o que cada perfil
 * enxerga (scripts/teste-perfis.ts e screenshots).
 *
 *   npx tsx scripts/cria-usuarios-teste.ts <senha>   # cria/reseta as tres com a MESMA senha
 *   npx tsx scripts/cria-usuarios-teste.ts --remover # apaga as que nao tem historico; desativa as demais
 *
 * admin-teste (admin) · portaria-teste (portaria) · morador-teste (morador do apto 11A).
 * Nascem com precisaTrocarSenha=false (nao caem na tela de primeiro acesso).
 * NUNCA rode em producao: remova as contas assim que terminar o teste.
 * Saida em ASCII (o console do Windows e cp1252).
 */
import { PrismaClient } from "@prisma/client";
import { gerarHashSenha } from "../src/lib/senha";

const prisma = new PrismaClient();

const APTO_TESTE = "11A";

const CONTAS = [
  { login: "admin-teste", nome: "Admin Teste", papel: "admin" },
  { login: "portaria-teste", nome: "Portaria Teste", papel: "portaria" },
  { login: "morador-teste", nome: `Morador Teste (Apto ${APTO_TESTE})`, papel: "morador" },
] as const;

async function criar(senha: string) {
  const apto = await prisma.apartamento.findUnique({ where: { numero: APTO_TESTE } });
  if (!apto) throw new Error(`apartamento ${APTO_TESTE} nao existe - rode scripts/importa-cadastro.ts --aplicar`);

  for (const c of CONTAS) {
    const { hash, salt } = gerarHashSenha(senha);
    const apartamentoId = c.papel === "morador" ? apto.id : null;
    await prisma.usuario.upsert({
      where: { login: c.login },
      create: {
        login: c.login,
        nome: c.nome,
        papel: c.papel,
        apartamentoId,
        senhaHash: hash,
        senhaSalt: salt,
        precisaTrocarSenha: false,
      },
      update: {
        nome: c.nome,
        papel: c.papel,
        apartamentoId,
        senhaHash: hash,
        senhaSalt: salt,
        precisaTrocarSenha: false,
        ativo: true,
      },
    });
    console.log(`${c.login}: pronto (papel=${c.papel})`);
  }
  console.log("\nAs tres usam a MESMA senha informada. Remova ao terminar:");
  console.log("  npx tsx scripts/cria-usuarios-teste.ts --remover");
}

async function remover() {
  for (const c of CONTAS) {
    const u = await prisma.usuario.findUnique({ where: { login: c.login } });
    if (!u) {
      console.log(`${c.login}: nao existe`);
      continue;
    }
    // mesma regra da tela de usuarios: quem deixou rastro no livro de eventos so e
    // desativado (a trilha de auditoria precisa continuar apontando para alguem)
    const [eventos, inscricoes] = await Promise.all([
      prisma.logEvento.count({ where: { usuarioId: u.id } }),
      prisma.pushInscricao.count({ where: { usuarioId: u.id } }),
    ]);
    if (eventos === 0 && inscricoes === 0) {
      await prisma.usuario.delete({ where: { id: u.id } });
      console.log(`${c.login}: excluido`);
    } else {
      await prisma.usuario.update({ where: { id: u.id }, data: { ativo: false } });
      console.log(`${c.login}: desativado (${eventos} evento(s) no livro preservados)`);
    }
  }
}

async function main() {
  const arg = process.argv[2];
  if (arg === "--remover") return remover();
  if (!arg) throw new Error("uso: cria-usuarios-teste.ts <senha> | --remover");
  if (arg.length < 8) throw new Error("senha muito curta - minimo 8 caracteres");
  await criar(arg);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
