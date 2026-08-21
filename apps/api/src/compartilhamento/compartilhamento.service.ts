import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AcaoAuditoria } from "@prisma/client";
import { achatarParam } from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { UploadsService } from "../uploads/uploads.service";
import { EnvioWhatsappService } from "../whatsapp/envio/envio-whatsapp.service";
import { SessaoService } from "../whatsapp/sessao.service";
import type { EscopoAdmin } from "../common/escopo/escopo";
import { filtroEscopo } from "../common/escopo/escopo";
import {
  SELECT_VIAGEM_PUBLICA,
  serializarViagemPublica,
  type ViagemPublica,
} from "./viagem-publica";
import { comConta, comoSistema, contaIdAtual } from "../common/conta/conta-context";

/** Validades oferecidas no painel. 30 dias cobre conferência + fechamento do mês. */
export const DIAS_VALIDADE = [7, 30, 90] as const;
export type DiasValidade = (typeof DIAS_VALIDADE)[number];

/** 24 bytes = 192 bits de entropia, 32 chars URL-safe. */
const TOKEN_BYTES = 24;

@Injectable()
export class CompartilhamentoService implements OnModuleInit {
  private readonly log = new Logger("Compartilhamento");

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditoria: AuditoriaService,
    private readonly uploads: UploadsService,
    private readonly envio: EnvioWhatsappService,
  ) {}

  onModuleInit() {
    // Falha silenciosa cara: sem a env, o link vai pro WhatsApp do cliente
    // apontando pra localhost e ninguém descobre até alguém reclamar.
    if (!this.config.get<string>("PUBLIC_APP_URL")) {
      this.log.warn(
        `PUBLIC_APP_URL não configurada — links de compartilhamento vão sair como ${this.baseUrl}/v/…`,
      );
    }
  }

  // ---------------------------------------------------------------- admin ---

  async listar(viagemId: string, escopo: EscopoAdmin) {
    await this.ensureViagemNoEscopo(viagemId, escopo);
    const links = await this.prisma.viagemCompartilhamento.findMany({
      where: { viagemId },
      orderBy: { criadoEm: "desc" },
      include: { criadoPor: { select: { nome: true } } },
    });
    return links.map((l) => this.paraPainel(l));
  }

  async gerar(
    viagemId: string,
    diasValidade: DiasValidade,
    usuarioId: string,
    escopo: EscopoAdmin,
  ) {
    await this.ensureViagemNoEscopo(viagemId, escopo);

    const expiraEm = new Date(Date.now() + diasValidade * 24 * 60 * 60 * 1000);
    const link = await this.prisma.viagemCompartilhamento.create({
      data: { viagemId, token: gerarToken(), expiraEm, criadoPorId: usuarioId },
      include: { criadoPor: { select: { nome: true } } },
    });

    await this.auditoria.log({
      usuarioId,
      entidade: "Viagem",
      entidadeId: viagemId,
      acao: AcaoAuditoria.COMPARTILHAR_VIAGEM,
      // Sem o token de propósito: AuditLog é legível por quem tem viagens.ver,
      // e viraria uma lista de links vivos pra quem não pode nem criá-los.
      metadata: { compartilhamentoId: link.id, diasValidade, expiraEm: expiraEm.toISOString() },
    });

    return this.paraPainel(link);
  }

  async revogar(viagemId: string, id: string, usuarioId: string, escopo: EscopoAdmin) {
    await this.ensureViagemNoEscopo(viagemId, escopo);
    const link = await this.prisma.viagemCompartilhamento.findFirst({
      where: { id, viagemId },
      select: { id: true, revogadoEm: true },
    });
    if (!link) throw new NotFoundException("Link não encontrado");
    // Idempotente: revogar de novo não é erro nem gera auditoria duplicada.
    if (link.revogadoEm) return;

    await this.prisma.viagemCompartilhamento.update({
      where: { id },
      data: { revogadoEm: new Date(), revogadoPorId: usuarioId },
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "Viagem",
      entidadeId: viagemId,
      acao: AcaoAuditoria.REVOGAR_COMPARTILHAMENTO,
      metadata: { compartilhamentoId: id },
    });
  }

  async enviarWhatsapp(
    viagemId: string,
    id: string,
    input: { telefone: string; mensagemExtra?: string },
    usuarioId: string,
    escopo: EscopoAdmin,
  ) {
    await this.ensureViagemNoEscopo(viagemId, escopo);
    const disp = await this.envio.disponivel("COMPARTILHAMENTO");
    if (!disp.ok) {
      throw new BadRequestException(disp.motivo);
    }

    const link = await this.prisma.viagemCompartilhamento.findFirst({
      where: { id, viagemId },
      include: { criadoPor: { select: { nome: true } } },
    });
    if (!link) throw new NotFoundException("Link não encontrado");
    if (link.revogadoEm) throw new BadRequestException("Este link foi revogado. Gere um novo.");
    if (link.expiraEm < new Date()) {
      throw new BadRequestException("Este link já expirou. Gere um novo.");
    }

    const numero = SessaoService.normalizar(input.telefone);
    if (numero.length < 12) {
      throw new BadRequestException("Número de WhatsApp inválido. Informe com DDD.");
    }

    const mensagem = await this.montarMensagem(viagemId, link.token, link.expiraEm, input.mensagemExtra);
    // Só marca como enviado DEPOIS do envio dar certo — `enviarOuFalhar` joga
    // 503 se o provedor não devolver a prova de aceite, e um "enviado"
    // mentiroso é pior que erro.
    await this.envio.enviarOuFalhar({
      destino: { tipo: "TELEFONE", numero },
      rota: "COMPARTILHAMENTO",
      texto: mensagem.texto,
      params: mensagem.params,
    });

    const atualizado = await this.prisma.viagemCompartilhamento.update({
      where: { id },
      data: { destinatarioTelefone: numero, enviadoEm: new Date() },
      include: { criadoPor: { select: { nome: true } } },
    });

    await this.auditoria.log({
      usuarioId,
      entidade: "Viagem",
      entidadeId: viagemId,
      acao: AcaoAuditoria.ENVIAR_COMPARTILHAMENTO,
      metadata: { compartilhamentoId: id, telefone: mascararTelefone(numero) },
    });

    return this.paraPainel(atualizado);
  }

  // -------------------------------------------------------------- público ---

  /**
   * Resolve o token e devolve o comprovante. Erros com `code` distinto de
   * propósito: "expirou, peça um novo" é acionável, "link inválido" não. Isso
   * vaza um bit sobre a existência do token, mas com 192 bits de entropia
   * enumerar é inviável e a UX do cliente vale mais.
   */
  async viagemPorToken(token: string, ip: string): Promise<ViagemPublica> {
    const link = await this.buscarLinkValido(token);
    // Daqui pra baixo tudo corre dentro da empresa dona do link — inclusive os
    // mínimos e a rota, que são dados dela.
    return comConta(link.contaId, () => this.montarComprovante(link, ip));
  }

  private async montarComprovante(
    link: { id: string; contaId: string; viagemId: string; expiraEm: Date; primeiroAcessoEm: Date | null },
    ip: string,
  ): Promise<ViagemPublica> {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: link.viagemId },
      select: SELECT_VIAGEM_PUBLICA,
    });
    if (!viagem) throw new NotFoundException({ code: "LINK_INVALIDO", message: "Link não encontrado" });

    // Rota do par de locais: só é consultada quando a viagem não tem geometria
    // própria (o motorista não escolheu rota). EM_ANDAMENTO não tem destino.
    const rotaDoPar =
      viagem.rotaGeometria == null && viagem.localCargaId && viagem.localDescargaId
        ? await this.prisma.rotaCache.findUnique({
            where: {
              localOrigemId_localDestinoId: {
                localOrigemId: viagem.localCargaId,
                localDestinoId: viagem.localDescargaId,
              },
            },
            select: { geometria: true },
          })
        : null;

    const regras = await this.prisma.regraMinimo.findMany({ where: { ativo: true } });
    const agora = new Date();

    // Fire-and-forget: contar visualização não pode atrasar (nem derrubar) a
    // resposta. updateMany + increment pra não estourar em corrida.
    void this.prisma.viagemCompartilhamento
      .updateMany({
        where: { id: link.id },
        data: {
          visualizacoes: { increment: 1 },
          ultimoAcessoEm: agora,
          ultimoAcessoIp: ip,
          ...(link.primeiroAcessoEm ? {} : { primeiroAcessoEm: agora }),
        },
      })
      .catch((e: unknown) => this.log.warn(`Falha ao contar visualização: ${(e as Error).message}`));

    return serializarViagemPublica(viagem, {
      regras,
      expiraEm: link.expiraEm,
      agora,
      rotaDoPar: rotaDoPar?.geometria ?? null,
    });
  }

  async fotoPorToken(token: string, fotoId: string) {
    const link = await this.buscarLinkValido(token);
    // Mesma regra do comprovante: o token resolve a empresa, e a leitura da foto
    // corre dentro dela.
    const foto = await comConta(link.contaId, () =>
      this.prisma.ticketFoto.findFirst({
        where: { id: fotoId, viagemId: link.viagemId },
        select: { storageKey: true },
      }),
    );
    if (!foto) throw new NotFoundException("Foto não encontrada");

    const buffer = await this.uploads.getObjectBuffer(foto.storageKey);
    const ext = foto.storageKey.split(".").pop()?.toLowerCase();
    return { buffer, contentType: ext === "png" ? "image/png" : "image/jpeg" };
  }

  // --------------------------------------------------------------- helpers ---

  /** Base pública do painel. Runtime (não build) pra não exigir rebuild do Next. */
  get baseUrl(): string {
    return (this.config.get<string>("PUBLIC_APP_URL") ?? "http://localhost:3001").replace(/\/+$/, "");
  }

  urlDoToken(token: string): string {
    return `${this.baseUrl}/v/${token}`;
  }

  /**
   * Acha o link pelo token. Roda SEM conta no contexto de propósito: é uma
   * página pública, aberta pelo cliente da empresa, sem login — o token é
   * justamente o que revela de qual empresa é a viagem. Depois de resolvido, o
   * resto da leitura roda dentro da conta dona (ver `viagemPorToken`).
   */
  private async buscarLinkValido(token: string) {
    const link = await comoSistema(() =>
      this.prisma.viagemCompartilhamento.findUnique({
        where: { token },
        select: {
          id: true,
          contaId: true,
          viagemId: true,
          expiraEm: true,
          revogadoEm: true,
          primeiroAcessoEm: true,
        },
      }),
    );
    // Nunca logar o token — nem aqui, nem no erro.
    if (!link) {
      throw new NotFoundException({ code: "LINK_INVALIDO", message: "Link não encontrado" });
    }
    if (link.revogadoEm) {
      throw new LinkIndisponivelException("LINK_REVOGADO", "Este link foi desativado");
    }
    if (link.expiraEm < new Date()) {
      throw new LinkIndisponivelException("LINK_EXPIRADO", "Este link expirou");
    }
    return link;
  }

  private async ensureViagemNoEscopo(viagemId: string, escopo: EscopoAdmin) {
    // 404 e não 403 quando fora do escopo: um 403 confirmaria que o id existe,
    // virando oráculo pro gestor mapear a operação das outras frotas.
    const viagem = await this.prisma.viagem.findFirst({
      where: { id: viagemId, ...filtroEscopo(escopo) },
      select: { id: true },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada");
  }

  private paraPainel(link: {
    id: string;
    token: string;
    expiraEm: Date;
    revogadoEm: Date | null;
    visualizacoes: number;
    ultimoAcessoEm: Date | null;
    destinatarioTelefone: string | null;
    enviadoEm: Date | null;
    criadoEm: Date;
    criadoPor: { nome: string } | null;
  }) {
    const expirado = link.expiraEm < new Date();
    return {
      id: link.id,
      url: this.urlDoToken(link.token),
      estado: link.revogadoEm ? ("REVOGADO" as const) : expirado ? ("EXPIRADO" as const) : ("ATIVO" as const),
      expiraEm: link.expiraEm.toISOString(),
      revogadoEm: link.revogadoEm?.toISOString() ?? null,
      visualizacoes: link.visualizacoes,
      ultimoAcessoEm: link.ultimoAcessoEm?.toISOString() ?? null,
      destinatarioTelefone: link.destinatarioTelefone,
      enviadoEm: link.enviadoEm?.toISOString() ?? null,
      criadoEm: link.criadoEm.toISOString(),
      criadoPorNome: link.criadoPor?.nome ?? null,
    };
  }

  /**
   * Texto do WhatsApp. Montado AQUI, não no painel: a URL do comprovante nunca
   * pode ser escolhida por quem envia.
   */
  private async montarMensagem(
    viagemId: string,
    token: string,
    expiraEm: Date,
    mensagemExtra?: string,
  ): Promise<{ texto: string; params: string[] }> {
    const v = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: {
        data: true,
        km: true,
        toneladas: true,
        material: { select: { nome: true } },
        veiculo: { select: { placa: true } },
        localCarga: { select: { nome: true } },
        localDescarga: { select: { nome: true } },
      },
    });
    if (!v) throw new NotFoundException("Viagem não encontrada");

    // Assina com o nome da EMPRESA que prestou o serviço, não com o da
    // plataforma — quem recebe é o cliente dela, e o comprovante é dela.
    const conta = await this.prisma.conta.findUnique({
      where: { id: contaIdAtual() },
      select: { nome: true },
    });

    const linhas: string[] = [];
    if (mensagemExtra?.trim()) linhas.push(mensagemExtra.trim(), "");

    linhas.push(
      v.data
        ? `Olá! Segue o comprovante da viagem do dia ${dataBR(v.data)}.`
        : "Olá! Segue o comprovante da viagem.",
      "",
    );

    const trecho =
      v.localCarga || v.localDescarga
        ? `${v.localCarga?.nome ?? "—"} → ${v.localDescarga?.nome ?? "—"}`
        : null;
    if (trecho) linhas.push(trecho);

    const detalhes = [
      v.veiculo ? `Placa ${v.veiculo.placa}` : null,
      v.toneladas != null && v.material ? `${numBR(v.toneladas.toFixed(3))} t de ${v.material.nome}` : null,
      v.km != null ? `${numBR(v.km.toFixed(2))} km` : null,
    ].filter(Boolean);
    if (detalhes.length > 0) linhas.push(detalhes.join(" · "));

    linhas.push("", "Ver comprovante:", this.urlDoToken(token), "");
    linhas.push(`O link fica disponível até ${dataHoraBR(expiraEm)}.`);
    if (conta?.nome) linhas.push(conta.nome);

    /**
     * Os mesmos dados na forma que a Meta aceita: uma linha por parâmetro,
     * nenhum vazio (parâmetro em branco derruba a mensagem inteira).
     *
     * A data entra junto do trecho em vez de virar parâmetro próprio porque
     * `Viagem.data` é anulável: um parâmetro só pra ela precisaria de um
     * travessão de enchimento quando faltasse.
     *
     * O link NÃO está aqui — ele é o sufixo da URL do botão, último parâmetro.
     */
    const params = [
      [v.data ? dataBR(v.data) : null, trecho].filter(Boolean).join(" · ") ||
        "Comprovante de viagem",
      detalhes.length > 0 ? detalhes.join(" · ") : (conta?.nome ?? "Movatruck"),
      mensagemExtra?.trim() || "Qualquer dúvida, é só chamar.",
      dataHoraBR(expiraEm),
      token,
    ].map(achatarParam);

    return { texto: linhas.join("\n"), params };
  }
}

/**
 * 410 Gone com `code` pra a página pública distinguir expirado de revogado —
 * "peça um novo link" é acionável, "link inválido" não.
 */
export class LinkIndisponivelException extends HttpException {
  constructor(code: "LINK_REVOGADO" | "LINK_EXPIRADO", message: string) {
    super({ code, message }, HttpStatus.GONE);
  }
}

function gerarToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** +5544998887766 → +55 44 9****-7766. Nunca o número inteiro na auditoria. */
function mascararTelefone(numero: string): string {
  if (numero.length < 6) return "****";
  return `${numero.slice(0, 4)}${"*".repeat(numero.length - 8)}${numero.slice(-4)}`;
}

/** `@db.Date` é meia-noite UTC — formatar em UTC, senão volta um dia. */
function dataBR(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

/** Timestamp real: o container roda em UTC, ancorar em São Paulo. */
function dataHoraBR(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function numBR(s: string): string {
  return s.replace(".", ",");
}
