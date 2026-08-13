import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomInt } from "node:crypto";
import { formatCpf, telefoneDigits } from "@ronan/shared-types";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { EvolutionClientService } from "../whatsapp/evolution-client.service";
import { SessaoService } from "../whatsapp/sessao.service";
import { AdminInboxService } from "../admin/inbox/inbox.service";
import { AvisoGrupoService } from "../whatsapp/aviso-grupo.service";
import { AuthService } from "./auth.service";

const CODIGO_TTL_MIN = 10;
const MAX_TENTATIVAS = 5;
const REENVIO_COOLDOWN_S = 60;
const MAX_REENVIOS = 5;

// Resposta genérica do passo "esqueci": nunca revela se o CPF existe, se está
// ativo, nem se o celular bate — evita enumeração de cadastros.
const RESPOSTA_GENERICA = { ok: true as const, expiraEmSegundos: CODIGO_TTL_MIN * 60 };

/**
 * Recuperação de senha do motorista ("esqueci minha senha") verificada por
 * código no WhatsApp.
 *
 * Fluxo: esqueci (CPF + celular → manda código pro número de destino) →
 * redefinir (código + nova senha → troca a senha e loga). O código vai SEMPRE
 * pro número que o backend decide:
 *  - Se o CPF já tem celular cadastrado, o digitado precisa ser o MESMO e o
 *    código vai pro cadastrado (impede sequestro digitando outro número).
 *  - Se o CPF não tem celular, o digitado é usado como destino e GRAVADO no
 *    cadastro só após a confirmação — desde que não pertença a outro CPF.
 */
@Injectable()
export class RedefinicaoSenhaService {
  private readonly log = new Logger(RedefinicaoSenhaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionClientService,
    private readonly inbox: AdminInboxService,
    private readonly auth: AuthService,
    private readonly avisoGrupo: AvisoGrupoService,
  ) {}

  /**
   * De qual empresa é o CPF. Roda sem conta no contexto porque é rota pública
   * (o motorista esqueceu a senha e não está logado) — achar o cadastro é o que
   * revela a empresa. Quase sempre há um só; havendo o mesmo CPF em duas
   * empresas, o telefone desempata, e sem desempate vale o mais recente, que é
   * o cadastro que ele está usando.
   */
  private async resolverConta(cpf: string, telefone?: string): Promise<string | null> {
    const candidatos = await comoSistema(() =>
      this.prisma.motorista.findMany({
        where: { cpf },
        select: { contaId: true, telefone: true, criadoEm: true },
        orderBy: { criadoEm: "desc" },
      }),
    );
    if (candidatos.length === 0) return null;
    if (candidatos.length === 1) return candidatos[0]!.contaId;
    const porTelefone = telefone
      ? candidatos.find((c) => telefoneDigits(c.telefone ?? "") === telefoneDigits(telefone))
      : undefined;
    return (porTelefone ?? candidatos[0]!).contaId;
  }

  async esqueci(cpf: string, telefoneInput: string) {
    const contaId = await this.resolverConta(cpf, telefoneInput);
    // CPF sem cadastro nenhum: o fluxo abaixo já trata (mensagem clara pro app
    // oferecer o cadastro), então roda numa conta qualquer só pra ter contexto.
    if (!contaId) return comoSistema(() => this.esqueciNaConta(cpf, telefoneInput));
    return comConta(contaId, () => this.esqueciNaConta(cpf, telefoneInput));
  }

  private async esqueciNaConta(cpf: string, telefoneInput: string) {
    const telefone = telefoneDigits(telefoneInput);
    const motorista = await this.prisma.motorista.findFirst({
      where: { cpf },
      select: { id: true, telefone: true, ativo: true, status: true },
    });

    // Escolha do produto: preferimos clareza pro motorista (público leigo, base
    // pequena e fechada) a proteção contra enumeração. CPF que não existe recebe
    // mensagem clara + código pro app oferecer o cadastro; conta inativa/recusada
    // é orientada ao administrativo.
    if (!motorista) {
      throw new NotFoundException({
        code: "CPF_NAO_CADASTRADO",
        message: "Não encontramos esse CPF no sistema. Confira o número ou faça seu cadastro.",
      });
    }
    if (!motorista.ativo || motorista.status === "REJEITADO") {
      throw new BadRequestException({
        code: "CADASTRO_INATIVO",
        message: "Seu cadastro não está ativo. Fale com o pessoal do administrativo.",
      });
    }

    let destino: string;
    let vincular: boolean;
    if (motorista.telefone) {
      // Já tem celular: o digitado TEM que ser o mesmo. Avisa explicitamente se
      // não bater (escolha do produto por clareza — assume revelar que o CPF é
      // cliente). Mesmo avisando, não dá pra tomar a conta: o código só vai pro
      // número cadastrado, nunca pro digitado.
      if (telefoneDigits(motorista.telefone) !== telefone) {
        throw new BadRequestException({
          code: "CELULAR_DIVERGENTE",
          message:
            "O celular informado não confere com o cadastrado pra esse CPF. Se você trocou de número, fale com o pessoal do administrativo pra atualizar seu cadastro.",
        });
      }
      destino = motorista.telefone;
      vincular = false;
    } else {
      // Sem celular cadastrado: vincula o digitado, desde que não seja de outro
      // CPF. Aqui o erro é explícito (acionável pelo motorista).
      await this.checarTelefoneLivre(telefone, motorista.id);
      destino = telefone;
      vincular = true;
    }

    // Anti-spam: se já existe pedido recente, não reenvia (evita inundar o
    // WhatsApp de quem souber CPF + celular). O reenvio fica pelo botão dedicado.
    const existente = await this.prisma.redefinicaoSenhaPendente.findUnique({
      where: { motoristaId: motorista.id },
      select: { ultimoEnvioEm: true },
    });
    if (
      existente &&
      (Date.now() - existente.ultimoEnvioEm.getTime()) / 1000 < REENVIO_COOLDOWN_S
    ) {
      return RESPOSTA_GENERICA;
    }

    const codigo = gerarCodigo();
    const expiraEm = new Date(Date.now() + CODIGO_TTL_MIN * 60_000);
    // Envia ANTES de gravar o pendente: se o WhatsApp falhar, `enviarCodigo`
    // lança e não persistimos nada (nem o cooldown). Assim o motorista pode
    // tentar de novo na hora e nunca vê "código enviado" sem o código ter saído.
    await this.enviarCodigo(destino, codigo);
    await this.prisma.redefinicaoSenhaPendente.upsert({
      where: { motoristaId: motorista.id },
      create: { motoristaId: motorista.id, telefone: destino, vincular, codigo, expiraEm },
      update: {
        telefone: destino,
        vincular,
        codigo,
        expiraEm,
        tentativas: 0,
        reenvios: 0,
        ultimoEnvioEm: new Date(),
      },
    });
    return RESPOSTA_GENERICA;
  }

  async reenviar(cpf: string) {
    const contaId = await this.resolverConta(cpf);
    if (!contaId) throw new BadRequestException("Nenhum pedido de redefinição pra esse CPF. Comece de novo.");
    return comConta(contaId, () => this.reenviarNaConta(cpf));
  }

  private async reenviarNaConta(cpf: string) {
    const pendente = await this.buscarPendente(cpf);
    if (!pendente) {
      throw new BadRequestException(
        "Nenhum pedido de redefinição pra esse CPF. Comece de novo.",
      );
    }

    const desdeUltimo = (Date.now() - pendente.ultimoEnvioEm.getTime()) / 1000;
    if (desdeUltimo < REENVIO_COOLDOWN_S) {
      throw new BadRequestException(
        `Espere ${Math.ceil(REENVIO_COOLDOWN_S - desdeUltimo)}s pra pedir o código de novo.`,
      );
    }
    if (pendente.reenvios >= MAX_REENVIOS) {
      throw new BadRequestException(
        "Você já pediu o código várias vezes. Comece de novo ou fale com a empresa.",
      );
    }

    const codigo = gerarCodigo();
    await this.prisma.redefinicaoSenhaPendente.update({
      where: { id: pendente.id },
      data: {
        codigo,
        expiraEm: new Date(Date.now() + CODIGO_TTL_MIN * 60_000),
        tentativas: 0,
        reenvios: { increment: 1 },
        ultimoEnvioEm: new Date(),
      },
    });
    await this.enviarCodigo(pendente.telefone, codigo);
    return RESPOSTA_GENERICA;
  }

  async redefinir(cpf: string, codigo: string, novaSenha: string) {
    const contaId = await this.resolverConta(cpf);
    if (!contaId) throw new BadRequestException("Não foi possível redefinir. Comece de novo.");
    return comConta(contaId, () => this.redefinirNaConta(cpf, codigo, novaSenha));
  }

  private async redefinirNaConta(cpf: string, codigo: string, novaSenha: string) {
    const pendente = await this.buscarPendente(cpf);
    if (!pendente) {
      throw new BadRequestException("Não foi possível redefinir. Comece de novo.");
    }

    if (pendente.expiraEm < new Date()) {
      await this.prisma.redefinicaoSenhaPendente.delete({ where: { id: pendente.id } });
      throw new BadRequestException("O código expirou. Peça um novo.");
    }
    if (pendente.tentativas >= MAX_TENTATIVAS) {
      await this.prisma.redefinicaoSenhaPendente.delete({ where: { id: pendente.id } });
      throw new BadRequestException("Muitas tentativas erradas. Comece de novo.");
    }
    if (pendente.codigo !== codigo) {
      await this.prisma.redefinicaoSenhaPendente.update({
        where: { id: pendente.id },
        data: { tentativas: { increment: 1 } },
      });
      throw new BadRequestException("Código incorreto. Confira e tente de novo.");
    }

    const senhaHash = await AuthService.hashPassword(novaSenha);
    await this.prisma.$transaction(async (tx) => {
      // Vincular número: re-checa que não virou de outro CPF entre o esqueci e
      // agora (corrida) antes de gravar.
      if (pendente.vincular) {
        const emUso = await tx.motorista.findFirst({
          where: { telefone: pendente.telefone, id: { not: pendente.motoristaId } },
          select: { id: true },
        });
        if (emUso) {
          throw new ConflictException(
            "Esse celular passou a ser usado por outro cadastro. Fale com a empresa.",
          );
        }
      }
      await tx.motorista.update({
        where: { id: pendente.motoristaId },
        data: {
          senhaHash,
          tentativasLogin: 0,
          bloqueadoAte: null,
          ...(pendente.vincular ? { telefone: pendente.telefone } : {}),
        },
      });
      await tx.redefinicaoSenhaPendente.delete({ where: { id: pendente.id } });
    });

    // Avisa os admins quando um número novo é vinculado por reset (visibilidade
    // de segurança). Best-effort — nunca derruba a redefinição.
    if (pendente.vincular) {
      try {
        const m = await this.prisma.motorista.findUnique({
          where: { id: pendente.motoristaId },
          select: { nome: true },
        });
        await this.inbox.disparar({
          tipo: "motorista-senha-reset",
          titulo: "Celular vinculado por redefinição de senha",
          corpo: `${m?.nome ?? "Motorista"} (CPF ${formatCpf(cpf)}) redefiniu a senha e vinculou um novo celular.`,
          dados: { motoristaId: pendente.motoristaId },
        });
      } catch (e) {
        this.log.warn(`Falha ao notificar admins da vinculação: ${(e as Error).message}`);
      }
    }

    const motorista = await this.prisma.motorista.findUniqueOrThrow({
      where: { id: pendente.motoristaId },
      select: { status: true, ultimoLoginEm: true },
    });
    // Reset emite token direto (não passa pelo loginMotorista). Se ele nunca
    // acessou (ex: criado pelo admin, recupera senha pra entrar a 1ª vez),
    // anuncia no grupo. Best-effort e idempotente (trava avisoGrupoEnviadoEm).
    if (motorista.ultimoLoginEm === null) {
      void this.avisoGrupo.anunciarCadastro(pendente.motoristaId);
    }
    const tokens = await this.auth.issueMotoristaTokens(pendente.motoristaId);
    return { ...tokens, status: motorista.status };
  }

  /** Resolve o pendente a partir do CPF (1 pendente por motorista). */
  private async buscarPendente(cpf: string) {
    const motorista = await this.prisma.motorista.findFirst({
      where: { cpf },
      select: { id: true },
    });
    if (!motorista) return null;
    return this.prisma.redefinicaoSenhaPendente.findUnique({
      where: { motoristaId: motorista.id },
    });
  }

  private async checarTelefoneLivre(telefone: string, motoristaId: string) {
    const emUso = await this.prisma.motorista.findFirst({
      where: { telefone, id: { not: motoristaId } },
      select: { id: true },
    });
    if (emUso) {
      throw new ConflictException(
        "Esse celular já está em uso por outro cadastro. Fale com a empresa.",
      );
    }
  }

  private async enviarCodigo(telefone: string, codigo: string) {
    const numero = SessaoService.normalizar(telefone);
    await this.evolution.enviarTexto(
      numero,
      `Seu código pra redefinir a senha Schaba é ${codigo}. Vale por ${CODIGO_TTL_MIN} minutos. Se não foi você, ignore.`,
    );
  }
}

function gerarCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
