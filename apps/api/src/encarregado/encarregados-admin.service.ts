import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AcaoAuditoria, Prisma } from "@prisma/client";
import {
  achatarParam,
  NOME_PLATAFORMA,
  type AtualizarEncarregadoInput,
  type ConvidarEncarregadoInput,
} from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { EnvioWhatsappService } from "../whatsapp/envio/envio-whatsapp.service";
import { SessaoService } from "../whatsapp/sessao.service";
import { normalizarTelefoneEncarregado } from "./encarregado-regras";

const SELECT_PAINEL = {
  id: true,
  nome: true,
  telefone: true,
  ativo: true,
  podeVerValores: true,
  podePedirCaminhao: true,
  conviteEnviadoEm: true,
  ultimoAcessoEm: true,
  criadoEm: true,
  convidadoPor: { select: { nome: true } },
} satisfies Prisma.EncarregadoObraSelect;

/**
 * O lado do escritório: quem da obra entra no portal. Fica na ficha da obra.
 */
@Injectable()
export class EncarregadosAdminService {
  private readonly log = new Logger("EncarregadosAdmin");

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditoria: AuditoriaService,
    private readonly envio: EnvioWhatsappService,
  ) {}

  /** O endereço do portal. Runtime (não build), igual ao link do comprovante. */
  get linkPortal(): string {
    const base = (this.config.get<string>("PUBLIC_APP_URL") ?? "http://localhost:3001").replace(/\/+$/, "");
    return `${base}/obra`;
  }

  async listar(clienteId: string) {
    await this.obra(clienteId);
    const itens = await this.prisma.encarregadoObra.findMany({
      where: { clienteId },
      select: SELECT_PAINEL,
      orderBy: [{ ativo: "desc" }, { nome: "asc" }],
    });
    return { link: this.linkPortal, itens };
  }

  async convidar(clienteId: string, input: ConvidarEncarregadoInput, usuarioId: string) {
    const obra = await this.obra(clienteId);
    const telefone = normalizarTelefoneEncarregado(input.telefone);
    if (!telefone) {
      throw new BadRequestException("Informe um celular com DDD — é por ele que chega o código de entrada.");
    }

    const existente = await this.prisma.encarregadoObra.findUnique({
      where: { clienteId_telefone: { clienteId, telefone } },
      select: { id: true, ativo: true },
    });
    if (existente?.ativo) {
      throw new ConflictException("Esse celular já é encarregado desta obra.");
    }

    // Quem foi desativado e volta é a MESMA linha: o histórico de pedidos e
    // aprovações dele continua apontando pra ela.
    const enc = existente
      ? await this.prisma.encarregadoObra.update({
          where: { id: existente.id },
          data: {
            nome: input.nome,
            ativo: true,
            podeVerValores: input.podeVerValores,
            podePedirCaminhao: input.podePedirCaminhao,
            convidadoPorId: usuarioId,
          },
          select: SELECT_PAINEL,
        })
      : await this.prisma.encarregadoObra.create({
          data: {
            clienteId,
            nome: input.nome,
            telefone,
            podeVerValores: input.podeVerValores,
            podePedirCaminhao: input.podePedirCaminhao,
            convidadoPorId: usuarioId,
          },
          select: SELECT_PAINEL,
        });

    await this.auditoria.log({
      usuarioId,
      entidade: "EncarregadoObra",
      entidadeId: enc.id,
      acao: AcaoAuditoria.UPDATE,
      motivo: existente ? "Encarregado da obra reativado." : "Encarregado da obra convidado.",
      metadata: { clienteId, obra: obra.nome, podeVerValores: enc.podeVerValores },
    });

    const conviteEnviado = await this.enviarConvite(enc.id, obra.nome);
    return { encarregado: await this.um(clienteId, enc.id), conviteEnviado, link: this.linkPortal };
  }

  async reenviarConvite(clienteId: string, id: string) {
    const obra = await this.obra(clienteId);
    const enc = await this.prisma.encarregadoObra.findFirst({ where: { id, clienteId }, select: { ativo: true } });
    if (!enc) throw new NotFoundException("Encarregado não encontrado");
    if (!enc.ativo) throw new BadRequestException("Reative o encarregado antes de mandar o convite.");
    const conviteEnviado = await this.enviarConvite(id, obra.nome);
    return { encarregado: await this.um(clienteId, id), conviteEnviado, link: this.linkPortal };
  }

  async atualizar(clienteId: string, id: string, input: AtualizarEncarregadoInput, usuarioId: string) {
    await this.obra(clienteId);
    const antes = await this.prisma.encarregadoObra.findFirst({
      where: { id, clienteId },
      select: { nome: true, ativo: true, podeVerValores: true, podePedirCaminhao: true },
    });
    if (!antes) throw new NotFoundException("Encarregado não encontrado");

    await this.prisma.encarregadoObra.update({ where: { id }, data: input });
    // Desativar derruba as sessões NA HORA: o guard já recusaria (ativo=false),
    // mas revogar deixa o rastro de quando o acesso caiu.
    if (input.ativo === false && antes.ativo) await this.revogarSessoes(id);

    await this.auditoria.logDiff(
      { usuarioId, entidade: "EncarregadoObra", entidadeId: id, acao: AcaoAuditoria.UPDATE },
      antes,
      { ...antes, ...input },
    );
    return this.um(clienteId, id);
  }

  /** "Desconectar aparelhos": o celular perdido não continua vendo a obra. */
  async encerrarSessoes(clienteId: string, id: string, usuarioId: string) {
    await this.obra(clienteId);
    const enc = await this.prisma.encarregadoObra.findFirst({ where: { id, clienteId }, select: { id: true } });
    if (!enc) throw new NotFoundException("Encarregado não encontrado");
    const n = await this.revogarSessoes(id);
    await this.auditoria.log({
      usuarioId,
      entidade: "EncarregadoObra",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      motivo: "Sessões do portal da obra encerradas pelo escritório.",
      metadata: { sessoes: n },
    });
    return { encerradas: n };
  }

  // ------------------------------------------------------------------------

  private async revogarSessoes(encarregadoId: string): Promise<number> {
    const r = await this.prisma.sessaoEncarregado.updateMany({
      where: { encarregadoId, revogadaEm: null },
      data: { revogadaEm: new Date() },
    });
    return r.count;
  }

  /**
   * O convite no WhatsApp. `tentarEnviar` e não `enviarOuFalhar`: o cadastro já
   * valeu, e o escritório vê na hora que não saiu e pode mandar o link por
   * outro caminho. Só carimba `conviteEnviadoEm` quando saiu de verdade.
   */
  private async enviarConvite(id: string, obraNome: string): Promise<boolean> {
    const enc = await this.prisma.encarregadoObra.findUnique({
      where: { id },
      select: { nome: true, telefone: true, contaId: true },
    });
    if (!enc) return false;
    const conta = await this.prisma.conta.findUnique({ where: { id: enc.contaId }, select: { nome: true } });
    const empresa = conta?.nome ?? "transportadora";
    const primeiroNome = enc.nome.split(/\s+/)[0] ?? enc.nome;

    const r = await this.envio.tentarEnviar({
      destino: { tipo: "TELEFONE", numero: SessaoService.normalizar(enc.telefone) },
      rota: "CONVITE_ENCARREGADO",
      texto: [
        `Olá, ${primeiroNome}! A ${empresa} liberou pra você o acompanhamento da obra ${obraNome} pelo celular: entregas do dia, programação e pedido de caminhão.`,
        "",
        `Pra entrar: ${this.linkPortal}`,
        "Use este número de WhatsApp. O código de acesso chega aqui.",
        "",
        NOME_PLATAFORMA,
      ].join("\n"),
      params: [achatarParam(primeiroNome), achatarParam(obraNome), achatarParam(empresa), "obra"],
    });
    if (!r.enviado) {
      this.log.warn(`convite do portal da obra não saiu (encarregado ${id}): ${r.erro?.detalhe ?? "?"}`);
      return false;
    }
    await this.prisma.encarregadoObra.update({ where: { id }, data: { conviteEnviadoEm: new Date() } });
    return true;
  }

  private async um(clienteId: string, id: string) {
    const e = await this.prisma.encarregadoObra.findFirst({ where: { id, clienteId }, select: SELECT_PAINEL });
    if (!e) throw new NotFoundException("Encarregado não encontrado");
    return e;
  }

  /** A trava garante que é obra DESTA empresa; 404 se não for. */
  private async obra(clienteId: string) {
    const c = await this.prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true, nome: true } });
    if (!c) throw new NotFoundException("Obra não encontrada");
    return c;
  }
}
