/**
 * Telas da portaria quando NINGUEM do apartamento tem telefone e na digitacao do apto (23/10/2026).
 * Cria um apartamento descartavel "991A" com 1 morador sem telefone, registra uma encomenda pela tela e
 * confere: codigo gerado com aviso "sem telefone" + botao do WhatsApp desabilitado, a mesma explicacao no
 * detalhe, a sugestao "Quis dizer 261A?" e o aviso de apto inexistente. Apaga tudo (inclusive o arquivo da foto).
 *
 *   LOGIN_USUARIO=<portaria|admin> LOGIN_SENHA=... FOTO=<png/jpg> TESTE_BASE=http://localhost:3011 PASTA=<screenshots>
 *   npx tsx scripts/teste-portaria-sem-telefone.ts
 * Precisa de turno aberto (rode depois de scripts/teste-portaria.ts ou abra pelo cabecalho). Saida em ASCII.
 */
import { unlink } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { abrirNavegador } from "./_navegador";
const prisma = new PrismaClient();
const BASE = process.env.TESTE_BASE!;
const PASTA = process.env.PASTA!;
async function main() {
  await prisma.encomenda.deleteMany({ where: { observacao: "[TESTE-PORTARIA]", apartamento: { numero: "991A" } } });
  await prisma.apartamento.deleteMany({ where: { numero: "991A" } });
  const apto = await prisma.apartamento.create({ data: { numero: "991A", torre: "A", andar: 99 } });
  await prisma.morador.create({ data: { apartamentoId: apto.id, nome: "Teste Sem Telefone", telefone: null } });
  const browser = await abrirNavegador();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
    await page.goto(`${BASE}/login`);
    await page.fill("#login", process.env.LOGIN_USUARIO!);
    await page.fill("#senha", process.env.LOGIN_SENHA!);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
    await page.goto(`${BASE}/portaria/registrar`);
    await page.setInputFiles('input[type="file"]', process.env.FOTO!);
    await page.waitForSelector('img[alt="Foto 1 da encomenda"]');
    await page.fill("#numero-apto", "991");
    await page.locator("#campo-dest button[aria-pressed]").first().click();
    await page.fill("#observacao-encomenda", "[TESTE-PORTARIA]");
    await page.getByRole("button", { name: "Salvar e gerar código" }).click();
    await page.getByText(/Nenhum morador do 991A tem telefone cadastrado/).waitFor({ timeout: 20000 });
    const desabilitado = await page.getByRole("button", { name: "Avisar no WhatsApp" }).isDisabled();
    console.log("registrar: aviso sem telefone ok; botao desabilitado =", desabilitado);
    await page.screenshot({ path: path.join(PASTA, "30-codigo-gerado-sem-telefone.png"), fullPage: true });
    const enc = await prisma.encomenda.findFirst({ where: { apartamentoId: apto.id } });
    await page.goto(`${BASE}/portaria/encomenda/${enc!.id}`);
    await page.getByText(/Nenhum morador do 991A tem telefone cadastrado/).waitFor();
    console.log("detalhe: explicacao sem telefone ok; botao desabilitado =", await page.getByRole("button", { name: "Avisar no WhatsApp" }).isDisabled());
    await page.screenshot({ path: path.join(PASTA, "31-detalhe-sem-telefone.png"), fullPage: true });
    // registrar com apto inexistente / sugestao
    await page.goto(`${BASE}/portaria/registrar`);
    await page.fill("#numero-apto", "26");
    await page.getByRole("button", { name: /Quis dizer 261A/ }).waitFor();
    await page.screenshot({ path: path.join(PASTA, "32-registrar-sugestao-apto.png") });
    await page.getByRole("button", { name: /Quis dizer 261A/ }).click();
    console.log("sugestao 261A aplicada:", await page.inputValue("#numero-apto"));
    await page.fill("#numero-apto", "27");
    await page.getByText(/Não existe o apartamento 27A/).waitFor();
    console.log("apto inexistente 27A: aviso ok");
  } finally {
    await browser.close();
    const fotos = await prisma.fotoEncomenda.findMany({ where: { encomenda: { apartamentoId: apto.id } } });
    for (const f of fotos) await unlink(path.join(process.cwd(), "uploads", "encomendas", f.arquivo)).catch(() => {});
    await prisma.fotoEncomenda.deleteMany({ where: { encomenda: { apartamentoId: apto.id } } });
    await prisma.encomenda.deleteMany({ where: { apartamentoId: apto.id } });
    await prisma.morador.deleteMany({ where: { apartamentoId: apto.id } });
    await prisma.apartamento.delete({ where: { id: apto.id } });
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
