import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  ITENS_CHECKLIST_SUGERIDOS,
  type RegistrarChecklistInput,
  type SalvarModeloChecklistInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { UploadsService } from "../../uploads/uploads.service";
import { checarArquivoEnviado, MIMES_IMAGEM } from "../../common/arquivo-enviado";
import { filtroEscopo, type EscopoAdmin } from "../../common/escopo/escopo";
import { caminhoesSemChecklist, descricaoDoAviso } from "../../common/checklist";
import { inicioDoDiaBR } from "../../common/timezone";
import { FrotaManutencaoService } from "./frota-manutencao.service";

const MAX_BYTES_FOTO = 10 * 1024 * 1024;

type Foto = { buffer: Buffer; mimetype: string; size: number; originalname: string; fieldname: string };

/**
 * Checklist do caminhão. LEMBRADO, nunca obrigatório: o app lembra antes de
 * iniciar a viagem; o painel mostra quem rodou sem. Item reprovado marcado
 * "abre aviso" vira aviso de problema na Manutenção (mesmo caminho do botão
 * "avisar problema" do app).
 */
@Injectable()
export class ChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly frota: FrotaManutencaoService,
  ) {}

  // ------------------------------------------------------------ painel --

  listarModelos() {
    return this.prisma.modeloChecklist.findMany({
      orderBy: [{ ativo: "desc" }, { criadoEm: "desc" }],
      include: { itens: { orderBy: { ordem: "asc" } } },
    });
  }

  /** Cria o modelo sugerido (pneus, freios, luzes…) pra empresa ajustar. */
  async criarSugerido() {
    return this.prisma.modeloChecklist.create({
      data: {
        nome: "Checklist do caminhão",
        itens: { create: ITENS_CHECKLIST_SUGERIDOS.map((i, ordem) => ({ ...i, ordem })) },
      },
      include: { itens: { orderBy: { ordem: "asc" } } },
    });
  }

  async salvarModelo(id: string | null, input: SalvarModeloChecklistInput) {
    if (!id) {
      return this.prisma.modeloChecklist.create({
        data: {
          nome: input.nome,
          ativo: input.ativo,
          itens: { create: input.itens.map((i, ordem) => ({ texto: i.texto, fotoSeReprovar: i.fotoSeReprovar, abreAviso: i.abreAviso, ordem })) },
        },
        include: { itens: { orderBy: { ordem: "asc" } } },
      });
    }
    const atual = await this.prisma.modeloChecklist.findUnique({ where: { id }, include: { itens: true } });
    if (!atual) throw new NotFoundException("Checklist não encontrado.");
    const manter = new Set(input.itens.map((i) => i.id).filter(Boolean));
    await this.prisma.$transaction(async (tx) => {
      await tx.modeloChecklist.update({ where: { id }, data: { nome: input.nome, ativo: input.ativo } });
      // Item tirado do modelo: as respostas antigas guardam o texto (cópia), e
      // a ligação vira null — o histórico não muda.
      await tx.itemModeloChecklist.deleteMany({
        where: { modeloId: id, id: { notIn: [...manter] as string[] } },
      });
      for (const [ordem, i] of input.itens.entries()) {
        const dados = { texto: i.texto, fotoSeReprovar: i.fotoSeReprovar, abreAviso: i.abreAviso, ordem };
        if (i.id && atual.itens.some((x) => x.id === i.id)) {
          await tx.itemModeloChecklist.update({ where: { id: i.id }, data: dados });
        } else {
          await tx.itemModeloChecklist.create({ data: { ...dados, modeloId: id } });
        }
      }
    });
    return this.prisma.modeloChecklist.findUnique({
      where: { id },
      include: { itens: { orderBy: { ordem: "asc" } } },
    });
  }

  /** Os checklists feitos no período e os caminhões que rodaram sem. */
  async historico(q: { de: string; ate: string; veiculoId?: string }, escopo: EscopoAdmin) {
    const inicio = inicioDoDiaBR(q.de);
    const fim = new Date(inicioDoDiaBR(q.ate).getTime() + 86_400_000);
    const filtroVeiculo = escopo ? { veiculo: filtroEscopo(escopo) as Prisma.VeiculoWhereInput } : {};

    const [checklists, viagens] = await Promise.all([
      this.prisma.checklistVeiculo.findMany({
        where: {
          feitoEm: { gte: inicio, lt: fim },
          ...(q.veiculoId ? { veiculoId: q.veiculoId } : {}),
          ...filtroVeiculo,
        },
        orderBy: { feitoEm: "desc" },
        take: 500,
        include: {
          motorista: { select: { nome: true } },
          veiculo: { select: { id: true, placa: true } },
          respostas: { select: { id: true, texto: true, ok: true, observacao: true, fotoKey: true, problemaId: true } },
        },
      }),
      // "Rodou no dia": viagem com data no período (o dia civil da viagem).
      this.prisma.viagem.findMany({
        where: {
          data: { gte: new Date(`${q.de}T00:00:00Z`), lte: new Date(`${q.ate}T00:00:00Z`) },
          status: { not: "RASCUNHO_OFFLINE" },
          ...(q.veiculoId ? { veiculoId: q.veiculoId } : {}),
          ...filtroVeiculo,
        },
        select: {
          veiculoId: true,
          data: true,
          iniciadoEm: true,
          veiculo: { select: { placa: true } },
          motorista: { select: { nome: true } },
        },
      }),
    ]);

    const semChecklist = caminhoesSemChecklist(
      viagens.map((v) => ({
        veiculoId: v.veiculoId,
        placa: v.veiculo.placa,
        motorista: v.motorista.nome,
        // Data da viagem é o dia civil; meio-dia não vira o dia em fuso nenhum.
        quando: v.iniciadoEm ?? new Date(`${v.data!.toISOString().slice(0, 10)}T15:00:00Z`),
      })),
      checklists.map((c) => ({ veiculoId: c.veiculoId, feitoEm: c.feitoEm })),
    );

    return {
      checklists: checklists.map((c) => ({
        id: c.id,
        feitoEm: c.feitoEm,
        motorista: c.motorista.nome,
        veiculo: c.veiculo,
        reprovados: c.reprovados,
        respostas: c.respostas.map((r) => ({ ...r, temFoto: r.fotoKey != null, fotoKey: undefined })),
      })),
      semChecklist,
    };
  }

  /** A foto de um item reprovado, servida pela API (o bucket nunca é público). */
  async foto(respostaId: string) {
    const r = await this.prisma.respostaChecklist.findUnique({ where: { id: respostaId }, select: { fotoKey: true } });
    if (!r?.fotoKey) throw new NotFoundException("Foto não encontrada.");
    return this.uploads.getObjectBuffer(r.fotoKey);
  }

  // ----------------------------------------------------------- motorista --

  /** O modelo que o app mostra: o ativo mais recente. Null = a empresa não montou. */
  modeloAtivo() {
    return this.prisma.modeloChecklist.findFirst({
      where: { ativo: true },
      orderBy: { criadoEm: "desc" },
      select: {
        id: true,
        nome: true,
        itens: { orderBy: { ordem: "asc" }, select: { id: true, texto: true, fotoSeReprovar: true } },
      },
    });
  }

  /** Último checklist de cada caminhão do motorista hoje — o app usa pra lembrar ou não. */
  async feitosHoje(motoristaId: string, hojeYmd: string) {
    const lista = await this.prisma.checklistVeiculo.findMany({
      where: { motoristaId, feitoEm: { gte: inicioDoDiaBR(hojeYmd) } },
      select: { veiculoId: true, feitoEm: true, reprovados: true },
      orderBy: { feitoEm: "desc" },
    });
    return lista;
  }

  /**
   * Os checklists dele dos últimos 7 dias (hoje incluso), pra tela do app
   * mostrar o que já foi feito antes de oferecer um novo. Só o que ELE fez,
   * e só o que interessa a ele: placa, hora e o que deu problema.
   */
  async recentes(motoristaId: string, hojeYmd: string) {
    const inicio = inicioDoDiaBR(hojeYmd);
    inicio.setUTCDate(inicio.getUTCDate() - 6);
    const lista = await this.prisma.checklistVeiculo.findMany({
      where: { motoristaId, feitoEm: { gte: inicio } },
      select: {
        id: true,
        veiculoId: true,
        feitoEm: true,
        reprovados: true,
        veiculo: { select: { placa: true } },
        respostas: { where: { ok: false }, select: { texto: true, observacao: true } },
      },
      orderBy: { feitoEm: "desc" },
      take: 30,
    });
    return lista.map((c) => ({
      id: c.id,
      veiculoId: c.veiculoId,
      placa: c.veiculo?.placa ?? null,
      feitoEm: c.feitoEm.toISOString(),
      reprovados: c.reprovados,
      problemas: c.respostas.map((r) => (r.observacao ? `${r.texto}: ${r.observacao}` : r.texto)),
    }));
  }

  /**
   * O checklist que o app mandou. As fotos vêm no mesmo envio, cada uma no
   * campo `foto_<índice da resposta>`. Idempotente pelo clientId.
   */
  async registrar(motoristaId: string, input: RegistrarChecklistInput, fotos: Foto[]) {
    const existente = await this.prisma.checklistVeiculo.findUnique({
      where: { clientId: input.clientId },
      select: { id: true, reprovados: true },
    });
    if (existente) return existente;

    for (const f of fotos) {
      checarArquivoEnviado(f, { mimes: MIMES_IMAGEM, maxBytes: MAX_BYTES_FOTO, comoDizer: "Mande uma foto." });
    }
    // FK sumida (caminhão ou modelo apagado no painel) vira null, nunca 500:
    // 500 trava a fila do app em loop.
    const [veiculo, modelo] = await Promise.all([
      input.veiculoId ? this.prisma.veiculo.findFirst({ where: { id: input.veiculoId }, select: { id: true } }) : null,
      input.modeloId ? this.prisma.modeloChecklist.findFirst({ where: { id: input.modeloId }, select: { id: true } }) : null,
    ]);
    const itens = await this.prisma.itemModeloChecklist.findMany({
      where: { id: { in: input.respostas.map((r) => r.itemId).filter((x): x is string => !!x) } },
      select: { id: true, abreAviso: true },
    });
    const todosItens = new Set(itens.map((i) => i.id));
    const abreAviso = new Set(itens.filter((i) => i.abreAviso).map((i) => i.id));

    const fotoPorIndice = new Map<number, string>();
    for (const f of fotos) {
      const m = /^foto_(\d+)$/.exec(f.fieldname);
      if (!m) continue;
      fotoPorIndice.set(Number(m[1]), await this.uploads.putProblemaVeiculoFoto(f.buffer, f.mimetype, motoristaId));
    }

    const reprovados = input.respostas.filter((r) => !r.ok).length;
    let criado: { id: string; reprovados: number };
    try {
      criado = await this.prisma.checklistVeiculo.create({
        data: {
          clientId: input.clientId,
          motoristaId,
          veiculoId: veiculo?.id ?? null,
          modeloId: modelo?.id ?? null,
          feitoEm: input.feitoEm,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          reprovados,
          respostas: {
            create: input.respostas.map((r, i) => ({
              itemId: r.itemId && todosItens.has(r.itemId) ? r.itemId : null,
              texto: r.texto,
              ok: r.ok,
              observacao: r.observacao ?? null,
              fotoKey: fotoPorIndice.get(i) ?? r.fotoKey ?? null,
            })),
          },
        },
        select: { id: true, reprovados: true },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        const ganhou = await this.prisma.checklistVeiculo.findUnique({
          where: { clientId: input.clientId },
          select: { id: true, reprovados: true },
        });
        if (ganhou) return ganhou;
      }
      throw e;
    }

    // Item reprovado que abre aviso → aviso de problema na Manutenção.
    const respostas = await this.prisma.respostaChecklist.findMany({
      where: { checklistId: criado.id },
      select: { id: true, itemId: true, texto: true, ok: true, observacao: true, fotoKey: true },
      orderBy: { id: "asc" },
    });
    for (const [i, r] of input.respostas.entries()) {
      if (r.ok || !r.itemId || !abreAviso.has(r.itemId)) continue;
      const gravada = respostas.find((x) => x.itemId === r.itemId && !x.ok);
      if (!gravada) continue;
      const problemaId = await this.frota.abrirProblemaDoChecklist({
        clientId: `${input.clientId}:item:${i}`,
        motoristaId,
        veiculoId: veiculo?.id ?? null,
        descricao: descricaoDoAviso(r.texto, r.observacao),
        fotoKey: gravada.fotoKey,
        avisadoEm: input.feitoEm,
      });
      await this.prisma.respostaChecklist.update({ where: { id: gravada.id }, data: { problemaId } });
    }
    return criado;
  }
}
