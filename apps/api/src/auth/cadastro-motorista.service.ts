import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomInt } from "node:crypto";
import type { CadastroMotoristaInput, PlacaInput, SessaoEmpresa } from "@ronan/shared-types";
import { NOME_PLATAFORMA, formatCpf } from "@ronan/shared-types";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { normalizarCodigoConvite } from "../admin/contas/codigo-convite";
import { lerPlacasJson, vincularPlacas } from "../common/placas";
import { VINCULO_VIVO } from "../common/vinculo";
import { PrismaService } from "../prisma/prisma.service";
import { AvisoGrupoService } from "../whatsapp/aviso-grupo.service";
import { EnvioWhatsappService } from "../whatsapp/envio/envio-whatsapp.service";
import { SessaoService } from "../whatsapp/sessao.service";
import { AdminInboxService } from "../admin/inbox/inbox.service";
import { AuthService } from "./auth.service";
import { IdentidadeService } from "./identidade.service";

const CODIGO_TTL_MIN = 10;
const MAX_TENTATIVAS = 5;
const REENVIO_COOLDOWN_S = 60;
const MAX_REENVIOS = 5;

/**
 * Cadastro do motorista pelo app (pré-login), verificado por código no WhatsApp.
 *
 * Fluxo: iniciar (valida + guarda pendente + manda código) → confirmar (valida
 * código → cria a PESSOA → tokens).
 *
 * Ele não diz mais de qual empresa é. Até 09/2026 o formulário exigia o código
 * da transportadora, porque o cadastro nascia dentro de uma conta e não havia
 * onde escrevê-lo sem ela; agora o cadastro cria uma identidade, que existe
 * sozinha, e entrar numa empresa é um segundo momento — sempre por convite
 * dela. Ver docs/identidade-motorista.md.
 *
 * O caso interessante é o inverso: o CPF já ter cadastro criado pelo painel e
 * nunca ter entrado no app. Aí o cadastro não é recusado — ele REIVINDICA o que
 * já está lá, e a prova de que é ele é o código ir pro número que a empresa tem
 * em ficha, não pro que ele digitou.
 */
@Injectable()
export class CadastroMotoristaService {
  private readonly log = new Logger(CadastroMotoristaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly envio: EnvioWhatsappService,
    private readonly avisoGrupo: AvisoGrupoService,
    private readonly auth: AuthService,
    private readonly identidades: IdentidadeService,
    private readonly inbox: AdminInboxService,
  ) {}

  /**
   * A empresa que o código do formulário aponta — só pro app ANTIGO.
   *
   * A versão nova não manda código nenhum: entrar numa empresa virou convite
   * dela. Este caminho existe pra que quem ainda está na versão anterior
   * continue se cadastrando e caindo na empresa certa, como sempre caiu. Código
   * inválido não derruba o cadastro: ele vira uma pessoa sem empresa, que é o
   * comportamento novo, em vez de um erro que não leva a lugar nenhum.
   */
  private async contaDoCodigoLegado(codigoBruto?: string): Promise<string | null> {
    const codigo = normalizarCodigoConvite(codigoBruto ?? "");
    if (!codigo) return null;
    const conta = await comoSistema(() =>
      this.prisma.conta.findFirst({
        where: { codigoConvite: codigo, ativa: true },
        select: { id: true },
      }),
    );
    return conta?.id ?? null;
  }

  async iniciar(data: CadastroMotoristaInput) {
    // `garantirPorCpf` cobre também o cadastro anterior à separação
    // pessoa/vínculo, criando a identidade dele a partir do que a empresa tinha.
    const existente = await this.identidades.garantirPorCpf(data.cpf);

    if (existente?.ultimoLoginEm) {
      // Já usa o app: isso é login, não cadastro.
      throw new ConflictException({
        code: "CPF_JA_CADASTRADO",
        message:
          'Esse CPF já tem cadastro. Entre com sua senha — ou use "Esqueci minha senha" se não lembrar.',
      });
    }

    let destino = data.telefone;

    if (existente) {
      // REIVINDICAÇÃO: a empresa cadastrou ele antes dele baixar o app, e ele
      // nunca entrou. Em vez de recusar ("já existe") e mandar pro "esqueci a
      // senha" pra descobrir uma senha que ele nunca teve, o cadastro assume o
      // que já está lá — e a senha que ele acabou de escolher passa a valer.
      //
      // A prova de que é ele: o código vai pro número que a EMPRESA tem em
      // ficha, mostrado mascarado na tela. Sem essa regra, qualquer um que saiba
      // um CPF assumiria o cadastro alheio digitando o próprio celular.
      if (!existente.telefone) {
        throw new ConflictException({
          code: "CADASTRO_SEM_CELULAR",
          message:
            "Você já tem cadastro numa empresa, mas sem celular anotado — sem ele não dá pra confirmar que é você. Peça pro administrativo cadastrar seu número.",
        });
      }
      destino = existente.telefone;
    } else {
      await this.checarContatoLivre(data.cpf, data.telefone, data.email);
    }

    const contaConvite = existente ? null : await this.contaDoCodigoLegado(data.codigoEmpresa);
    const senhaHash = await AuthService.hashPassword(data.senha);
    const codigo = gerarCodigo();
    const expiraEm = new Date(Date.now() + CODIGO_TTL_MIN * 60_000);

    // Upsert por CPF: reenviar o formulário (corrigindo algo) substitui o
    // pendente e zera tentativas/reenvios.
    await comoSistema(() =>
      this.prisma.cadastroMotoristaPendente.upsert({
        where: { cpf: data.cpf },
        create: {
          cpf: data.cpf,
          nome: data.nome,
          telefone: data.telefone,
          telefoneDestino: destino === data.telefone ? null : destino,
          contaConvite,
          email: data.email ?? null,
          senhaHash,
          placas: montarPlacasJson(data.placas, data.placaDefault),
          codigo,
          expiraEm,
        },
        update: {
          nome: data.nome,
          telefone: data.telefone,
          telefoneDestino: destino === data.telefone ? null : destino,
          contaConvite,
          email: data.email ?? null,
          senhaHash,
          placas: montarPlacasJson(data.placas, data.placaDefault),
          codigo,
          expiraEm,
          tentativas: 0,
          reenvios: 0,
          ultimoEnvioEm: new Date(),
        },
      }),
    );

    await this.enviarCodigo(destino, codigo);
    return {
      ok: true,
      expiraEmSegundos: CODIGO_TTL_MIN * 60,
      // O app precisa dizer PRA ONDE o código foi quando não foi pro número
      // digitado, senão o motorista fica esperando um WhatsApp que não vem.
      reivindicacao: existente != null,
      destinoMascarado: mascararCelular(destino),
    };
  }

  async reenviar(cpf: string) {
    const pendente = await comoSistema(() =>
      this.prisma.cadastroMotoristaPendente.findUnique({ where: { cpf } }),
    );
    if (!pendente) {
      throw new NotFoundException(
        "Nenhum cadastro pendente pra esse CPF. Comece o cadastro de novo.",
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
        "Você já pediu o código várias vezes. Comece o cadastro de novo ou fale com a empresa.",
      );
    }

    const codigo = gerarCodigo();
    await comoSistema(() =>
      this.prisma.cadastroMotoristaPendente.update({
        where: { id: pendente.id },
        data: {
          codigo,
          expiraEm: new Date(Date.now() + CODIGO_TTL_MIN * 60_000),
          tentativas: 0,
          reenvios: { increment: 1 },
          ultimoEnvioEm: new Date(),
        },
      }),
    );
    const destino = pendente.telefoneDestino ?? pendente.telefone;
    await this.enviarCodigo(destino, codigo);
    return {
      ok: true,
      expiraEmSegundos: CODIGO_TTL_MIN * 60,
      destinoMascarado: mascararCelular(destino),
    };
  }

  async confirmar(cpf: string, codigo: string) {
    const pendente = await comoSistema(() =>
      this.prisma.cadastroMotoristaPendente.findUnique({ where: { cpf } }),
    );
    if (!pendente) {
      throw new NotFoundException(
        "Nenhum cadastro pendente pra esse CPF. Comece o cadastro de novo.",
      );
    }

    if (pendente.expiraEm < new Date()) {
      await comoSistema(() =>
        this.prisma.cadastroMotoristaPendente.delete({ where: { id: pendente.id } }),
      );
      throw new BadRequestException("O código expirou. Comece o cadastro de novo.");
    }
    if (pendente.tentativas >= MAX_TENTATIVAS) {
      await comoSistema(() =>
        this.prisma.cadastroMotoristaPendente.delete({ where: { id: pendente.id } }),
      );
      throw new BadRequestException("Muitas tentativas erradas. Comece o cadastro de novo.");
    }
    if (pendente.codigo !== codigo) {
      await comoSistema(() =>
        this.prisma.cadastroMotoristaPendente.update({
          where: { id: pendente.id },
          data: { tentativas: { increment: 1 } },
        }),
      );
      throw new BadRequestException("Código incorreto. Confira e tente de novo.");
    }

    const jaExiste = await this.identidades.porCpf(cpf);
    if (jaExiste?.ultimoLoginEm) {
      // Corrida entre iniciar e confirmar: ele entrou no app nesse meio tempo.
      await comoSistema(() =>
        this.prisma.cadastroMotoristaPendente.delete({ where: { id: pendente.id } }),
      );
      throw new ConflictException({
        code: "CPF_JA_CADASTRADO",
        message: "Esse CPF já tem cadastro. Entre com sua senha.",
      });
    }

    const identidade = jaExiste
      ? // Reivindicação: o cadastro que a empresa criou passa a ser dele. A senha
        // que ELE escolheu vale daqui pra frente — quem é dono do cadastro é
        // ele, não a senha inicial que o painel digitou por ele. O celular vira
        // o que ele informou (é o dele); o NOME não é sobrescrito, nem aqui nem
        // no vínculo: é por ele que a empresa reconhece o motorista.
        await comoSistema(() =>
          this.prisma.motoristaIdentidade.update({
            where: { id: jaExiste.id },
            data: {
              telefone: pendente.telefone,
              email: pendente.email ?? jaExiste.email,
              senhaHash: pendente.senhaHash,
              tentativasLogin: 0,
              bloqueadoAte: null,
              ...(pendente.placas ? { placas: pendente.placas } : {}),
            },
          }),
        )
      : await this.identidades.criar({
          cpf: pendente.cpf,
          nome: pendente.nome,
          telefone: pendente.telefone,
          email: pendente.email,
          senhaHash: pendente.senhaHash,
          // `placas` é NOT NULL na tabela do pendente, mas o tipo do Prisma
          // admite null em JSON — o `??` é só pra fazer os dois concordarem.
          placas: pendente.placas ?? [],
        });

    if (jaExiste) {
      await AuthService.propagarSenha(this.prisma, cpf, pendente.senhaHash);
      this.log.log(`CPF ${cpf} reivindicou o cadastro que a empresa tinha criado.`);
    }

    // App antigo: ele digitou o código da empresa e espera sair daqui já dentro
    // dela, com token. Cria o vínculo como sempre criou — aguardando aprovação
    // do admin, que é o que a tela dele sabe mostrar.
    if (pendente.contaConvite) {
      await this.criarVinculoLegado(pendente.contaConvite, identidade.id, pendente);
    }

    await comoSistema(() =>
      this.prisma.cadastroMotoristaPendente.delete({ where: { id: pendente.id } }),
    );

    const vinculos = await comoSistema(() =>
      this.prisma.motorista.findMany({
        where: { identidadeId: identidade.id, ...VINCULO_VIVO },
        orderBy: { criadoEm: "desc" },
      }),
    );
    const cadastros: SessaoEmpresa[] = [];
    for (const v of vinculos) {
      cadastros.push(await this.auth.abrirSessao(v));
      // Se ele já está no grupo de WhatsApp da operação, posta um "fulano entrou
      // no app" lá (prova social). Best-effort, com trava de envio único dentro.
      void this.avisoGrupo.anunciarCadastro(v.id);
    }

    const principal = cadastros[0];
    return {
      accessToken: principal?.accessToken,
      refreshToken: principal?.refreshToken,
      status: principal?.status,
      cadastros,
      identidade: await this.auth.issueIdentidadeTokens(identidade.id),
    };
  }

  /**
   * O cadastro na empresa que o código apontou (só app antigo).
   *
   * Nasce PENDENTE_APROVACAO, como sempre nasceu: quem decide continua sendo a
   * empresa. `aceite` já é ACEITO — foi ele que pediu pra entrar.
   */
  private async criarVinculoLegado(
    contaId: string,
    identidadeId: string,
    dados: { cpf: string; nome: string; telefone: string; email: string | null; senhaHash: string; placas: unknown },
  ): Promise<void> {
    await comConta(contaId, async () => {
      // Alguém já cadastrou esse CPF nesta empresa no meio do caminho.
      const jaTem = await this.prisma.motorista.findFirst({ where: { cpf: dados.cpf } });
      if (jaTem) return;
      const motorista = await this.prisma.motorista.create({
        data: {
          identidadeId,
          nome: dados.nome,
          cpf: dados.cpf,
          telefone: dados.telefone,
          email: dados.email,
          senhaHash: dados.senhaHash,
          status: "PENDENTE_APROVACAO",
        },
      });
      const { placas, placaDefault } = lerPlacasJson(dados.placas);
      await this.prisma.$transaction((tx) => vincularPlacas(tx, motorista.id, placas, placaDefault));
      // Avisa os admins no sininho do painel — é um cadastro esperando
      // aprovação, e ninguém aprova o que não vê. Best-effort.
      try {
        await this.inbox.disparar({
          tipo: "motorista-cadastro",
          titulo: "Novo cadastro de motorista",
          corpo: `${dados.nome} (CPF ${formatCpf(dados.cpf)}) se cadastrou e aguarda aprovação.`,
          dados: { motoristaId: motorista.id },
        });
      } catch (e) {
        this.log.warn(`Falha ao notificar admins do cadastro: ${(e as Error).message}`);
      }
    });
  }

  /**
   * Celular e e-mail não podem ser de OUTRA pessoa.
   *
   * A checagem é contra as identidades, não contra os cadastros: sem empresa no
   * contexto não há como (nem por que) olhar os vínculos, e o telefone repetido
   * dentro de uma mesma empresa continua sendo assunto do painel. Placa também
   * não é checada aqui — `Veiculo` é da empresa, e no cadastro ainda não há
   * empresa; a conferência acontece quando o vínculo é criado.
   */
  private async checarContatoLivre(cpf: string, telefone: string, email?: string | null) {
    const porTelefone = await comoSistema(() =>
      this.prisma.motoristaIdentidade.findFirst({
        where: { telefone, cpf: { not: cpf } },
        select: { id: true },
      }),
    );
    if (porTelefone) throw new ConflictException("Esse celular já está em uso por outro cadastro.");

    if (email) {
      const porEmail = await comoSistema(() =>
        this.prisma.motoristaIdentidade.findFirst({
          where: { email, cpf: { not: cpf } },
          select: { id: true },
        }),
      );
      if (porEmail) throw new ConflictException("Esse email já está em uso por outro cadastro.");
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

/** Só os 4 últimos dígitos — o suficiente pra ele reconhecer o número. */
function mascararCelular(telefone: string): string {
  const d = telefone.replace(/\D/g, "");
  return d.length < 4 ? "••••" : `••••-${d.slice(-4)}`;
}

function gerarCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
