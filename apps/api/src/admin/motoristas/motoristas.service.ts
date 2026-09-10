import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AcaoAuditoria, type Prisma } from "@prisma/client";
import type {
  CriarMotoristaInput,
  AtualizarMotoristaInput,
  PlacaInput,
  EnviarPushInput,
  EnviarPushResultado,
  StatusMotorista,
} from "@ronan/shared-types";
import { NOME_PLATAFORMA } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthService } from "../../auth/auth.service";
import { IdentidadeService } from "../../auth/identidade.service";
import { UploadsService } from "../../uploads/uploads.service";
import { PushService } from "../../push/push.service";
import { EnvioWhatsappService } from "../../whatsapp/envio/envio-whatsapp.service";
import { SessaoService } from "../../whatsapp/sessao.service";
import { contaIdAtual } from "../../common/conta/conta-context";
import { paginate, type Paginated, type PaginationQuery } from "../../common/pagination";
import { ymdSaoPaulo } from "../../common/timezone";
import { adotarLancamentosOrfaos } from "../../common/transportadora";
import { filtroEscopo, type EscopoAdmin } from "../../common/escopo/escopo";
import { nasceComoConvite } from "../../common/vinculo";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { EasUpdateService } from "./eas-update.service";

/**
 * Buscas por CPF por usuário, pra segurar varredura. Em memória de propósito:
 * é uma trava grosseira contra abuso óbvio, não contabilidade — reiniciar a API
 * e zerar isso não tem consequência.
 */
const BUSCAS_CPF = new Map<string, number[]>();

// Valor especial do filtro: motoristas que nunca reportaram versão (appVersion null).
const SEM_VERSAO = "sem-versao";

type ListMotoristasParams = PaginationQuery & {
  /** `PENDENTE` = a aba de convites enviados. Omitido = todo mundo, menos eles. */
  aceite?: "PENDENTE" | "ACEITO" | "RECUSADO";
  ativo?: "true" | "false";
  status?: StatusMotorista;
  appVersion?: string;
  transportadoraId?: string;
  semTransportadora?: "true";
};

const SAFE_SELECT = {
  id: true,
  nome: true,
  cpf: true,
  telefone: true,
  email: true,
  veiculoDefaultId: true,
  veiculoDefault: { select: { id: true, placa: true, modelo: true } },
  veiculos: {
    select: { veiculo: { select: { id: true, placa: true, modelo: true, ativo: true } } },
    orderBy: { veiculo: { placa: "asc" } },
  },
  documentos: {
    select: {
      id: true,
      tipo: true,
      nomeArquivo: true,
      mimetype: true,
      tamanho: true,
      validade: true,
      criadoEm: true,
      alteradoEm: true,
    },
    orderBy: { tipo: "asc" },
  },
  transportadoraId: true,
  transportadora: { select: { id: true, nome: true } },
  modalidadeId: true,
  modalidade: { select: { id: true, nome: true } },
  ativo: true,
  status: true,
  aceite: true,
  convidadoEm: true,
  convidadoPor: { select: { id: true, nome: true } },
  aprovadoEm: true,
  aprovadoPor: { select: { id: true, nome: true } },
  ultimoLoginEm: true,
  appVersion: true,
  appUpdateId: true,
  appBuiltAt: true,
  appCanal: true,
  appVistoEm: true,
  expoPushToken: true,
  podeLancarViagem: true,
  podeIniciarViagem: true,
  podeLancarPedagio: true,
  podeLancarAbastecimento: true,
  podeUsarOcrTicket: true,
  podeVerStories: true,
  podeVerTodosLocais: true,
  podeReferenciaKm: true,
  podeTelemetria: true,
  podeChat: true,
  podeDiaria: true,
  receberResumoDiario: true,
  criadoEm: true,
  criadoPor: { select: { id: true, nome: true } },
} as const;

type PrismaTx = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

@Injectable()
export class MotoristasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly push: PushService,
    private readonly eas: EasUpdateService,
    private readonly envio: EnvioWhatsappService,
    private readonly identidades: IdentidadeService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Envia uma mensagem de WhatsApp personalizada pro motorista.
   * Admin escreve o texto na tela de Motoristas. Reaproveita o número (SessaoService
   * normaliza pro DDI 55). Retorna se enviou + motivo quando não dá.
   */
  async enviarWhatsapp(
    motoristaId: string,
    mensagem: string,
  ): Promise<{ enviado: boolean; motivo?: string }> {
    const m = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { id: true, nome: true, telefone: true },
    });
    if (!m) throw new NotFoundException("Motorista não encontrado");
    const disp = await this.envio.disponivel("MENSAGEM_AVULSA");
    if (!disp.ok) {
      return { enviado: false, motivo: disp.motivo };
    }
    if (!m.telefone) {
      return { enviado: false, motivo: "Motorista sem telefone cadastrado." };
    }
    const numero = SessaoService.normalizar(m.telefone);
    const r = await this.envio.tentarEnviar({
      destino: { tipo: "TELEFONE", numero },
      rota: "MENSAGEM_AVULSA",
      texto: mensagem,
    });
    if (!r.enviado) {
      return { enviado: false, motivo: `Falha no envio: ${r.erro?.detalhe ?? "motivo desconhecido"}` };
    }
    return { enviado: true };
  }

  async list(
    params: ListMotoristasParams,
    escopo: EscopoAdmin,
  ): Promise<Paginated<Record<string, unknown>>> {
    // Convite ainda não respondido NÃO é motorista da empresa: ele não aceitou,
    // não lança nada e não devia aparecer na lista como se fosse do time. Vive na
    // aba de convites (`aceite=PENDENTE`).
    const where: Prisma.MotoristaWhereInput = { aceite: params.aceite ?? { not: "PENDENTE" } };
    if (params.ativo === "true") where.ativo = true;
    if (params.ativo === "false") where.ativo = false;
    if (params.status) where.status = params.status;
    if (params.appVersion === SEM_VERSAO) where.appVersion = null;
    else if (params.appVersion) where.appVersion = params.appVersion;
    if (params.transportadoraId) where.transportadoraId = params.transportadoraId;
    if (params.semTransportadora === "true") where.transportadoraId = null;

    const result = await paginate<Record<string, unknown>, ListMotoristasParams>(
      this.prisma.motorista,
      {
        params,
        where: where as Record<string, unknown>,
        escopo,
        searchFields: ["nome", "cpf", "telefone", "email"],
        sortable: {
          nome: "nome",
          cpf: "cpf",
          criadoEm: "criadoEm",
          ultimoLoginEm: "ultimoLoginEm",
          ativo: "ativo",
          transportadora: "transportadora.nome",
        },
        defaultSort: { field: "nome", order: "asc" },
        select: SAFE_SELECT as unknown as Record<string, unknown>,
      },
    );

    const flat = result.data.map(
      (m) => this.flatten(m as Parameters<typeof this.flatten>[0]) as Record<string, unknown>,
    );
    const contagens = await this.contarViagens(flat.map((m) => m.id as string), escopo);
    return {
      data: flat.map((m) => ({
        ...m,
        viagensTotal: contagens.total.get(m.id as string) ?? 0,
        viagensMes: contagens.mes.get(m.id as string) ?? 0,
      })),
      pagination: result.pagination,
    };
  }

  /**
   * Conta viagens por motorista pra página atual (total e no mês corrente).
   * Dois groupBy filtrados pelos ids da página — barato, não escaneia a base
   * inteira. Conta TODAS as viagens (inclui EM_ANDAMENTO/AGUARDANDO_PESO). O mês
   * usa a coluna `data` (@db.Date) ancorada na data civil de São Paulo.
   */
  private async contarViagens(ids: string[], escopo: EscopoAdmin) {
    const total = new Map<string, number>();
    const mes = new Map<string, number>();
    if (ids.length === 0) return { total, mes };

    const [y, m] = ymdSaoPaulo();
    const inicioMes = new Date(Date.UTC(y, m - 1, 1));
    const inicioMesQueVem = new Date(Date.UTC(y, m, 1));

    const [totais, mensais] = await Promise.all([
      this.prisma.viagem.groupBy({
        by: ["motoristaId"],
        // Escopo aqui também: sem isso o gestor veria o total geral do
        // motorista, incluindo o que ele rodou por outra frota.
        where: { motoristaId: { in: ids }, ...filtroEscopo(escopo) },
        _count: { _all: true },
      }),
      this.prisma.viagem.groupBy({
        by: ["motoristaId"],
        where: {
          motoristaId: { in: ids },
          data: { gte: inicioMes, lt: inicioMesQueVem },
          ...filtroEscopo(escopo),
        },
        _count: { _all: true },
      }),
    ]);
    for (const t of totais) total.set(t.motoristaId, t._count._all);
    for (const t of mensais) mes.set(t.motoristaId, t._count._all);
    return { total, mes };
  }

  /**
   * Versões distintas reportadas pelos motoristas (+ contagem), pro filtro do
   * painel. Inclui o grupo `null` (nunca abriu o app) → o front mostra como
   * "Sem versão".
   */
  async versoesDisponiveis(escopo: EscopoAdmin) {
    const grupos = await this.prisma.motorista.groupBy({
      by: ["appVersion"],
      // Conta motorista: sem escopo, o gestor veria a contagem da frota inteira.
      where: filtroEscopo(escopo),
      _count: { _all: true },
      orderBy: { appVersion: "desc" },
    });
    return grupos.map((g) => ({ versao: g.appVersion, total: g._count._all }));
  }

  async findOne(id: string, escopo: EscopoAdmin) {
    // findFirst + 404 (não 403): não confirma existência de motorista de outra frota.
    const m = await this.prisma.motorista.findFirst({
      where: { id, ...filtroEscopo(escopo) },
      select: SAFE_SELECT,
    });
    if (!m) throw new NotFoundException("Motorista não encontrado");
    return this.flatten(m);
  }

  /**
   * Referência pro selo de "atualizado" no dashboard: o último OTA publicado de
   * verdade, consultado direto no servidor de updates da Expo (fonte
   * autoritativa). Se a Expo não responder, cai no fallback da heurística antiga
   * (o bundle mais novo visto entre os motoristas) — nunca pior do que era.
   *
   * `fonte` indica qual referência venceu, pro dashboard poder sinalizar quando
   * está em modo degradado.
   */
  async resumoVersoes(escopo: EscopoAdmin) {
    const maisNovo = await this.prisma.motorista.findFirst({
      where: { appBuiltAt: { not: null }, ...filtroEscopo(escopo) },
      orderBy: { appBuiltAt: "desc" },
      select: { appVersion: true, appUpdateId: true, appBuiltAt: true },
    });

    // Runtime a consultar: a maior versão de app vista (auto-ajusta quando sobe
    // build nativo novo); fallback pra versão atual do app.
    const runtime = maisNovo?.appVersion ?? "1.0.0";
    const eas = await this.eas.latest(runtime);

    if (eas?.latestBuiltAt) {
      return {
        latestVersion: eas.latestVersion ?? maisNovo?.appVersion ?? null,
        latestUpdateId: eas.latestUpdateId,
        latestBuiltAt: eas.latestBuiltAt,
        fonte: "eas" as const,
      };
    }

    return {
      latestVersion: maisNovo?.appVersion ?? null,
      latestUpdateId: maisNovo?.appUpdateId ?? null,
      latestBuiltAt: maisNovo?.appBuiltAt?.toISOString() ?? null,
      fonte: "motoristas" as const,
    };
  }

  async create(data: CriarMotoristaInput, usuarioId: string) {
    const exists = await this.prisma.motorista.findFirst({ where: { cpf: data.cpf } });
    if (exists) throw new ConflictException("CPF já cadastrado");

    // Essa pessoa já existe na plataforma (roda pra outra empresa, ou se
    // cadastrou pelo app)? Então ela já tem senha — o cadastro se pendura na
    // identidade dela e o que vier no corpo é ignorado. A senha é da PESSOA;
    // criar outra aqui daria duas senhas pro mesmo CPF e uma delas pararia de
    // funcionar na primeira troca. O painel nem mostra o campo nesse caso.
    const existente = await this.identidades.garantirPorCpf(data.cpf);

    // "Novo motorista" e "Convidar por CPF" são a mesma ação e resolvem no
    // mesmo lugar: quem decide se é cadastro ou convite é o outro lado, não o
    // botão que a empresa apertou. Ver common/vinculo.ts.
    const ehConvite = nasceComoConvite(existente);
    if (!existente && !data.senha) {
      throw new BadRequestException("Informe a senha inicial do motorista.");
    }
    const senhaHash = existente?.senhaHash ?? (await AuthService.hashPassword(data.senha!));
    const identidade =
      existente ??
      (await this.identidades.criar({
        cpf: data.cpf,
        nome: data.nome,
        telefone: data.telefone,
        email: data.email,
        senhaHash,
      }));

    const created = await this.prisma.$transaction(async (tx) => {
      const motorista = await tx.motorista.create({
        data: {
          identidadeId: identidade.id,
          // Convite: o nome e o telefone são os DELA, não os que o admin
          // digitou — quem já usa o app é dona do próprio cadastro.
          nome: ehConvite ? identidade.nome : data.nome,
          cpf: data.cpf,
          senhaHash,
          telefone: ehConvite ? identidade.telefone : data.telefone,
          email: ehConvite ? identidade.email : data.email,
          transportadoraId: data.transportadoraId ?? null,
          ...(ehConvite
            ? { aceite: "PENDENTE" as const, convidadoPorId: usuarioId, convidadoEm: new Date() }
            : {}),
          criadoPorId: usuarioId,
        },
      });
      const resolvidos = await this.upsertPlacas(tx, data.placas);
      if (resolvidos.length > 0) {
        await tx.motoristaVeiculo.createMany({
          data: resolvidos.map((v) => ({ motoristaId: motorista.id, veiculoId: v.id })),
          skipDuplicates: true,
        });
      }
      const veiculoDefaultId = this.resolverDefault(data.placaDefault, resolvidos);
      if (veiculoDefaultId) {
        await tx.motorista.update({
          where: { id: motorista.id },
          data: { veiculoDefaultId },
        });
      }
      return tx.motorista.findUniqueOrThrow({ where: { id: motorista.id }, select: SAFE_SELECT });
    });

    if (ehConvite) {
      await this.auditoria.log({
        usuarioId,
        entidade: "Motorista",
        entidadeId: created.id,
        acao: AcaoAuditoria.ADMIN_CONVIDOU_MOTORISTA,
        campo: "aceite",
        valorDepois: "PENDENTE",
        metadata: { cpf: data.cpf, origem: "novo-motorista" },
      });
      void this.avisarConvite(identidade.id, identidade.telefone, contaIdAtual());
    }
    return this.flatten(created);
  }

  /**
   * Procura uma PESSOA pelo CPF pra empresa poder convidá-la.
   *
   * Exige o CPF inteiro e bate exato: nunca lista, nunca busca por nome nem por
   * parte do número. É a mesma linha do `checarCpf` — responde sobre um CPF que
   * quem pergunta já digitou por completo, e nada além disso. Devolve o nome
   * (pra conferir que é a pessoa certa) e o celular MASCARADO; em qual outra
   * empresa ela roda não é assunto de quem está do lado de cá.
   */
  async procurarPorCpf(cpf: string, usuarioId: string) {
    this.limitarBusca(usuarioId);
    const identidade = await this.identidades.porCpf(cpf);
    if (!identidade) return { encontrado: false as const };

    // Já é da casa? Então não é convite, é a lista de motoristas.
    const jaAqui = await this.prisma.motorista.findFirst({
      where: { cpf },
      select: { id: true, aceite: true, ativo: true },
    });
    return {
      encontrado: true as const,
      nome: identidade.nome,
      telefoneMascarado: mascararCelular(identidade.telefone),
      jaVinculado: jaAqui ? { motoristaId: jaAqui.id, aceite: jaAqui.aceite, ativo: jaAqui.ativo } : null,
    };
  }

  /**
   * Convida a pessoa pra rodar pra esta empresa.
   *
   * O vínculo nasce APROVADO do lado da empresa (foi ela que chamou) e PENDENTE
   * do lado dele — e enquanto ele não aceitar, não aparece na lista de
   * motoristas nem consegue lançar nada. Ninguém entra na conta de ninguém sem
   * dizer sim.
   */
  async convidar(cpf: string, usuarioId: string) {
    const identidade = await this.identidades.porCpf(cpf);
    if (!identidade || !identidade.ativo) {
      throw new NotFoundException({
        code: "CPF_NAO_ENCONTRADO",
        message:
          "Não encontramos ninguém com esse CPF na plataforma. Se ele ainda não usa o app, cadastre pelo botão “Novo motorista”.",
      });
    }

    const existente = await this.prisma.motorista.findFirst({ where: { cpf } });
    if (existente && existente.aceite === "PENDENTE") {
      throw new ConflictException("Você já convidou esse motorista. Ele ainda não respondeu.");
    }
    if (existente && existente.aceite === "ACEITO" && existente.ativo) {
      throw new ConflictException("Esse motorista já está na sua equipe.");
    }

    // Convite recusado (ou vínculo desligado) pode ser refeito: gente muda de
    // ideia, e recomeçar do zero criaria um segundo cadastro pro mesmo CPF.
    const motorista = existente
      ? await this.prisma.motorista.update({
          where: { id: existente.id },
          data: {
            ativo: true,
            status: "APROVADO",
            aceite: "PENDENTE",
            aceiteEm: null,
            convidadoPorId: usuarioId,
            convidadoEm: new Date(),
          },
          select: SAFE_SELECT,
        })
      : await this.prisma.motorista.create({
          data: {
            identidadeId: identidade.id,
            nome: identidade.nome,
            cpf: identidade.cpf,
            telefone: identidade.telefone,
            email: identidade.email,
            senhaHash: identidade.senhaHash,
            status: "APROVADO",
            aceite: "PENDENTE",
            convidadoPorId: usuarioId,
            convidadoEm: new Date(),
            criadoPorId: usuarioId,
          },
          select: SAFE_SELECT,
        });

    await this.auditoria.log({
      usuarioId,
      entidade: "Motorista",
      entidadeId: motorista.id,
      acao: AcaoAuditoria.ADMIN_CONVIDOU_MOTORISTA,
      campo: "aceite",
      valorAntes: existente?.aceite ?? null,
      valorDepois: "PENDENTE",
      metadata: { cpf },
    });
    void this.avisarConvite(identidade.id, identidade.telefone, contaIdAtual());
    return this.flatten(motorista);
  }

  /**
   * Avisa o motorista que foi convidado — no app e no WhatsApp.
   *
   * Best-effort nos dois: se falharem, o convite continua esperando na tela de
   * convites, que é onde ele vive de verdade. O push vai pra PESSOA (ela ainda
   * não tem vínculo vivo, então não há `motoristaId` pra usar).
   *
   * O `contaId` vem por parâmetro, capturado pelo chamador: `Conta` é global
   * (MODELS_GLOBAIS), então a trava NÃO filtra esta leitura e o id tem que ser
   * citado. Uma versão anterior usava `findFirstOrThrow` sem `where` e o
   * motorista recebia "«outra empresa» quer te adicionar" — o nome da primeira
   * conta da tabela, não da empresa que convidou.
   */
  private async avisarConvite(identidadeId: string, telefone: string | null, contaId: string) {
    const conta = await this.prisma.conta.findUniqueOrThrow({
      where: { id: contaId },
      select: { nome: true },
    });

    void this.push
      .enviarParaIdentidade({
        identidadeId,
        titulo: `${conta.nome} quer te adicionar`,
        corpo: "Abra o app pra aceitar ou recusar o convite.",
        dados: { kind: "convite-empresa" },
      })
      .catch(() => {});

    if (!telefone) return;
    await this.envio.tentarEnviar({
      destino: { tipo: "TELEFONE", numero: SessaoService.normalizar(telefone) },
      rota: "CONVITE_EMPRESA",
      texto: `A ${conta.nome} quer te adicionar como motorista no ${NOME_PLATAFORMA}. Abra o app pra aceitar ou recusar.`,
      params: [conta.nome, NOME_PLATAFORMA],
    });
  }

  /**
   * Teto de buscas por CPF por usuário.
   *
   * O endpoint responde "essa pessoa existe e se chama fulano" — em volume,
   * isso é varredura de CPF. O teto é grosseiro de propósito: quem cadastra
   * motorista faz isso algumas vezes por dia, não centenas.
   */
  private limitarBusca(usuarioId: string) {
    const agora = Date.now();
    const janela = agora - 60 * 60_000;
    const feitas = (BUSCAS_CPF.get(usuarioId) ?? []).filter((t) => t > janela);
    if (feitas.length >= 30) {
      throw new BadRequestException(
        "Muitas buscas por CPF na última hora. Tente de novo mais tarde.",
      );
    }
    feitas.push(agora);
    BUSCAS_CPF.set(usuarioId, feitas);
  }

  /**
   * Essa pessoa já existe na plataforma?
   *
   * Responde SÓ isso — nunca onde. Quem cadastra precisa saber que não deve
   * inventar uma senha nova, e nada além disso: pra qual outra empresa o
   * motorista roda não é assunto de quem está do lado de cá.
   */
  async cpfEmOutraEmpresa(cpf: string): Promise<{ existe: boolean; usaOApp: boolean }> {
    const identidade = await this.identidades.porCpf(cpf);
    return {
      existe: identidade !== null,
      // Usa o app = tem alguém do outro lado pra aceitar. Muda o que o
      // formulário faz: cadastro vira convite (ver `create`).
      usaOApp: identidade?.ultimoLoginEm != null,
    };
  }

  async update(id: string, data: AtualizarMotoristaInput) {
    const atual = await this.prisma.motorista.findUnique({
      where: { id },
      include: { veiculos: { select: { veiculoId: true } } },
    });
    if (!atual) throw new NotFoundException("Motorista não encontrado");

    const { novaSenha, placas: placasInput, placaDefault, ...rest } = data;
    const updateData: Record<string, unknown> = { ...rest };
    // Senha nova definida pelo admin vale em todas as empresas do motorista —
    // ele tem uma senha só. Vai por propagarSenha depois da transação; o
    // updateData não recebe senhaHash pra não gravar duas vezes.
    const cpfParaSenha = novaSenha ? (rest.cpf ?? atual.cpf) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (placasInput) {
        const resolvidos = await this.upsertPlacas(tx, placasInput);
        const novosIds = new Set(resolvidos.map((v) => v.id));
        const atuaisIds = atual.veiculos.map((v) => v.veiculoId);
        const removidos = atuaisIds.filter((vid) => !novosIds.has(vid));
        const adicionados = resolvidos
          .filter((v) => !atuaisIds.includes(v.id))
          .map((v) => v.id);

        if (removidos.length > 0) {
          if (atual.veiculoDefaultId && removidos.includes(atual.veiculoDefaultId)) {
            updateData.veiculoDefaultId = null;
          }
          await tx.motoristaVeiculo.deleteMany({
            where: { motoristaId: id, veiculoId: { in: removidos } },
          });
          await this.limparOrfaosSemHistorico(tx, removidos);
        }
        if (adicionados.length > 0) {
          await tx.motoristaVeiculo.createMany({
            data: adicionados.map((veiculoId) => ({ motoristaId: id, veiculoId })),
            skipDuplicates: true,
          });
        }
        if (placaDefault !== undefined) {
          updateData.veiculoDefaultId = this.resolverDefault(placaDefault, resolvidos);
        } else if (resolvidos.length === 1 && !atual.veiculoDefaultId) {
          updateData.veiculoDefaultId = resolvidos[0]!.id;
        }
      } else if (placaDefault !== undefined) {
        // Placas não mudaram mas default sim — resolve contra os vínculos atuais
        const atuais = await tx.motoristaVeiculo.findMany({
          where: { motoristaId: id },
          select: { veiculo: { select: { id: true, placa: true } } },
        });
        updateData.veiculoDefaultId = this.resolverDefault(
          placaDefault,
          atuais.map((a) => a.veiculo),
        );
      }

      return tx.motorista.update({ where: { id }, data: updateData, select: SAFE_SELECT });
    });

    if (cpfParaSenha && novaSenha) {
      await AuthService.propagarSenha(
        this.prisma,
        cpfParaSenha,
        await AuthService.hashPassword(novaSenha),
      );
    }

    // Celular corrigido pelo painel de quem AINDA NÃO entrou no app vale também
    // pra pessoa. É o que destrava o cadastro dele: o código de confirmação vai
    // pro número que a empresa tem em ficha, então número errado aqui deixava o
    // motorista sem caminho nenhum — e o recado "peça pro administrativo
    // atualizar" não resolvia nada. Depois que ele entra, o telefone é dele: o
    // painel muda só a cópia da empresa.
    if (rest.telefone !== undefined) {
      const identidade = await this.identidades.porCpf(rest.cpf ?? atual.cpf);
      if (identidade && identidade.ultimoLoginEm === null) {
        await this.identidades.definirTelefone(identidade.id, rest.telefone ?? null);
      }
    }

    // Classificou um motorista que ainda não tinha frota: adota o histórico dele
    // que está sem dono, senão o gestor loga e não vê nada do que já rodou.
    // Reclassificar de uma frota pra outra não move nada — só adota órfão.
    if (!atual.transportadoraId && updated.transportadoraId) {
      await adotarLancamentosOrfaos(
        this.prisma,
        { motoristaId: id },
        updated.transportadoraId,
      );
    }
    return this.flatten(updated);
  }

  async atualizarAcessos(
    id: string,
    input: {
      podeLancarViagem?: boolean;
      podeIniciarViagem?: boolean;
      podeViagemLifecycle?: boolean;
      podeLancarPedagio?: boolean;
      podeLancarAbastecimento?: boolean;
      podeUsarOcrTicket?: boolean;
      podeVerStories?: boolean;
      podeVerTodosLocais?: boolean;
      podeReferenciaKm?: boolean;
      podeTelemetria?: boolean;
      podeChat?: boolean;
      podeDiaria?: boolean;
      receberResumoDiario?: boolean;
    },
  ) {
    const exists = await this.prisma.motorista.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Motorista não encontrado");
    return this.prisma.motorista.update({
      where: { id },
      data: input,
      select: {
        id: true,
        podeLancarViagem: true,
        podeIniciarViagem: true,
        podeViagemLifecycle: true,
        podeLancarPedagio: true,
        podeLancarAbastecimento: true,
        podeUsarOcrTicket: true,
        podeVerStories: true,
        podeVerTodosLocais: true,
        podeReferenciaKm: true,
        podeTelemetria: true,
        podeChat: true,
        podeDiaria: true,
        receberResumoDiario: true,
      },
    });
  }

  /**
   * Aprova ou rejeita um cadastro pendente. Aprovar registra quem/quando
   * (auditoria). Rejeitar limpa o carimbo de aprovação. Login do motorista
   * respeita o status: REJEITADO não loga; APROVADO libera o app.
   */
  async definirAprovacao(id: string, status: "APROVADO" | "REJEITADO", usuarioId: string) {
    const exists = await this.prisma.motorista.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Motorista não encontrado");
    const aprovando = status === "APROVADO";
    const updated = await this.prisma.motorista.update({
      where: { id },
      data: {
        status,
        aprovadoEm: aprovando ? new Date() : null,
        aprovadoPorId: aprovando ? usuarioId : null,
      },
      select: SAFE_SELECT,
    });
    return this.flatten(updated);
  }

  async remove(id: string) {
    const atual = await this.prisma.motorista.findUnique({
      where: { id },
      include: {
        veiculos: { select: { veiculoId: true } },
        documentos: { select: { storageKey: true } },
      },
    });
    if (!atual) throw new NotFoundException("Motorista não encontrado");

    const [viagens, pedagios, abastecimentos] = await Promise.all([
      this.prisma.viagem.count({ where: { motoristaId: id } }),
      this.prisma.pedagio.count({ where: { motoristaId: id } }),
      this.prisma.abastecimento.count({ where: { motoristaId: id } }),
    ]);
    const partes: string[] = [];
    if (viagens > 0) partes.push(`${viagens} viagem${viagens === 1 ? "" : "s"}`);
    if (pedagios > 0) partes.push(`${pedagios} pedágio${pedagios === 1 ? "" : "s"}`);
    if (abastecimentos > 0)
      partes.push(`${abastecimentos} abastecimento${abastecimentos === 1 ? "" : "s"}`);
    if (partes.length > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${partes.join(", ")}. Use o toggle de ativar/inativar pra esconder sem perder o histórico.`,
      );
    }

    const veiculoIds = atual.veiculos.map((v) => v.veiculoId);
    const docKeys = atual.documentos.map((d) => d.storageKey);
    await this.prisma.$transaction(async (tx) => {
      await tx.motorista.delete({ where: { id } });
      await this.limparOrfaosSemHistorico(tx, veiculoIds);
    });
    // Cascade já apagou os rows de motorista_documento — só sobrou limpar
    // os objetos no MinIO. Off-transaction: se falhar fica lixo, não bloqueia.
    for (const key of docKeys) {
      await this.uploads.removeObject(key);
    }
    return { ok: true };
  }

  /**
   * Pra cada placa do input, faz upsert: se placa existe, retorna o veículo
   * (atualiza modelo se vier diferente). Se não existe, cria veículo novo.
   */
  private async upsertPlacas(
    tx: PrismaTx,
    placas: PlacaInput[],
  ): Promise<{ id: string; placa: string }[]> {
    if (placas.length === 0) return [];
    const resolvidos: { id: string; placa: string }[] = [];
    for (const p of placas) {
      const existente = await tx.veiculo.findFirst({ where: { placa: p.placa } });
      if (existente) {
        if (p.modelo && existente.modelo !== p.modelo) {
          await tx.veiculo.update({
            where: { id: existente.id },
            data: { modelo: p.modelo },
          });
        }
        resolvidos.push({ id: existente.id, placa: existente.placa });
      } else {
        const novo = await tx.veiculo.create({
          data: { placa: p.placa, modelo: p.modelo },
        });
        resolvidos.push({ id: novo.id, placa: novo.placa });
      }
    }
    return resolvidos;
  }

  /**
   * Pra cada veiculoId, se não tem mais nenhum motorista vinculado E não tem
   * histórico (viagens, pedágios, abastecimentos), deleta. Veículos com
   * histórico ficam órfãos preservados.
   */
  private async limparOrfaosSemHistorico(tx: PrismaTx, veiculoIds: string[]) {
    for (const vid of veiculoIds) {
      const vinculos = await tx.motoristaVeiculo.count({ where: { veiculoId: vid } });
      if (vinculos > 0) continue;
      const [v, p, a] = await Promise.all([
        tx.viagem.count({ where: { veiculoId: vid } }),
        tx.pedagio.count({ where: { veiculoId: vid } }),
        tx.abastecimento.count({ where: { veiculoId: vid } }),
      ]);
      if (v === 0 && p === 0 && a === 0) {
        await tx.veiculo.delete({ where: { id: vid } });
      }
    }
  }

  private resolverDefault(
    placaDefault: string | null | undefined,
    veiculos: { id: string; placa: string }[],
  ): string | null {
    if (placaDefault == null) {
      return veiculos.length === 1 ? veiculos[0]!.id : null;
    }
    const match = veiculos.find((v) => v.placa === placaDefault);
    return match?.id ?? null;
  }

  private flatten<V>(
    m: { veiculos: { veiculo: V }[]; expoPushToken?: string | null } & Record<string, unknown>,
  ) {
    // Token raw nunca é exposto pro frontend — só o booleano deriva dele.
    const { veiculos, expoPushToken, ...rest } = m;
    return {
      ...rest,
      veiculos: veiculos.map((v) => v.veiculo),
      temPushToken: !!expoPushToken,
    };
  }

  async enviarPush(
    motoristaId: string,
    body: EnviarPushInput,
    usuarioId: string,
  ): Promise<EnviarPushResultado> {
    const m = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { id: true, ativo: true, expoPushToken: true },
    });
    if (!m) throw new NotFoundException("Motorista não encontrado");
    if (!m.ativo) return { enviado: false, motivo: "Motorista inativo" };
    if (!m.expoPushToken) {
      return { enviado: false, motivo: "Motorista ainda não abriu o app (sem token)" };
    }
    return this.push.enviar({
      motoristaId: m.id,
      token: m.expoPushToken,
      titulo: body.titulo,
      corpo: body.corpo,
      dados: body.dados,
      tipo: "mensagem-admin",
      criadoPorId: usuarioId,
    });
  }
}

/** Só os 4 últimos dígitos — o suficiente pra conferir que é a pessoa certa. */
function mascararCelular(telefone: string | null): string | null {
  if (!telefone) return null;
  const d = telefone.replace(/\D/g, "");
  return d.length < 4 ? "••••" : `••••-${d.slice(-4)}`;
}
