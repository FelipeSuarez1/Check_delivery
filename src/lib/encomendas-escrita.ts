/**
 * Escrita das encomendas (22/10/2026) — onde moram as INVARIANTES:
 *  - registrar exige turno aberto, apto ativo, 1 a 3 fotos válidas e código único;
 *  - retirar: só `aguardando`, só uma vez (update condicional), por morador do
 *    MESMO apto OU terceiro com nome (exatamente um dos dois);
 *  - cancelar: só `aguardando`; portaria só no turno em que foi registrada.
 * Sem sessão, sem log e sem revalidate: isso é das actions (`actions/encomendas.ts`),
 * que chamam estas funções depois da guarda de papel. Violação = `ErroDominio`.
 * Datas gravadas em UTC; nada se apaga.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { validarCodigo } from "@/lib/codigo";
import { formatarDataHora } from "@/lib/datas";
import { FOTOS_MAX, FOTOS_MIN, ehTipo, type TipoEncomenda } from "@/lib/encomenda-constantes";
import { gerarCodigo, prepararAviso, type AvisoPreparado } from "@/lib/encomendas";
import { ErroDominio } from "@/lib/erro-dominio";
import { ErroFoto, salvarFoto, validarFoto } from "@/lib/fotos";
import { buscarTurnoAberto } from "@/lib/turno";

const vazioParaNull = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim().replace(/\s+/g, " ");
  return t === "" ? null : t;
};

/** A encomenda foi criada, mas uma foto falhou: ela já foi cancelada (motivo "falha ao salvar foto"). */
export class ErroFotoAposCriar extends ErroDominio {
  constructor(
    mensagem: string,
    readonly encomendaId: number,
    readonly codigo: string
  ) {
    super(mensagem);
    this.name = "ErroFotoAposCriar";
  }
}

/* --------------------------------------------------------------- registrar */

export type DadosRegistro = {
  apartamentoId: number;
  /** morador do apto; tem prioridade sobre `destinatarioNome` */
  destinatarioMoradorId?: number | null;
  /** nome livre ("Outro nome…") quando não há morador */
  destinatarioNome?: string | null;
  tipo: TipoEncomenda;
  transportadora?: string | null;
  observacao?: string | null;
  local?: string | null;
  /** 1 a 3 arquivos (já reduzidos no cliente) */
  fotos: File[];
};

export type EncomendaRegistrada = {
  id: number;
  codigo: string;
  apartamentoId: number;
  apartamento: string;
  destinatarioNome: string;
  tipo: TipoEncomenda;
  transportadora: string | null;
  porteiroId: number;
  porteiroNome: string;
  totalFotos: number;
};

export async function registrarEncomendaDominio(d: DadosRegistro): Promise<EncomendaRegistrada> {
  if (!ehTipo(d.tipo)) throw new ErroDominio("Escolha o tipo da encomenda");
  if (!Array.isArray(d.fotos) || d.fotos.length < FOTOS_MIN) {
    throw new ErroDominio("Tire pelo menos 1 foto da etiqueta");
  }
  if (d.fotos.length > FOTOS_MAX) throw new ErroDominio(`No máximo ${FOTOS_MAX} fotos por encomenda`);
  // valida TODAS antes de criar qualquer coisa: foto ruim não deixa encomenda pela metade
  for (let i = 0; i < d.fotos.length; i++) {
    const v = await validarFoto(d.fotos[i]);
    if (!v.ok) throw new ErroDominio(d.fotos.length > 1 ? `Foto ${i + 1}: ${v.erro}` : v.erro);
  }

  const turno = await buscarTurnoAberto();
  if (!turno) throw new ErroDominio("Abra o turno antes de registrar");

  const apto = await prisma.apartamento.findFirst({ where: { id: d.apartamentoId, ativo: true } });
  if (!apto) throw new ErroDominio("Apartamento não encontrado ou inativo");

  let destinatarioMoradorId: number | null = null;
  let destinatarioNome: string;
  if (d.destinatarioMoradorId != null) {
    const m = await prisma.morador.findUnique({ where: { id: d.destinatarioMoradorId } });
    if (!m || !m.ativo || m.apartamentoId !== apto.id) {
      throw new ErroDominio(`Esse morador não está ativo no apartamento ${apto.numero}`);
    }
    destinatarioMoradorId = m.id;
    destinatarioNome = m.nome;
  } else {
    const nome = vazioParaNull(d.destinatarioNome);
    if (!nome || nome.length < 2) throw new ErroDominio("Informe para quem é a encomenda");
    destinatarioNome = nome;
  }

  let criada: { id: number; codigo: string } | null = null;
  for (let tentativa = 0; tentativa < 8 && !criada; tentativa++) {
    const codigo = await gerarCodigo();
    try {
      criada = await prisma.encomenda.create({
        data: {
          codigo,
          apartamentoId: apto.id,
          destinatarioMoradorId,
          destinatarioNome,
          tipo: d.tipo,
          transportadora: vazioParaNull(d.transportadora),
          observacao: vazioParaNull(d.observacao),
          local: vazioParaNull(d.local),
          status: "aguardando",
          recebidaEm: new Date(),
          recebidaPorPorteiroId: turno.porteiroId,
        },
        select: { id: true, codigo: true },
      });
    } catch (e) {
      // outra requisição pegou o mesmo código entre a consulta e o insert: sorteia de novo
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  if (!criada) throw new Error("Não foi possível gerar um código único");

  try {
    for (let i = 0; i < d.fotos.length; i++) await salvarFoto(d.fotos[i], criada.id, i + 1);
  } catch (e) {
    await prisma.encomenda
      .update({
        where: { id: criada.id },
        data: { status: "cancelada", canceladaEm: new Date(), canceladaMotivo: "falha ao salvar foto" },
      })
      .catch((e2) => console.error("registrarEncomenda: não consegui cancelar após falha de foto:", e2));
    throw new ErroFotoAposCriar(
      e instanceof ErroFoto ? e.message : "Não foi possível salvar a foto. A encomenda não foi registrada - tente de novo.",
      criada.id,
      criada.codigo
    );
  }

  return {
    id: criada.id,
    codigo: criada.codigo,
    apartamentoId: apto.id,
    apartamento: apto.numero,
    destinatarioNome,
    tipo: d.tipo,
    transportadora: vazioParaNull(d.transportadora),
    porteiroId: turno.porteiroId,
    porteiroNome: turno.porteiroNome,
    totalFotos: d.fotos.length,
  };
}

/* ----------------------------------------------------------------- retirada */

export type DadosRetirada = {
  /** código da etiqueta/QR; aceita minúsculas, espaços e hífen */
  codigo: string;
  /** morador do MESMO apto da encomenda... */
  retiradaPorMoradorId?: number | null;
  /** ...OU terceiro (nome obrigatório, documento opcional): exatamente um dos dois */
  terceiroNome?: string | null;
  terceiroDoc?: string | null;
};

export type EncomendaRetirada = {
  id: number;
  codigo: string;
  apartamento: string;
  destinatarioNome: string;
  retiradaPor: string;
  terceiro: boolean;
  entreguePorNome: string;
  /** ISO UTC */
  entregueEm: string;
};

export async function retirarEncomendaDominio(d: DadosRetirada): Promise<EncomendaRetirada> {
  const terceiroNome = vazioParaNull(d.terceiroNome);
  const temMorador = d.retiradaPorMoradorId != null;
  if (temMorador && terceiroNome) {
    throw new ErroDominio("Informe só quem retirou: um morador do apartamento OU um terceiro");
  }
  if (!temMorador && !terceiroNome) {
    throw new ErroDominio("Informe quem retirou: um morador do apartamento ou o nome do terceiro");
  }
  if (terceiroNome && terceiroNome.length < 2) throw new ErroDominio("Informe o nome de quem retirou");

  const v = validarCodigo(d.codigo);
  if (!v.ok) throw new ErroDominio(v.erro);
  const codigo = v.codigo;

  const turno = await buscarTurnoAberto();
  if (!turno) throw new ErroDominio("Abra o turno antes de confirmar a retirada");

  const enc = await prisma.encomenda.findUnique({
    where: { codigo },
    include: { apartamento: { select: { numero: true } } },
  });
  if (!enc) throw new ErroDominio(`Código ${codigo} não encontrado`);
  if (enc.status === "entregue") {
    throw new ErroDominio(
      `Código ${codigo} já foi entregue${enc.entregueEm ? ` (${formatarDataHora(enc.entregueEm)})` : ""}`
    );
  }
  if (enc.status !== "aguardando") {
    throw new ErroDominio(`Código ${codigo} foi cancelado${enc.canceladaMotivo ? ` (${enc.canceladaMotivo})` : ""}`);
  }

  let moradorId: number | null = null;
  let retiradaPor: string;
  if (temMorador) {
    const m = await prisma.morador.findUnique({ where: { id: d.retiradaPorMoradorId as number } });
    if (!m || !m.ativo || m.apartamentoId !== enc.apartamentoId) {
      throw new ErroDominio(`Esse morador não está ativo no apartamento ${enc.apartamento.numero}`);
    }
    moradorId = m.id;
    retiradaPor = m.nome;
  } else {
    retiradaPor = terceiroNome as string;
  }

  const entregueEm = new Date();
  // update condicional: duas confirmações simultâneas do mesmo código nunca entregam duas vezes
  const r = await prisma.encomenda.updateMany({
    where: { id: enc.id, status: "aguardando" },
    data: {
      status: "entregue",
      entregueEm,
      entreguePorPorteiroId: turno.porteiroId,
      retiradaPorMoradorId: moradorId,
      retiradaTerceiroNome: terceiroNome,
      retiradaTerceiroDoc: terceiroNome ? vazioParaNull(d.terceiroDoc) : null,
    },
  });
  if (r.count !== 1) {
    throw new ErroDominio(`A encomenda ${codigo} não está mais aguardando (acabou de ser entregue ou cancelada)`);
  }

  return {
    id: enc.id,
    codigo,
    apartamento: enc.apartamento.numero,
    destinatarioNome: enc.destinatarioNome,
    retiradaPor,
    terceiro: !!terceiroNome,
    entreguePorNome: turno.porteiroNome,
    entregueEm: entregueEm.toISOString(),
  };
}

/* --------------------------------------------------------------- cancelamento */

export type DadosCancelamento = {
  id: number;
  motivo: string;
  /** admin cancela sempre; portaria só no turno aberto em que a encomenda foi registrada */
  admin: boolean;
};

export async function cancelarEncomendaDominio(
  d: DadosCancelamento
): Promise<{ id: number; codigo: string; apartamento: string; motivo: string }> {
  const motivo = vazioParaNull(d.motivo);
  if (!motivo || motivo.length < 3) throw new ErroDominio("Informe o motivo do cancelamento");

  const enc = await prisma.encomenda.findUnique({
    where: { id: d.id },
    include: { apartamento: { select: { numero: true } } },
  });
  if (!enc) throw new ErroDominio("Encomenda não encontrada");
  if (enc.status === "entregue") {
    throw new ErroDominio(`A encomenda ${enc.codigo} já foi entregue - não dá para cancelar`);
  }
  if (enc.status !== "aguardando") throw new ErroDominio(`A encomenda ${enc.codigo} já está cancelada`);

  if (!d.admin) {
    const turno = await buscarTurnoAberto();
    if (!turno) throw new ErroDominio("Abra o turno antes de cancelar");
    if (enc.recebidaEm < new Date(turno.inicioISO)) {
      throw new ErroDominio(
        `A encomenda ${enc.codigo} foi registrada em outro turno - só o administrador pode cancelar`
      );
    }
  }

  const r = await prisma.encomenda.updateMany({
    where: { id: enc.id, status: "aguardando" },
    data: { status: "cancelada", canceladaEm: new Date(), canceladaMotivo: motivo },
  });
  if (r.count !== 1) {
    throw new ErroDominio(`A encomenda ${enc.codigo} não está mais aguardando (acabou de ser entregue ou cancelada)`);
  }
  return { id: enc.id, codigo: enc.codigo, apartamento: enc.apartamento.numero, motivo };
}

/* ------------------------------------------------------------------- aviso */

/**
 * Prepara o link do WhatsApp e, havendo link, grava `avisoWhatsAppEm`. A decisão é tomada AGORA, contra o
 * banco (`prepararAviso`): quem recusou o WhatsApp depois de a tela abrir continua sem link nem marca.
 */
export async function marcarAvisoWhatsAppDominio(id: number): Promise<AvisoPreparado> {
  const enc = await prisma.encomenda.findUnique({ where: { id }, select: { id: true, codigo: true, status: true } });
  if (!enc) throw new ErroDominio("Encomenda não encontrada");
  if (enc.status !== "aguardando") {
    throw new ErroDominio(`A encomenda ${enc.codigo} não está mais aguardando - não há o que avisar`);
  }
  const aviso = await prepararAviso(id);
  if (aviso.ok) {
    await prisma.encomenda.update({ where: { id }, data: { avisoWhatsAppEm: new Date() } });
  }
  return aviso;
}
