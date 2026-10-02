import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { Prisma, StatusViagem } from "@prisma/client";
import type {
  ConfigEnvioTicket,
  ConfigEnvioTicketInput,
  EmailEnviadoResumo,
  ModoEnvioTicket,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { comLockDeCron } from "../../common/cron-exclusivo";
import { paraCadaConta } from "../../common/conta/para-cada-conta";
import { contaIdAtual } from "../../common/conta/conta-context";
import { inicioDoDiaInstante, ymdSaoPaulo } from "../../common/timezone";
import { gerarToken } from "../../compartilhamento/compartilhamento.service";
import { EmailService, podeRetomar } from "../email.service";
import type { MarcaEmail } from "../email-layout";
import {
  chaveResumoDiario,
  chaveTicketViagem,
  JANELA_VARREDURA_MS,
  montarEmailResumoDiario,
  montarEmailTeste,
  montarEmailTicketViagem,
  novoDesde,
  resolverEnvioTicket,
  TIPO_EMAIL_TICKET_RESUMO,
  TIPO_EMAIL_TICKET_TESTE,
  TIPO_EMAIL_TICKET_VIAGEM,
  viagemEntraNoTicket,
  type EnvioTicketEfetivo,
  type ViagemDoTicket,
} from "./ticket-cliente.regras";

/**
 * Ticket da viagem enviado sozinho, por e-mail, ao cliente da transportadora.
 *
 * POR QUE VARREDURA e não um gancho no "aprovar": a viagem vira aprovada em
 * pelo menos cinco lugares (conferência manual, pré-aprovação da IA, material
 * que dispensa conferência no lançar, no completar peso e no finalizar do
 * lifecycle — fora os scripts retroativos). Pendurar o e-mail em cada um é o
 * jeito garantido de esquecer o sexto. O ponto central de verdade é o DADO:
 * toda aprovação carimba `status = OK` + `revisadoEm`. A varredura a cada 2
 * minutos olha esse dado e pega todos os caminhos — inclusive os que ainda não
 * existem.
 *
 * Idempotência mora no `EmailEnviado.chave` (unique): `ticket-viagem:<id>`
 * é reservado antes do envio, então nem duas réplicas nem duas varreduras
 * mandam a mesma viagem duas vezes.
 */

/** Quanto tempo vale o link que vai no e-mail. O maior que o painel oferece. */
const DIAS_LINK = 90;
/** Um link existente só é reaproveitado se ainda tiver pelo menos isto de vida. */
const FOLGA_LINK_MS = 30 * 24 * 3_600_000;
/** Teto por obra por varredura — protege o SMTP de uma rajada (backlog de fim de semana). */
const LOTE_POR_OBRA = 100;

const SELECT_VIAGEM_TICKET = {
  id: true,
  status: true,
  revisadoEm: true,
  data: true,
  ticket: true,
  toneladas: true,
  criadoOfflineEm: true,
  sincronizadoEm: true,
  veiculo: { select: { placa: true } },
  motorista: { select: { nome: true } },
  material: { select: { nome: true } },
  localCarga: { select: { nome: true } },
  localDescarga: { select: { nome: true } },
} satisfies Prisma.ViagemSelect;
type ViagemTicketRow = Prisma.ViagemGetPayload<{ select: typeof SELECT_VIAGEM_TICKET }>;

interface ObraAlvo {
  id: string;
  nome: string;
  empresaId: string;
  efetivo: EnvioTicketEfetivo;
}

@Injectable()
export class TicketClienteService {
  private readonly log = new Logger("TicketCliente");

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Crons
  // ---------------------------------------------------------------------------

  @Cron("30 */2 * * * *", { name: "ticket-cliente-a-cada-viagem", timeZone: "America/Sao_Paulo" })
  async cronACadaViagem(): Promise<void> {
    // Sem SMTP, nem varre: não há o que fazer e não vale abrir lock por nada.
    if (!this.email.disponivel().ok) return;
    await comLockDeCron(this.prisma, "ticket-cliente-a-cada-viagem", async () => {
      await paraCadaConta(this.prisma, async () => {
        await this.varrerACadaViagem(new Date());
      });
    });
  }

  @Cron("0 0 19 * * *", { name: "ticket-cliente-resumo-diario", timeZone: "America/Sao_Paulo" })
  async cronResumoDiario(): Promise<void> {
    if (!this.email.disponivel().ok) return;
    await comLockDeCron(this.prisma, "ticket-cliente-resumo-diario", async () => {
      await paraCadaConta(this.prisma, async () => {
        await this.enviarResumosDoDia(new Date());
      });
    });
  }

  /**
   * Uma passada na conta do contexto. Público pra o teste de ponta a ponta
   * chamar sem esperar o relógio.
   */
  async varrerACadaViagem(agora: Date): Promise<{ enviados: number; falhas: number }> {
    const obras = await this.obrasComModo("A_CADA_VIAGEM");
    let enviados = 0;
    let falhas = 0;
    if (obras.length === 0) return { enviados, falhas };

    const marca = await this.marcaDaConta();
    const piso = new Date(agora.getTime() - JANELA_VARREDURA_MS);

    for (const obra of obras) {
      const desde = obra.efetivo.desde;
      if (!desde) continue;
      const viagens = await this.prisma.viagem.findMany({
        where: {
          clienteId: obra.id,
          status: StatusViagem.OK,
          revisadoEm: { gte: desde > piso ? desde : piso },
        },
        orderBy: { revisadoEm: "asc" },
        take: LOTE_POR_OBRA,
        select: SELECT_VIAGEM_TICKET,
      });
      const candidatas = viagens.filter((v) => viagemEntraNoTicket(v, desde));
      if (candidatas.length === 0) continue;

      // Pula o que já saiu (ou está saindo) sem nem montar o e-mail. A reserva
      // no EmailService é a garantia; isto aqui é só pra não gastar trabalho.
      const jaTem = await this.prisma.emailEnviado.findMany({
        where: { chave: { in: candidatas.map((v) => chaveTicketViagem(v.id)) } },
        select: { chave: true, status: true, tentativas: true, ultimaTentativaEm: true },
      });
      const bloqueadas = new Set(jaTem.filter((r) => !podeRetomar(r, agora)).map((r) => r.chave));

      for (const v of candidatas) {
        const chave = chaveTicketViagem(v.id);
        if (bloqueadas.has(chave)) continue;
        const link = await this.linkDoComprovante(v.id, agora);
        const conteudo = montarEmailTicketViagem({ marca, obraNome: obra.nome, viagem: this.paraEmail(v, link) });
        const r = await this.email.tentarEnviar({
          tipo: TIPO_EMAIL_TICKET_VIAGEM,
          para: obra.efetivo.emails,
          ...conteudo,
          chave,
          referencia: { tipo: "Viagem", id: v.id },
          empresaId: obra.empresaId,
          clienteId: obra.id,
        });
        if (r.status === "ENVIADO") enviados++;
        else if (r.status === "FALHOU") falhas++;
        else if (r.status === "DESLIGADO") return { enviados, falhas };
      }
    }
    if (enviados + falhas > 0) {
      this.log.log(JSON.stringify({ evento: "ticket-a-cada-viagem", contaId: contaIdAtual(), enviados, falhas }));
    }
    return { enviados, falhas };
  }

  /** Um e-mail por obra com as viagens aprovadas no dia (São Paulo). Dia vazio não manda nada. */
  async enviarResumosDoDia(agora: Date): Promise<{ enviados: number; falhas: number }> {
    const obras = await this.obrasComModo("RESUMO_DIARIO");
    let enviados = 0;
    let falhas = 0;
    if (obras.length === 0) return { enviados, falhas };

    const marca = await this.marcaDaConta();
    const inicioDia = inicioDoDiaInstante(agora);
    const [y, m, d] = ymdSaoPaulo(agora);
    const diaISO = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const diaBR = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;

    for (const obra of obras) {
      const desde = obra.efetivo.desde;
      if (!desde) continue;
      const viagens = await this.prisma.viagem.findMany({
        where: {
          clienteId: obra.id,
          status: StatusViagem.OK,
          revisadoEm: { gte: desde > inicioDia ? desde : inicioDia, lte: agora },
        },
        orderBy: { revisadoEm: "asc" },
        select: SELECT_VIAGEM_TICKET,
      });
      const doDia = viagens.filter((v) => viagemEntraNoTicket(v, desde));
      if (doDia.length === 0) continue;

      const itens: ViagemDoTicket[] = [];
      for (const v of doDia) itens.push(this.paraEmail(v, await this.linkDoComprovante(v.id, agora)));

      const conteudo = montarEmailResumoDiario({ marca, obraNome: obra.nome, diaBR, viagens: itens });
      const r = await this.email.tentarEnviar({
        tipo: TIPO_EMAIL_TICKET_RESUMO,
        para: obra.efetivo.emails,
        ...conteudo,
        chave: chaveResumoDiario(obra.id, diaISO),
        referencia: { tipo: "Cliente", id: obra.id },
        empresaId: obra.empresaId,
        clienteId: obra.id,
      });
      if (r.status === "ENVIADO") enviados++;
      else if (r.status === "FALHOU") falhas++;
      else if (r.status === "DESLIGADO") break;
    }
    this.log.log(JSON.stringify({ evento: "ticket-resumo-diario", contaId: contaIdAtual(), dia: diaISO, enviados, falhas }));
    return { enviados, falhas };
  }

  // ---------------------------------------------------------------------------
  // Painel
  // ---------------------------------------------------------------------------

  async configPagador(empresaId: string): Promise<ConfigEnvioTicket> {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { ticketEnvioModo: true, ticketEmails: true, ticketEnvioDesde: true },
    });
    if (!e) throw new NotFoundException("Cliente não encontrado");
    return {
      modo: e.ticketEnvioModo,
      emails: e.ticketEmails,
      desde: e.ticketEnvioDesde?.toISOString() ?? null,
      emailDisponivel: this.email.disponivel().ok,
      historico: await this.historico({ empresaId }),
    };
  }

  async configObra(clienteId: string): Promise<ConfigEnvioTicket> {
    const c = await this.prisma.cliente.findUnique({
      where: { id: clienteId },
      select: {
        ticketEnvioModo: true,
        ticketEmails: true,
        ticketEnvioDesde: true,
        empresa: { select: { ticketEnvioModo: true, ticketEmails: true, ticketEnvioDesde: true } },
      },
    });
    if (!c) throw new NotFoundException("Obra não encontrada");
    const efetivo = resolverEnvioTicket(
      { modo: c.ticketEnvioModo, emails: c.ticketEmails, desde: c.ticketEnvioDesde },
      { modo: c.empresa.ticketEnvioModo, emails: c.empresa.ticketEmails, desde: c.empresa.ticketEnvioDesde },
    );
    return {
      modo: c.ticketEnvioModo,
      emails: c.ticketEmails,
      desde: c.ticketEnvioDesde?.toISOString() ?? null,
      efetivo: { modo: efetivo.modo, emails: efetivo.emails, origem: efetivo.origem },
      emailDisponivel: this.email.disponivel().ok,
      historico: await this.historico({ clienteId }),
    };
  }

  async salvarPagador(empresaId: string, input: ConfigEnvioTicketInput): Promise<ConfigEnvioTicket> {
    if (input.modo == null) {
      // "Seguir o pagador" só existe na obra: o pagador é a raiz.
      throw new BadRequestException("Escolha como o cliente recebe os tickets.");
    }
    const atual = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { ticketEnvioModo: true, ticketEnvioDesde: true },
    });
    if (!atual) throw new NotFoundException("Cliente não encontrado");
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        ticketEnvioModo: input.modo,
        ticketEmails: input.emails,
        ticketEnvioDesde: novoDesde({ modo: atual.ticketEnvioModo, desde: atual.ticketEnvioDesde }, input.modo, new Date()),
      },
    });
    return this.configPagador(empresaId);
  }

  async salvarObra(clienteId: string, input: ConfigEnvioTicketInput): Promise<ConfigEnvioTicket> {
    const atual = await this.prisma.cliente.findUnique({
      where: { id: clienteId },
      select: { ticketEnvioModo: true, ticketEnvioDesde: true },
    });
    if (!atual) throw new NotFoundException("Obra não encontrada");
    await this.prisma.cliente.update({
      where: { id: clienteId },
      data: {
        ticketEnvioModo: input.modo,
        // Seguindo o pagador, a lista da obra não vale — limpa pra não ficar
        // e-mail "escondido" que volta a receber quando alguém trocar o modo.
        ticketEmails: input.modo == null ? [] : input.emails,
        ticketEnvioDesde: novoDesde({ modo: atual.ticketEnvioModo, desde: atual.ticketEnvioDesde }, input.modo, new Date()),
      },
    });
    return this.configObra(clienteId);
  }

  async enviarTeste(
    alvo: { empresaId: string } | { clienteId: string },
    emails: string[],
    usuarioId: string,
  ): Promise<{ ok: true; para: string[] }> {
    let nome: string;
    let modo: ModoEnvioTicket | null;
    let empresaId: string | null = null;
    let clienteId: string | null = null;
    if ("empresaId" in alvo) {
      const e = await this.prisma.empresa.findUnique({
        where: { id: alvo.empresaId },
        select: { id: true, nome: true, ticketEnvioModo: true },
      });
      if (!e) throw new NotFoundException("Cliente não encontrado");
      nome = e.nome;
      modo = e.ticketEnvioModo;
      empresaId = e.id;
    } else {
      const c = await this.prisma.cliente.findUnique({
        where: { id: alvo.clienteId },
        select: { id: true, nome: true, empresaId: true, ticketEnvioModo: true },
      });
      if (!c) throw new NotFoundException("Obra não encontrada");
      nome = c.nome;
      modo = c.ticketEnvioModo;
      empresaId = c.empresaId;
      clienteId = c.id;
    }
    const marca = await this.marcaDaConta();
    const conteudo = montarEmailTeste({ marca, nomeDestino: nome, modo, agora: new Date() });
    await this.email.enviarOuFalhar({
      tipo: TIPO_EMAIL_TICKET_TESTE,
      para: emails,
      ...conteudo,
      empresaId,
      clienteId,
      criadoPorId: usuarioId,
    });
    return { ok: true, para: emails };
  }

  // ---------------------------------------------------------------------------
  // Apoio
  // ---------------------------------------------------------------------------

  /**
   * Obras cujo envio EFETIVO é `modo`. Busca as que configuraram o modo nelas
   * e as que seguem um pagador com o modo, e decide de vez pela regra pura —
   * a query só estreita, quem manda é `resolverEnvioTicket`.
   */
  private async obrasComModo(modo: ModoEnvioTicket): Promise<ObraAlvo[]> {
    const linhas = await this.prisma.cliente.findMany({
      where: {
        OR: [{ ticketEnvioModo: modo }, { ticketEnvioModo: null, empresa: { ticketEnvioModo: modo } }],
      },
      select: {
        id: true,
        nome: true,
        empresaId: true,
        ticketEnvioModo: true,
        ticketEmails: true,
        ticketEnvioDesde: true,
        empresa: { select: { ticketEnvioModo: true, ticketEmails: true, ticketEnvioDesde: true } },
      },
    });
    return linhas
      .map((c) => ({
        id: c.id,
        nome: c.nome,
        empresaId: c.empresaId,
        efetivo: resolverEnvioTicket(
          { modo: c.ticketEnvioModo, emails: c.ticketEmails, desde: c.ticketEnvioDesde },
          { modo: c.empresa.ticketEnvioModo, emails: c.empresa.ticketEmails, desde: c.empresa.ticketEnvioDesde },
        ),
      }))
      .filter((o) => o.efetivo.modo === modo);
  }

  private async historico(where: { empresaId: string } | { clienteId: string }): Promise<EmailEnviadoResumo[]> {
    const linhas = await this.prisma.emailEnviado.findMany({
      where,
      orderBy: { criadoEm: "desc" },
      take: 10,
      select: { id: true, tipo: true, para: true, assunto: true, status: true, erro: true, criadoEm: true, enviadoEm: true },
    });
    return linhas.map((l) => ({
      ...l,
      criadoEm: l.criadoEm.toISOString(),
      enviadoEm: l.enviadoEm?.toISOString() ?? null,
    }));
  }

  /**
   * Link público do comprovante — o mesmo `/v/<token>` que o painel gera à mão.
   * Reaproveita um link vivo (com folga) pra retentativa e resumo não semearem
   * dez links por viagem; senão cria um de 90 dias, sem autor (foi o sistema).
   */
  private async linkDoComprovante(viagemId: string, agora: Date): Promise<string> {
    const vivo = await this.prisma.viagemCompartilhamento.findFirst({
      where: { viagemId, revogadoEm: null, expiraEm: { gt: new Date(agora.getTime() + FOLGA_LINK_MS) } },
      orderBy: { expiraEm: "desc" },
      select: { token: true },
    });
    const token =
      vivo?.token ??
      (
        await this.prisma.viagemCompartilhamento.create({
          data: { viagemId, token: gerarToken(), expiraEm: new Date(agora.getTime() + DIAS_LINK * 86_400_000) },
          select: { token: true },
        })
      ).token;
    const base = (this.config.get<string>("PUBLIC_APP_URL") ?? "http://localhost:3001").replace(/\/+$/, "");
    return `${base}/v/${token}`;
  }

  /**
   * Nome e logo da transportadora. A logo é servida pela API em caminho
   * relativo; e-mail precisa de URL absoluta, então só vai com `PUBLIC_API_URL`
   * configurada — sem ela, sai o nome (melhor que imagem quebrada).
   */
  private async marcaDaConta(): Promise<MarcaEmail> {
    const contaId = contaIdAtual();
    const conta = contaId
      ? await this.prisma.conta.findUnique({ where: { id: contaId }, select: { nome: true, logoUrl: true } })
      : null;
    const nome = conta?.nome ?? "Sua transportadora";
    const baseApi = (this.config.get<string>("PUBLIC_API_URL") ?? "").replace(/\/+$/, "");
    const logo = conta?.logoUrl ?? null;
    const logoUrl = !logo ? null : /^https?:\/\//.test(logo) ? logo : baseApi ? `${baseApi}${logo}` : null;
    return { nome, logoUrl };
  }

  private paraEmail(v: ViagemTicketRow, link: string | null): ViagemDoTicket {
    return {
      placa: v.veiculo.placa,
      motoristaNome: v.motorista.nome,
      data: v.data,
      lancadaEm: v.criadoOfflineEm ?? v.sincronizadoEm,
      material: v.material?.nome ?? null,
      toneladas: v.toneladas?.toString() ?? null,
      ticket: v.ticket,
      origem: v.localCarga?.nome ?? null,
      destino: v.localDescarga?.nome ?? null,
      link,
    };
  }
}
