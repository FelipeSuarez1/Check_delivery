/**
 * Importa apartamentos e moradores do site financeiro (exportação em CSV).
 *
 *   npx tsx scripts/importa-cadastro.ts            # simulação: só imprime contagens
 *   npx tsx scripts/importa-cadastro.ts --aplicar  # grava no banco
 *
 * Entradas (na raiz do projeto, UTF-8 com BOM, separador ";"):
 *   dados/apartamentos.csv  -> numero;torre;andar        (ex.: "11A";"A";"1")
 *   dados/moradores.csv     -> apartamento;nome;telefone (ex.: "101B";"DUTRA";"11976712139")
 *
 * Regras:
 *   - Apartamento: upsert por `numero` (atualiza torre/andar; nunca reativa nem desativa).
 *   - Morador: upsert por (apartamento, nome sem diferenca de caixa/espacos). Telefone so e
 *     preenchido se estiver vazio no banco — nunca sobrescreve um telefone ja cadastrado.
 *   - `avisoWhatsApp` (recusa de aviso por WhatsApp, LGPD) NUNCA e lido nem gravado aqui: morador novo nasce
 *     com o padrao do schema (aceita) e quem ja existe mantem a escolha feita no admin. Coberto por teste-dominio.
 *   - Idempotente: rodar de novo nao muda nada. Nada e apagado.
 *   - Qualquer inconsistencia nos CSVs aborta ANTES de gravar (nada fica pela metade).
 * Saida em ASCII (o console do Windows e cp1252).
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const aplicar = process.argv.includes("--aplicar");

type AptoCsv = { numero: string; torre: "A" | "B"; andar: number };
type MoradorCsv = { apartamento: string; nome: string; telefone: string | null };

/** CSV com ";" , aspas duplas, BOM e CRLF/LF. */
function lerCsv(arquivo: string): string[][] {
  if (!fs.existsSync(arquivo)) throw new Error(`arquivo nao encontrado: ${arquivo}`);
  const t = fs.readFileSync(arquivo, "utf8").replace(/^﻿/, "");
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  const fechaLinha = () => {
    linha.push(campo);
    campo = "";
    if (linha.some((x) => x.trim() !== "")) linhas.push(linha);
    linha = [];
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ";") {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      fechaLinha();
    } else campo += c;
  }
  if (campo !== "" || linha.length > 0) fechaLinha();
  return linhas;
}

function conferirCabecalho(linhas: string[][], esperado: string[], arquivo: string) {
  const cab = (linhas[0] ?? []).map((x) => x.trim().toLowerCase());
  if (esperado.some((e, i) => cab[i] !== e)) {
    throw new Error(`${arquivo}: cabecalho inesperado (esperado ${esperado.join(";")}, veio ${cab.join(";")})`);
  }
}

const limpaNome = (s: string) => s.trim().replace(/\s+/g, " ");
const chaveNome = (s: string) => limpaNome(s).toLocaleLowerCase("pt-BR");

/** So digitos; tira o DDI 55 (o link do WhatsApp o reaplica). Invalido -> null. */
function normalizaTelefone(bruto: string): { telefone: string | null; suspeito: boolean } {
  let d = bruto.replace(/\D/g, "");
  if (!d) return { telefone: null, suspeito: false };
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) return { telefone: d, suspeito: false };
  return { telefone: null, suspeito: true };
}

function carregaApartamentos(arquivo: string, erros: string[]): AptoCsv[] {
  const linhas = lerCsv(arquivo);
  conferirCabecalho(linhas, ["numero", "torre", "andar"], "apartamentos.csv");
  const vistos = new Set<string>();
  const out: AptoCsv[] = [];
  for (const [i, l] of linhas.slice(1).entries()) {
    const onde = `apartamentos.csv linha ${i + 2}`;
    const numero = (l[0] ?? "").trim().toUpperCase();
    const torre = (l[1] ?? "").trim().toUpperCase();
    const andar = Number((l[2] ?? "").trim());
    if (torre !== "A" && torre !== "B") {
      erros.push(`${onde}: torre invalida "${l[1]}"`);
      continue;
    }
    if (!Number.isInteger(andar) || andar < 1 || andar > 26) {
      erros.push(`${onde}: andar invalido "${l[2]}"`);
      continue;
    }
    // numeracao real do condominio: andar + "1" + torre (11A, 21A ... 261B)
    if (numero !== `${andar}1${torre}`) {
      erros.push(`${onde}: numero "${numero}" nao bate com andar ${andar} / torre ${torre} (esperado ${andar}1${torre})`);
      continue;
    }
    if (vistos.has(numero)) {
      erros.push(`${onde}: apartamento ${numero} repetido`);
      continue;
    }
    vistos.add(numero);
    out.push({ numero, torre, andar });
  }
  return out;
}

function carregaMoradores(arquivo: string, aptos: Set<string>, erros: string[], avisos: string[]): MoradorCsv[] {
  const linhas = lerCsv(arquivo);
  conferirCabecalho(linhas, ["apartamento", "nome", "telefone"], "moradores.csv");
  const porChave = new Map<string, MoradorCsv>();
  for (const [i, l] of linhas.slice(1).entries()) {
    const onde = `moradores.csv linha ${i + 2}`;
    const apartamento = (l[0] ?? "").trim().toUpperCase();
    const nome = limpaNome(l[1] ?? "");
    if (!aptos.has(apartamento)) {
      erros.push(`${onde}: apartamento "${apartamento}" nao existe`);
      continue;
    }
    if (!nome) {
      erros.push(`${onde}: nome vazio (apartamento ${apartamento})`);
      continue;
    }
    const tel = normalizaTelefone(l[2] ?? "");
    if (tel.suspeito) avisos.push(`${onde}: telefone "${l[2]}" fora do padrao -> importado sem telefone (${apartamento} ${nome})`);
    const chave = `${apartamento}|${chaveNome(nome)}`;
    const existente = porChave.get(chave);
    if (existente) {
      avisos.push(`${onde}: ${nome} repetido em ${apartamento} -> unificado`);
      if (!existente.telefone && tel.telefone) existente.telefone = tel.telefone;
      continue;
    }
    porChave.set(chave, { apartamento, nome, telefone: tel.telefone });
  }
  return [...porChave.values()];
}

async function main() {
  const dir = path.resolve(process.cwd(), "dados");
  const erros: string[] = [];
  const avisos: string[] = [];

  const aptos = carregaApartamentos(path.join(dir, "apartamentos.csv"), erros);
  const moradores = carregaMoradores(
    path.join(dir, "moradores.csv"),
    new Set(aptos.map((a) => a.numero)),
    erros,
    avisos
  );
  if (aptos.length !== 52) avisos.push(`esperados 52 apartamentos (26 andares x 2 torres), o CSV tem ${aptos.length}`);

  if (erros.length > 0) {
    console.log(`ERROS (${erros.length}) - nada foi gravado:`);
    for (const e of erros) console.log("  - " + e);
    process.exitCode = 1;
    return;
  }

  // ---- plano (le o banco, nao grava) ----
  const existentes = new Map((await prisma.apartamento.findMany()).map((a) => [a.numero, a]));
  const novosAptos = aptos.filter((a) => !existentes.has(a.numero));
  const aptosAtualizar = aptos.filter((a) => {
    const e = existentes.get(a.numero);
    return e && (e.torre !== a.torre || e.andar !== a.andar);
  });

  const moradoresBanco = await prisma.morador.findMany({ include: { apartamento: { select: { numero: true } } } });
  const moradorPorChave = new Map(moradoresBanco.map((m) => [`${m.apartamento.numero}|${chaveNome(m.nome)}`, m]));
  let moradoresNovos = 0;
  let telefonesAPreencher = 0;
  let moradoresSemMudanca = 0;
  for (const m of moradores) {
    const e = moradorPorChave.get(`${m.apartamento}|${chaveNome(m.nome)}`);
    if (!e) moradoresNovos++;
    else if (!e.telefone && m.telefone) telefonesAPreencher++;
    else moradoresSemMudanca++;
  }

  console.log(aplicar ? "== APLICANDO ==" : "== SIMULACAO (use --aplicar para gravar) ==");
  console.log(`apartamentos no CSV: ${aptos.length} | ja no banco: ${aptos.length - novosAptos.length} | novos: ${novosAptos.length} | torre/andar a corrigir: ${aptosAtualizar.length}`);
  console.log(`moradores no CSV: ${moradores.length} | novos: ${moradoresNovos} | telefone a preencher: ${telefonesAPreencher} | sem mudanca: ${moradoresSemMudanca}`);
  for (const a of avisos) console.log("  aviso: " + a);

  if (!aplicar) return;

  await prisma.$transaction(async (tx) => {
    for (const a of aptos) {
      await tx.apartamento.upsert({
        where: { numero: a.numero },
        create: { numero: a.numero, torre: a.torre, andar: a.andar },
        update: { torre: a.torre, andar: a.andar },
      });
    }
    const ids = new Map((await tx.apartamento.findMany({ select: { id: true, numero: true } })).map((a) => [a.numero, a.id]));
    for (const m of moradores) {
      const apartamentoId = ids.get(m.apartamento);
      if (apartamentoId === undefined) throw new Error(`apartamento ${m.apartamento} sumiu durante a gravacao`);
      const candidatos = await tx.morador.findMany({ where: { apartamentoId } });
      const existente = candidatos.find((c) => chaveNome(c.nome) === chaveNome(m.nome));
      if (!existente) {
        await tx.morador.create({ data: { apartamentoId, nome: m.nome, telefone: m.telefone } });
      } else if (!existente.telefone && m.telefone) {
        await tx.morador.update({ where: { id: existente.id }, data: { telefone: m.telefone } });
      }
    }
  });

  const [totalAptos, totalMoradores, comTelefone] = await Promise.all([
    prisma.apartamento.count(),
    prisma.morador.count(),
    prisma.morador.count({ where: { telefone: { not: null } } }),
  ]);
  console.log(`gravado. No banco agora: ${totalAptos} apartamentos, ${totalMoradores} moradores (${comTelefone} com telefone).`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
