import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { createTransport, type Transporter } from "nodemailer";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Envio de e-mail do sistema, por SMTP genérico.
 *
 * POR QUE SMTP e não o SDK de um provedor: o provedor ainda não foi escolhido
 * (a recomendação é Amazon SES, mas Resend, Brevo e qualquer outro falam SMTP).
 * Trocar de provedor vira trocar quatro variáveis de ambiente, sem deploy de
 * código.
 *
 * Nasce DESLIGADO, igual ao Instagram e ao Asaas: sem `SMTP_HOST` +
 * `EMAIL_REMETENTE` nada sai, o boot diz isso UMA vez, e quem chama recebe
 * `DESLIGADO` em vez de exceção. Um e-mail que não pode sair nunca derruba a
 * API nem o cron que pediu.
 *
 * Toda tentativa vira uma linha em `EmailEnviado` — é o que responde "mandei
 * ou não mandei?" quando o cliente diz que não recebeu.
 */

export interface AnexoEmail {
  nome: string;
  conteudo: Buffer;
  tipo: string;
}

export interface MensagemEmail {
  /** Qual mensagem é (TICKET_VIAGEM, TICKET_RESUMO_DIARIO, TESTE...). Vai pro registro. */
  tipo: string;
  para: string[];
  assunto: string;
  html: string;
  texto: string;
  anexos?: AnexoEmail[];
  /**
   * Idempotência. Com chave, a linha do registro é reservada ANTES do envio e
   * uma segunda chamada com a mesma chave não manda de novo (a não ser que a
   * anterior tenha falhado ou travado — aí ela retoma).
   */
  chave?: string;
  referencia?: { tipo: string; id: string };
  empresaId?: string | null;
  clienteId?: string | null;
  criadoPorId?: string | null;
}

export type ResultadoEmail =
  | { ok: true; status: "ENVIADO"; registroId: string }
  /** Já tinha saído (ou outra instância está mandando agora). Não é erro. */
  | { ok: true; status: "DUPLICADO"; registroId: string }
  | { ok: false; status: "DESLIGADO"; motivo: string }
  | { ok: false; status: "FALHOU"; registroId: string; erro: string };

/** Depois de quantas tentativas uma chave desiste de vez. */
export const TENTATIVAS_MAX_EMAIL = 3;
/** Linha ENVIANDO mais velha que isto = processo morreu no meio do envio. */
export const ENVIANDO_ORFAO_MS = 10 * 60_000;

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly log = new Logger("Email");
  private readonly host: string;
  private readonly porta: number;
  private readonly usuario: string;
  private readonly senha: string;
  private readonly remetente: string;
  private transporter: Transporter | null = null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.host = (config.get<string>("SMTP_HOST") ?? "").trim();
    const porta = Number((config.get<string>("SMTP_PORT") ?? "").trim() || "587");
    this.porta = Number.isFinite(porta) && porta > 0 ? porta : 587;
    this.usuario = (config.get<string>("SMTP_USER") ?? "").trim();
    this.senha = config.get<string>("SMTP_PASS") ?? "";
    this.remetente = (config.get<string>("EMAIL_REMETENTE") ?? "").trim();
  }

  onModuleInit() {
    const d = this.disponivel();
    if (!d.ok) {
      this.log.log(`E-mail DESLIGADO (${d.motivo}): nenhum e-mail sai.`);
      return;
    }
    // Diz o que está ligado sem vazar segredo: host e porta, nunca a senha.
    this.log.log(
      `E-mail LIGADO via ${this.host}:${this.porta}${this.usuario ? " (com autenticação)" : ""}, remetente ${this.remetente}`,
    );
  }

  /** Dá pra mandar e-mail? O motivo sai pronto pra tela do painel. */
  disponivel(): { ok: true } | { ok: false; motivo: string } {
    const falta = [
      this.host ? null : "SMTP_HOST",
      this.remetente ? null : "EMAIL_REMETENTE",
    ].filter(Boolean);
    if (falta.length > 0) return { ok: false, motivo: `falta ${falta.join(" e ")}` };
    return { ok: true };
  }

  /**
   * Manda e devolve o resultado. NUNCA lança — pra cron e fluxo automático,
   * que não podem cair porque o SMTP está fora.
   */
  async tentarEnviar(msg: MensagemEmail): Promise<ResultadoEmail> {
    const disp = this.disponivel();
    if (!disp.ok) return { ok: false, status: "DESLIGADO", motivo: `E-mail desligado: ${disp.motivo}.` };

    const para = [...new Set(msg.para.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (para.length === 0) {
      return { ok: false, status: "DESLIGADO", motivo: "Nenhum destinatário." };
    }

    let registroId: string;
    try {
      const reserva = await this.reservar({ ...msg, para });
      if (reserva.duplicado) return { ok: true, status: "DUPLICADO", registroId: reserva.id };
      registroId = reserva.id;
    } catch (e) {
      // Sem registro não se manda: um envio sem rastro é exatamente o "mandei
      // ou não mandei?" que este serviço existe pra responder.
      const erro = (e as Error).message;
      this.log.error(`Falha ao registrar e-mail "${msg.tipo}": ${erro}`);
      return { ok: false, status: "DESLIGADO", motivo: "Não foi possível registrar o envio." };
    }

    try {
      const info = await this.transporte().sendMail({
        from: this.remetente,
        to: para,
        subject: msg.assunto,
        html: msg.html,
        text: msg.texto,
        attachments: msg.anexos?.map((a) => ({
          filename: a.nome,
          content: a.conteudo,
          contentType: a.tipo,
        })),
      });
      await this.prisma.emailEnviado.update({
        where: { id: registroId },
        data: { status: "ENVIADO", enviadoEm: new Date(), erro: null, messageId: info.messageId ?? null },
      });
      return { ok: true, status: "ENVIADO", registroId };
    } catch (e) {
      const erro = resumirErro(e);
      this.log.warn(`E-mail "${msg.tipo}" para ${para.length} destinatário(s) falhou: ${erro}`);
      await this.prisma.emailEnviado
        .update({ where: { id: registroId }, data: { status: "FALHOU", erro } })
        .catch((e2: unknown) => this.log.error(`Falha ao marcar e-mail como FALHOU: ${(e2 as Error).message}`));
      return { ok: false, status: "FALHOU", registroId, erro };
    }
  }

  /**
   * Manda ou lança 503 `ENVIO_EMAIL_FALHOU` — pra quem não pode dizer que
   * enviou sem ter enviado (o botão "Enviar teste" do painel).
   */
  async enviarOuFalhar(msg: MensagemEmail): Promise<{ registroId: string }> {
    const r = await this.tentarEnviar(msg);
    if (r.ok) return { registroId: r.registroId };
    throw new ServiceUnavailableException({
      code: "ENVIO_EMAIL_FALHOU",
      message: r.status === "DESLIGADO" ? r.motivo : `O servidor de e-mail recusou: ${r.erro}`,
    });
  }

  private transporte(): Transporter {
    if (!this.transporter) {
      this.transporter = createTransport({
        host: this.host,
        port: this.porta,
        // 465 é TLS direto; 587/2525 começam em claro e sobem com STARTTLS.
        secure: this.porta === 465,
        auth: this.usuario ? { user: this.usuario, pass: this.senha } : undefined,
        // Cron não pode ficar pendurado num SMTP que não responde.
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
      });
    }
    return this.transporter;
  }

  /**
   * Cria a linha ENVIANDO antes de mandar. Com chave, o unique decide quem
   * manda: a segunda chamada vê a linha e só retoma se a anterior FALHOU (ainda
   * com tentativas) ou ficou órfã em ENVIANDO. A retomada é um `updateMany`
   * condicionado ao estado lido — duas instâncias disputando, só uma ganha.
   */
  private async reservar(msg: MensagemEmail): Promise<{ id: string; duplicado: boolean }> {
    const dados = {
      tipo: msg.tipo,
      para: msg.para,
      assunto: msg.assunto.slice(0, 300),
      chave: msg.chave ?? null,
      referenciaTipo: msg.referencia?.tipo ?? null,
      referenciaId: msg.referencia?.id ?? null,
      empresaId: msg.empresaId ?? null,
      clienteId: msg.clienteId ?? null,
      criadoPorId: msg.criadoPorId ?? null,
      tentativas: 1,
    };
    try {
      const r = await this.prisma.emailEnviado.create({ data: dados, select: { id: true } });
      return { id: r.id, duplicado: false };
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") || !msg.chave) throw e;
    }

    const existente = await this.prisma.emailEnviado.findUnique({
      where: { chave: msg.chave },
      select: { id: true, status: true, tentativas: true, ultimaTentativaEm: true },
    });
    if (!existente) throw new Error(`chave ${msg.chave} sumiu entre o create e a leitura`);
    if (!podeRetomar(existente, new Date())) return { id: existente.id, duplicado: true };

    const pegou = await this.prisma.emailEnviado.updateMany({
      where: {
        id: existente.id,
        status: existente.status,
        ultimaTentativaEm: existente.ultimaTentativaEm,
      },
      data: {
        status: "ENVIANDO",
        erro: null,
        tentativas: { increment: 1 },
        ultimaTentativaEm: new Date(),
        para: msg.para,
        assunto: dados.assunto,
      },
    });
    return { id: existente.id, duplicado: pegou.count === 0 };
  }
}

/** Uma linha com esta chave pode ser mandada de novo? (regra pura, testada) */
export function podeRetomar(
  r: { status: "ENVIANDO" | "ENVIADO" | "FALHOU"; tentativas: number; ultimaTentativaEm: Date },
  agora: Date,
): boolean {
  if (r.status === "ENVIADO") return false;
  if (r.tentativas >= TENTATIVAS_MAX_EMAIL) return false;
  if (r.status === "FALHOU") return true;
  return agora.getTime() - r.ultimaTentativaEm.getTime() > ENVIANDO_ORFAO_MS;
}

/** O erro do SMTP vem com a conversa inteira; o registro guarda o essencial. */
function resumirErro(e: unknown): string {
  const err = e as { message?: string; responseCode?: number; code?: string };
  const base = err.message ?? String(e);
  const codigo = err.responseCode ? `[${err.responseCode}] ` : err.code ? `[${err.code}] ` : "";
  return `${codigo}${base}`.replace(/\s+/g, " ").slice(0, 500);
}
