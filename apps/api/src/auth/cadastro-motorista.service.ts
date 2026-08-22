import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomInt } from "node:crypto";
import { formatCpf, type CadastroMotoristaInput, type PlacaInput,
  NOME_PLATAFORMA,
} from "@ronan/shared-types";
import { comConta, comoSistema, contaIdAtual } from "../common/conta/conta-context";
import { normalizarCodigoConvite } from "../admin/contas/codigo-convite";
import { PrismaService } from "../prisma/prisma.service";
import { AvisoGrupoService } from "../whatsapp/aviso-grupo.service";
import { EnvioWhatsappService } from "../whatsapp/envio/envio-whatsapp.service";
import { SessaoService } from "../whatsapp/sessao.service";
import { AdminInboxService } from "../admin/inbox/inbox.service";
import { AuthService } from "./auth.service";

const CODIGO_TTL_MIN = 10;
const MAX_TENTATIVAS = 5;
const REENVIO_COOLDOWN_S = 60;
const MAX_REENVIOS = 5;

type PrismaTx = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

/**
 * Auto-cadastro de motorista (pré-login) verificado por código no WhatsApp.
 *
 * Fluxo: iniciar (valida + checa duplicados + guarda pendente + manda código)
 * → confirmar (valida código → cria Motorista PENDENTE_APROVACAO → tokens).
 * O motorista nasce aguardando aprovação do admin; entra no app em modo
 * "em análise" até ser aprovado.
 */
@Injectable()
export class CadastroMotoristaService {
  private readonly log = new Logger(CadastroMotoristaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly envio: EnvioWhatsappService,
    private readonly avisoGrupo: AvisoGrupoService,
    private readonly inbox: AdminInboxService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Em qual empresa este cadastro entra — decidido pelo CÓDIGO que a empresa deu
   * ao motorista.
   *
   * O app publicado nas lojas é um só e não tem como adivinhar de quem é quem
   * baixou. Sem o código, cadastro nenhum entra: o risco de deixar cair numa
   * empresa "padrão" é o motorista do Alex aparecer na fila da Schaba, e alguém
   * ter que perceber.
   *
   * O código DIRECIONA, não autoriza: o motorista continua nascendo
   * PENDENTE_APROVACAO e quem decide é a empresa. Por isso um código que vaze não
   * é incidente — no máximo um cadastro pra recusar.
   */
  private async resolverConta(codigoBruto?: string): Promise<string> {
    const codigo = normalizarCodigoConvite(codigoBruto ?? "");
    if (!codigo) {
      throw new BadRequestException(
        "Digite o código da empresa pra quem você roda. Peça pra ela — é o mesmo código pra todos os motoristas.",
      );
    }

    const conta = await comoSistema(() =>
      this.prisma.conta.findFirst({
        where: { codigoConvite: codigo, ativa: true },
        select: { id: true },
      }),
    );
    if (!conta) {
      throw new BadRequestException(
        "Código não confere. Confira com a empresa se digitou certinho.",
      );
    }
    return conta.id;
  }

  async iniciar(data: CadastroMotoristaInput & { codigoEmpresa?: string }) {
    const contaId = await this.resolverConta(data.codigoEmpresa);
    return comConta(contaId, () => this.iniciarNaConta(data));
  }

  private async iniciarNaConta(data: CadastroMotoristaInput) {
    await this.checarDuplicados(data.cpf, data.telefone, data.email, data.placas);

    const senhaHash = await AuthService.hashPassword(data.senha);
    const codigo = gerarCodigo();
    const expiraEm = new Date(Date.now() + CODIGO_TTL_MIN * 60_000);
    const placas = montarPlacasJson(data.placas, data.placaDefault);

    // Upsert por CPF: reenviar o formulário (corrigindo algo) substitui o
    // pendente e zera tentativas/reenvios.
    await this.prisma.cadastroMotoristaPendente.upsert({
      // O CPF só é único DENTRO da conta: o mesmo motorista pode ter cadastro em
      // duas empresas, e são cadastros independentes.
      where: { contaId_cpf: { contaId: contaIdAtual(), cpf: data.cpf } },
      create: {
        cpf: data.cpf,
        nome: data.nome,
        telefone: data.telefone,
        email: data.email ?? null,
        senhaHash,
        placas,
        codigo,
        expiraEm,
      },
      update: {
        nome: data.nome,
        telefone: data.telefone,
        email: data.email ?? null,
        senhaHash,
        placas,
        codigo,
        expiraEm,
        tentativas: 0,
        reenvios: 0,
        ultimoEnvioEm: new Date(),
      },
    });

    await this.enviarCodigo(data.telefone, codigo);
    return { ok: true, expiraEmSegundos: CODIGO_TTL_MIN * 60 };
  }

  async reenviar(cpf: string, codigoEmpresa?: string) {
    const contaId = await this.resolverConta(codigoEmpresa);
    return comConta(contaId, () => this.reenviarNaConta(cpf));
  }

  private async reenviarNaConta(cpf: string) {
    const pendente = await this.prisma.cadastroMotoristaPendente.findFirst({ where: { cpf } });
    if (!pendente) {
      throw new NotFoundException("Nenhum cadastro pendente pra esse CPF. Comece o cadastro de novo.");
    }

    const desdeUltimo = (Date.now() - pendente.ultimoEnvioEm.getTime()) / 1000;
    if (desdeUltimo < REENVIO_COOLDOWN_S) {
      throw new BadRequestException(
        `Espere ${Math.ceil(REENVIO_COOLDOWN_S - desdeUltimo)}s pra pedir o código de novo.`,
      );
    }
    if (pendente.reenvios >= MAX_REENVIOS) {
      throw new BadRequestException(
        "Você já pediu o código várias vezes. Comece o cadastro de novo ou fale com a empresa.",
      );
    }

    const codigo = gerarCodigo();
    await this.prisma.cadastroMotoristaPendente.update({
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
    return { ok: true, expiraEmSegundos: CODIGO_TTL_MIN * 60 };
  }

  async confirmar(cpf: string, codigo: string, codigoEmpresa?: string) {
    const contaId = await this.resolverConta(codigoEmpresa);
    return comConta(contaId, () => this.confirmarNaConta(cpf, codigo));
  }

  private async confirmarNaConta(cpf: string, codigo: string) {
    const pendente = await this.prisma.cadastroMotoristaPendente.findFirst({ where: { cpf } });
    if (!pendente) {
      throw new NotFoundException("Nenhum cadastro pendente pra esse CPF. Comece o cadastro de novo.");
    }

    if (pendente.expiraEm < new Date()) {
      await this.prisma.cadastroMotoristaPendente.delete({ where: { id: pendente.id } });
      throw new BadRequestException("O código expirou. Comece o cadastro de novo.");
    }
    if (pendente.tentativas >= MAX_TENTATIVAS) {
      await this.prisma.cadastroMotoristaPendente.delete({ where: { id: pendente.id } });
      throw new BadRequestException("Muitas tentativas erradas. Comece o cadastro de novo.");
    }
    if (pendente.codigo !== codigo) {
      await this.prisma.cadastroMotoristaPendente.update({
        where: { id: pendente.id },
        data: { tentativas: { increment: 1 } },
      });
      throw new BadRequestException("Código incorreto. Confira e tente de novo.");
    }

    const placas = pendente.placas as PlacaJson[];
    const placaInputs: PlacaInput[] = placas.map((p) => ({ placa: p.placa, modelo: p.modelo }));
    const placaDefault = placas.find((p) => p.default)?.placa ?? null;

    // Já tem cadastro em outra empresa? Então ele já tem senha, e a senha é da
    // PESSOA (ver AuthService.propagarSenha): herda o hash e ignora a que ele
    // digitou aqui, senão ficaria com duas senhas pro mesmo CPF e uma delas
    // pararia de funcionar na primeira troca. O app avisa na tela de conclusão.
    const senhaHash = (await this.senhaExistenteDoCpf(pendente.cpf)) ?? pendente.senhaHash;
    const senhaHerdada = senhaHash !== pendente.senhaHash;

    const motoristaId = await this.prisma.$transaction(async (tx) => {
      // Re-checa duplicados dentro da transação (corrida entre iniciar e confirmar).
      await this.checarDuplicados(
        pendente.cpf,
        pendente.telefone,
        pendente.email,
        placaInputs,
        tx,
      );

      const motorista = await tx.motorista.create({
        data: {
          nome: pendente.nome,
          cpf: pendente.cpf,
          senhaHash,
          telefone: pendente.telefone,
          email: pendente.email,
          status: "PENDENTE_APROVACAO",
        },
      });
      const resolvidos = await upsertPlacas(tx, placaInputs);
      if (resolvidos.length > 0) {
        await tx.motoristaVeiculo.createMany({
          data: resolvidos.map((v) => ({ motoristaId: motorista.id, veiculoId: v.id })),
          skipDuplicates: true,
        });
      }
      const veiculoDefaultId = resolverDefault(placaDefault, resolvidos);
      if (veiculoDefaultId) {
        await tx.motorista.update({
          where: { id: motorista.id },
          data: { veiculoDefaultId },
        });
      }
      await tx.cadastroMotoristaPendente.delete({ where: { id: pendente.id } });
      return motorista.id;
    });

    // Avisa os admins no sininho do dashboard (best-effort — nunca derruba o
    // cadastro). Clicar leva pra lista filtrada em Pendentes.
    try {
      await this.inbox.disparar({
        tipo: "motorista-cadastro",
        titulo: "Novo cadastro de motorista",
        corpo: `${pendente.nome} (CPF ${formatCpf(pendente.cpf)}) se cadastrou e aguarda aprovação.`,
        dados: { motoristaId },
      });
    } catch (e) {
      this.log.warn(`Falha ao notificar admins do cadastro: ${(e as Error).message}`);
    }

    // Se ele já está no grupo de WhatsApp da operação, posta um "fulano entrou
    // no app" lá (prova social). Best-effort e com trava de envio único dentro.
    void this.avisoGrupo.anunciarCadastro(motoristaId);

    const tokens = await this.auth.issueMotoristaTokens(motoristaId);
    return { ...tokens, status: "PENDENTE_APROVACAO" as const, senhaHerdada };
  }

  /**
   * O hash de senha que este CPF já tem em outra empresa, se tiver.
   *
   * Atravessa contas de propósito e é o ÚNICO lugar do cadastro que faz isso —
   * mas não vaza nada: o hash não sai da API, e a empresa nova nunca fica
   * sabendo em qual outra ele roda. Ver AuthService.propagarSenha.
   */
  private async senhaExistenteDoCpf(cpf: string): Promise<string | null> {
    const existente = await comoSistema(() =>
      this.prisma.motorista.findFirst({
        where: { cpf, ativo: true },
        select: { senhaHash: true },
        orderBy: { criadoEm: "desc" },
      }),
    );
    return existente?.senhaHash ?? null;
  }

  /**
   * Bloqueia se CPF/celular/email/placa já existirem. CPF sempre; celular e
   * email (se informado) batem contra Motorista; cada placa contra Veiculo.
   */
  private async checarDuplicados(
    cpf: string,
    telefone: string,
    email: string | null | undefined,
    placas: PlacaInput[],
    tx?: PrismaTx,
  ) {
    const db = tx ?? this.prisma;

    const porCpf = await db.motorista.findFirst({ where: { cpf }, select: { id: true } });
    if (porCpf) {
      throw new ConflictException({
        code: "CPF_JA_CADASTRADO",
        message: 'Esse CPF já tem cadastro. Se esqueceu a senha, use a opção "Esqueci minha senha".',
      });
    }

    const porTelefone = await db.motorista.findFirst({
      where: { telefone },
      select: { id: true },
    });
    if (porTelefone) throw new ConflictException("Esse celular já está em uso por outro cadastro.");

    if (email) {
      const porEmail = await db.motorista.findFirst({ where: { email }, select: { id: true } });
      if (porEmail) throw new ConflictException("Esse email já está em uso por outro cadastro.");
    }

    for (const p of placas) {
      const veiculo = await db.veiculo.findFirst({
        where: { placa: p.placa },
        select: {
          _count: { select: { motoristas: true } },
          motoristasComoDefault: { select: { id: true }, take: 1 },
        },
      });
      // Só barra se a placa estiver COM algum motorista. Placa que não existe,
      // ou que existe mas ninguém tem (o admin desvinculou e o veículo ficou
      // preservado por causa do histórico de viagens), é livre — upsertPlacas
      // reaproveita o veículo e as viagens antigas seguem com quem as rodou.
      if (!veiculo) continue;
      const emUso = veiculo._count.motoristas > 0 || veiculo.motoristasComoDefault.length > 0;
      if (emUso) {
        throw new ConflictException({
          code: "PLACA_EM_USO",
          message: `A placa ${p.placa} já está cadastrada em outro cadastro. Se você trocou de placa, fale com o pessoal do administrativo pra atualizar.`,
        });
      }
    }
  }

  private async enviarCodigo(telefone: string, codigo: string) {
    // O WhatsApp exige número internacional (DDI 55). O telefone do cadastro vem
    // só com DDD (ex: 41999998888) — sem normalizar, dá 400 no envio.
    const numero = SessaoService.normalizar(telefone);
    // Quem assina o código é a PLATAFORMA, não a transportadora — decisão do
    // dono em 22/08/2026. Na Meta o corpo é fixo e nem carrega nome nenhum;
    // isto vale pro texto do histórico e pro dia em que houver texto livre.
    await this.envio.enviarOuFalhar({
      destino: { tipo: "TELEFONE", numero },
      rota: "OTP_CADASTRO",
      texto: `Seu código de cadastro ${NOME_PLATAFORMA} é ${codigo}. Vale por ${CODIGO_TTL_MIN} minutos. Se não foi você, ignore.`,
      params: [NOME_PLATAFORMA, codigo, String(CODIGO_TTL_MIN)],
    });
  }
}

type PlacaJson = { placa: string; modelo?: string; default?: boolean };

function montarPlacasJson(placas: PlacaInput[], placaDefault?: string | null): PlacaJson[] {
  // Se só tem uma placa, ela é a default por padrão.
  const def = placaDefault ?? (placas.length === 1 ? placas[0]!.placa : null);
  return placas.map((p) => ({
    placa: p.placa,
    ...(p.modelo ? { modelo: p.modelo } : {}),
    default: p.placa === def,
  }));
}

function gerarCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Upsert de placas → veículos (espelha MotoristasService.upsertPlacas). O
 * auto-cadastro chega aqui depois de checarDuplicados garantir que nenhuma
 * placa está com outro motorista — mas o veículo pode existir e estar livre
 * (desvinculado pelo admin e preservado pelo histórico), e nesse caso a gente
 * reaproveita ele em vez de criar outro.
 */
async function upsertPlacas(
  tx: PrismaTx,
  placas: PlacaInput[],
): Promise<{ id: string; placa: string }[]> {
  const resolvidos: { id: string; placa: string }[] = [];
  for (const p of placas) {
    const existente = await tx.veiculo.findFirst({ where: { placa: p.placa } });
    if (existente) {
      // Veículo que estava inativo volta a rodar — senão ele fica de fora dos
      // selects e relatórios do painel apesar de ter motorista. O modelo não é
      // sobrescrito: o que o admin cadastrou vale mais.
      if (!existente.ativo) {
        await tx.veiculo.update({ where: { id: existente.id }, data: { ativo: true } });
      }
      resolvidos.push({ id: existente.id, placa: existente.placa });
    } else {
      const novo = await tx.veiculo.create({ data: { placa: p.placa, modelo: p.modelo } });
      resolvidos.push({ id: novo.id, placa: novo.placa });
    }
  }
  return resolvidos;
}

function resolverDefault(
  placaDefault: string | null,
  veiculos: { id: string; placa: string }[],
): string | null {
  if (placaDefault == null) return veiculos.length === 1 ? veiculos[0]!.id : null;
  return veiculos.find((v) => v.placa === placaDefault)?.id ?? null;
}
