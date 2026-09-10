import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { randomInt } from "node:crypto";
import type {
  ConfirmarCadastroContaInput,
  IniciarCadastroContaInput,
  IniciarCadastroContaOutput,
} from "@ronan/shared-types";
import { NOME_PLATAFORMA } from "@ronan/shared-types";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { ContasService } from "../admin/contas/contas.service";
import { EnvioWhatsappService } from "../whatsapp/envio/envio-whatsapp.service";
import { SessaoService } from "../whatsapp/sessao.service";
import { AdminInboxService } from "../admin/inbox/inbox.service";

/** Mesmas réguas do cadastro do motorista, que já rodam em produção. */
const TTL_MINUTOS = 10;
const MAX_TENTATIVAS = 5;
const MAX_REENVIOS = 5;
const COOLDOWN_SEGUNDOS = 60;

/**
 * Resposta única para tudo que não deve virar consulta.
 *
 * Criar empresa pelo painel responde "já existe empresa com esse identificador"
 * e "esse e-mail já é usado" — informação boa para quem administra a plataforma
 * e péssima numa porta pública, onde vira jeito de descobrir quais empresas são
 * clientes e quais e-mails têm acesso ao sistema.
 */
const RESPOSTA_GENERICA = (destinoMascarado: string): IniciarCadastroContaOutput => ({
  ok: true,
  expiraEmSegundos: TTL_MINUTOS * 60,
  destinoMascarado,
});

/**
 * Auto-cadastro de empresa: o transportador abre a conta dele pelo site.
 *
 * Três atos, como o cadastro do motorista: grava um pendente global, manda o
 * código por WhatsApp, e só cria a empresa quando o código volta. A conta nunca
 * nasce de um formulário — nasce de um número de celular que respondeu.
 */
@Injectable()
export class CadastroContaService {
  private readonly log = new Logger(CadastroContaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contas: ContasService,
    private readonly envio: EnvioWhatsappService,
    private readonly inbox: AdminInboxService,
  ) {}

  /**
   * A porta está aberta? E por quantos dias vale o teste?
   *
   * Vem do banco, editável na tela de Empresas — fechar o cadastro num dia de
   * pico, ou esticar o teste de 14 pra 30 dias, não pode ser deploy.
   */
  private async configuracao(): Promise<{ aberto: boolean; dias: number; maxPorHora: number }> {
    const cfg = await comoSistema(() =>
      this.prisma.configuracaoPlataforma.findUnique({ where: { id: "singleton" } }),
    );
    return {
      aberto: cfg?.autoCadastroAberto ?? false,
      dias: cfg?.diasTesteGratis ?? 14,
      maxPorHora: cfg?.maxCodigosPorHora ?? 30,
    };
  }

  /**
   * O teto de gasto: quantos códigos podem sair por hora, no mundo todo.
   *
   * É a única trava que segura VOLUME. As outras duas seguram insistência: o
   * limite por IP cai com uma lista de IPs, e o cooldown por telefone cai com
   * uma lista de números. Quem tem as duas coisas passa pelos dois freios e
   * gasta uma mensagem paga por tentativa — este teto é onde isso para.
   *
   * Conta no banco, e não em memória, justamente porque a conta precisa
   * sobreviver a um restart e valer igual com mais de uma réplica da API.
   */
  private async exigirTetoDeGasto(maxPorHora: number): Promise<void> {
    const desde = new Date(Date.now() - 3_600_000);
    const enviados = await comoSistema(() =>
      this.prisma.envioCodigoCadastro.count({ where: { criadoEm: { gte: desde } } }),
    );
    if (enviados >= maxPorHora) {
      this.log.warn(
        `Teto de códigos de cadastro atingido (${enviados}/${maxPorHora} na última hora).`,
      );
      throw new BadRequestException({
        code: "MUITOS_CADASTROS",
        message:
          "Estamos recebendo muitos cadastros agora. Tente daqui a pouco, ou fale com a gente pelo WhatsApp.",
      });
    }
  }

  private async exigirPortaAberta(): Promise<{ maxPorHora: number }> {
    const cfg = await this.configuracao();
    if (!cfg.aberto) {
      throw new BadRequestException({
        code: "CADASTRO_FECHADO",
        message:
          "O cadastro pelo site está fechado no momento. Fale com a gente pelo WhatsApp que a gente abre sua conta.",
      });
    }
    return { maxPorHora: cfg.maxPorHora };
  }

  async iniciar(
    input: IniciarCadastroContaInput,
    ip: string | null,
  ): Promise<IniciarCadastroContaOutput> {
    const { maxPorHora } = await this.exigirPortaAberta();
    // Robô preencheu o campo invisível. Responde igual a um cadastro bom, pra
    // não ensinar o que delatou.
    if (input.website) return RESPOSTA_GENERICA(mascarar(input.telefone));

    const telefone = SessaoService.normalizar(input.telefone);
    const destino = mascarar(input.telefone);

    return comoSistema(async () => {
      const pendente = await this.prisma.contaCadastroPendente.findUnique({ where: { telefone } });

      // Cooldown ANTES de qualquer envio, inclusive no primeiro passo.
      //
      // O cadastro do motorista só tem esta trava no reenviar, e é um buraco:
      // chamar `iniciar` em loop reinicia os contadores e dispara uma mensagem
      // de autenticação por chamada — que é a mais cara do catálogo. Aqui a
      // porta é pública e anônima, então a trava vem desde a primeira.
      if (pendente && segundosDesde(pendente.ultimoEnvioEm) < COOLDOWN_SEGUNDOS) {
        return RESPOSTA_GENERICA(destino);
      }

      // Quem já é cliente não abre outra empresa por aqui — mas a resposta é a
      // mesma de sempre, e nenhum código é enviado.
      const [emailEmUso, telefoneJaCliente] = await Promise.all([
        this.prisma.user.findUnique({ where: { email: input.adminEmail }, select: { id: true } }),
        this.prisma.conta.findFirst({
          where: { users: { some: { whatsappResumo: telefone } } },
          select: { id: true },
        }),
      ]);
      if (emailEmUso || telefoneJaCliente) {
        this.log.log(`Cadastro recusado em silêncio (já existe): ${destino}`);
        return RESPOSTA_GENERICA(destino);
      }

      await this.exigirTetoDeGasto(maxPorHora);

      const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const senhaHash = await AuthService.hashPassword(input.adminSenha);

      // Manda ANTES de gravar, como o "esqueci a senha": nunca dizer "código
      // enviado" sem ter enviado.
      await this.enviarCodigo(telefone, codigo, ip);

      await this.prisma.contaCadastroPendente.upsert({
        where: { telefone },
        create: {
          telefone,
          empresa: input.empresa.trim(),
          cnpj: input.cnpj || null,
          adminNome: input.adminNome.trim(),
          adminEmail: input.adminEmail.trim().toLowerCase(),
          senhaHash,
          codigo,
          expiraEm: new Date(Date.now() + TTL_MINUTOS * 60_000),
          ipCriacao: ip,
        },
        update: {
          empresa: input.empresa.trim(),
          cnpj: input.cnpj || null,
          adminNome: input.adminNome.trim(),
          adminEmail: input.adminEmail.trim().toLowerCase(),
          senhaHash,
          codigo,
          expiraEm: new Date(Date.now() + TTL_MINUTOS * 60_000),
          tentativas: 0,
          ultimoEnvioEm: new Date(),
          ipCriacao: ip,
        },
      });

      return RESPOSTA_GENERICA(destino);
    });
  }

  async reenviar(telefoneBruto: string): Promise<IniciarCadastroContaOutput> {
    const { maxPorHora } = await this.exigirPortaAberta();
    const telefone = SessaoService.normalizar(telefoneBruto);
    const destino = mascarar(telefoneBruto);

    return comoSistema(async () => {
      const pendente = await this.prisma.contaCadastroPendente.findUnique({ where: { telefone } });
      if (!pendente) return RESPOSTA_GENERICA(destino);
      if (segundosDesde(pendente.ultimoEnvioEm) < COOLDOWN_SEGUNDOS) {
        return RESPOSTA_GENERICA(destino);
      }
      if (pendente.reenvios >= MAX_REENVIOS) {
        throw new BadRequestException({
          code: "MUITOS_REENVIOS",
          message: "Você pediu o código muitas vezes. Comece o cadastro de novo.",
        });
      }

      // Reenviar custa igual: entra no mesmo teto.
      await this.exigirTetoDeGasto(maxPorHora);
      await this.enviarCodigo(telefone, pendente.codigo, null);
      await this.prisma.contaCadastroPendente.update({
        where: { telefone },
        data: { reenvios: { increment: 1 }, ultimoEnvioEm: new Date() },
      });
      return RESPOSTA_GENERICA(destino);
    });
  }

  /** O código voltou: a empresa nasce agora. */
  async confirmar(input: ConfirmarCadastroContaInput) {
    const telefone = SessaoService.normalizar(input.telefone);

    const pendente = await comoSistema(() =>
      this.prisma.contaCadastroPendente.findUnique({ where: { telefone } }),
    );
    if (!pendente) {
      throw new BadRequestException({
        code: "CADASTRO_NAO_ENCONTRADO",
        message: "Não achei esse cadastro. Comece de novo.",
      });
    }
    if (pendente.expiraEm < new Date()) {
      await this.descartar(telefone);
      throw new BadRequestException({
        code: "CODIGO_EXPIRADO",
        message: "O código venceu. Peça um novo.",
      });
    }
    if (pendente.tentativas >= MAX_TENTATIVAS) {
      await this.descartar(telefone);
      throw new BadRequestException({
        code: "MUITAS_TENTATIVAS",
        message: "Errou o código muitas vezes. Comece o cadastro de novo.",
      });
    }
    if (pendente.codigo !== input.codigo) {
      await comoSistema(() =>
        this.prisma.contaCadastroPendente.update({
          where: { telefone },
          data: { tentativas: { increment: 1 } },
        }),
      );
      throw new BadRequestException({ code: "CODIGO_INVALIDO", message: "Código errado." });
    }

    const { dias } = await this.configuracao();
    const conta = await this.contas.criar({
      trialExpiraEm: new Date(Date.now() + dias * 86_400_000),
      nome: pendente.empresa,
      cnpj: pendente.cnpj ?? undefined,
      adminNome: pendente.adminNome,
      adminEmail: pendente.adminEmail,
      adminSenha: "",
      senhaHashPronta: pendente.senhaHash,
      origemPublica: true,
    });

    await this.descartar(telefone);
    this.log.log(`Empresa criada por auto-cadastro: ${pendente.empresa} (${conta.id})`);
    this.avisarPlataforma(pendente.empresa, pendente.adminNome, telefone);

    return conta;
  }

  private descartar(telefone: string) {
    return comoSistema(() =>
      this.prisma.contaCadastroPendente.deleteMany({ where: { telefone } }),
    );
  }

  private async enviarCodigo(
    telefone: string,
    codigo: string,
    ip: string | null,
  ): Promise<void> {
    await this.envio.enviarOuFalhar({
      destino: { tipo: "TELEFONE", numero: telefone },
      rota: "OTP_CONTA",
      texto: `${NOME_PLATAFORMA}: seu código de cadastro é ${codigo}. Vale por ${TTL_MINUTOS} minutos.`,
      params: [codigo, String(TTL_MINUTOS)],
    });
    // Só depois de sair de verdade: envio que falhou não consumiu mensagem
    // paga, e não pode consumir o teto de quem vem depois.
    await comoSistema(() =>
      this.prisma.envioCodigoCadastro.create({ data: { telefone, ip } }),
    );
  }

  /**
   * Avisa a plataforma no sininho.
   *
   * Roda dentro da conta da CASA porque o fan-out do inbox entrega aos usuários
   * da conta do contexto — disparar sem isso avisaria a empresa recém-criada
   * sobre o próprio nascimento, e ninguém da Movatruck ficaria sabendo.
   *
   * Best-effort de propósito: a empresa já existe, e o cadastro não pode falhar
   * porque o aviso não saiu.
   */
  private avisarPlataforma(empresa: string, quem: string, telefone: string): void {
    void (async () => {
      const casa = await comoSistema(() =>
        this.prisma.conta.findFirst({ where: { ehPlataforma: true }, select: { id: true } }),
      );
      if (!casa) return;
      await comConta(casa.id, () =>
        this.inbox.disparar({
          tipo: "conta-auto-cadastro",
          titulo: `Nova empresa se cadastrou: ${empresa}`,
          corpo: `${quem} · ${telefone}`,
        }),
      );
    })().catch((e: unknown) => this.log.warn(`Aviso de auto-cadastro falhou: ${String(e)}`));
  }
}

function segundosDesde(quando: Date): number {
  return (Date.now() - quando.getTime()) / 1000;
}

/** "…-4523" — o suficiente pra conferir o número sem expor ele inteiro. */
function mascarar(telefone: string): string {
  const digitos = telefone.replace(/\D/g, "");
  return `…${digitos.slice(-4)}`;
}
