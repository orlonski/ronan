import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { AcaoAuditoria } from "@prisma/client";
import type { SessaoEmpresa } from "@ronan/shared-types";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { lerPlacasJson, vincularPlacas } from "../common/placas";
import { VINCULO_CONVITE_PENDENTE, VINCULO_VIVO } from "../common/vinculo";
import { PrismaService } from "../prisma/prisma.service";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { UploadsService } from "../uploads/uploads.service";
import { AuthService } from "./auth.service";
import { IdentidadeService } from "./identidade.service";

/**
 * O que a PESSOA vê e faz sobre si mesma, esteja ou não numa empresa.
 *
 * Roda com token de identidade, que não define conta no contexto — então nada
 * aqui pode ler dado de negócio (a trava recusaria, e com razão). O que
 * atravessa a fronteira é só o nome da empresa que convidou: ele precisa saber
 * quem o chamou pra decidir.
 */
@Injectable()
export class EuService {
  private readonly log = new Logger(EuService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly identidades: IdentidadeService,
    private readonly auditoria: AuditoriaService,
    private readonly uploads: UploadsService,
  ) {}

  async perfil(identidadeId: string) {
    const eu = await comoSistema(() =>
      this.prisma.motoristaIdentidade.findUniqueOrThrow({
        where: { id: identidadeId },
        select: { id: true, nome: true, cpf: true, telefone: true, email: true, placas: true },
      }),
    );
    const { placas, placaDefault } = lerPlacasJson(eu.placas);
    return {
      id: eu.id,
      nome: eu.nome,
      cpf: eu.cpf,
      telefone: eu.telefone,
      email: eu.email,
      placas,
      placaDefault,
      empresas: await this.auth.cadastrosDaIdentidade(identidadeId),
      convites: await this.convites(identidadeId),
    };
  }

  /**
   * Os convites que ele ainda não respondeu.
   *
   * Sai daqui o nome da empresa e a data — nada mais. Quem convidou (o usuário
   * do painel) é assunto interno dela.
   */
  async convites(identidadeId: string) {
    const pendentes = await comoSistema(() =>
      this.prisma.motorista.findMany({
        where: { identidadeId, ...VINCULO_CONVITE_PENDENTE },
        select: {
          id: true,
          contaId: true,
          convidadoEm: true,
          conta: { select: { nome: true, logoUrl: true, ativa: true } },
        },
        orderBy: { convidadoEm: "desc" },
      }),
    );
    return pendentes
      .filter((c) => c.conta.ativa)
      .map((c) => ({
        motoristaId: c.id,
        contaId: c.contaId,
        contaNome: c.conta.nome,
        contaLogoUrl: c.conta.logoUrl,
        convidadoEm: c.convidadoEm,
      }));
  }

  /**
   * Aceita o convite: o vínculo passa a valer e ele já sai daqui com a sessão
   * daquela empresa aberta — entrar não pode pedir senha de novo.
   */
  async aceitar(identidadeId: string, motoristaId: string): Promise<SessaoEmpresa> {
    const vinculo = await this.convitePropio(identidadeId, motoristaId);

    await comConta(vinculo.contaId, () =>
      this.prisma.$transaction(async (tx) => {
        await tx.motorista.update({
          where: { id: vinculo.id },
          data: { aceite: "ACEITO", aceiteEm: new Date() },
        });
        // As placas que ele informou no cadastro viram veículos DESTA empresa
        // agora — antes disso não havia empresa onde criá-las.
        const identidade = await comoSistema(() =>
          this.prisma.motoristaIdentidade.findUniqueOrThrow({
            where: { id: identidadeId },
            select: { placas: true },
          }),
        );
        const { placas, placaDefault } = lerPlacasJson(identidade.placas);
        await vincularPlacas(tx, vinculo.id, placas, placaDefault);
      }),
    );

    this.log.log(`Identidade ${identidadeId} aceitou o convite da conta ${vinculo.contaId}`);
    await comConta(vinculo.contaId, () =>
      this.auditoria.log({
        entidade: "Motorista",
        entidadeId: vinculo.id,
        acao: AcaoAuditoria.MOTORISTA_ACEITOU_VINCULO,
        campo: "aceite",
        valorAntes: "PENDENTE",
        valorDepois: "ACEITO",
      }),
    );
    const atualizado = await comoSistema(() =>
      this.prisma.motorista.findUniqueOrThrow({
        where: { id: vinculo.id },
        select: {
          id: true,
          contaId: true,
          status: true,
          ativo: true,
          aceite: true,
          ultimoLoginEm: true,
        },
      }),
    );
    return this.auth.abrirSessao(atualizado);
  }

  /** Recusa: some da vista dos dois lados, e a empresa vê que ele disse não. */
  async recusar(identidadeId: string, motoristaId: string) {
    const vinculo = await this.convitePropio(identidadeId, motoristaId);
    await comConta(vinculo.contaId, async () => {
      await this.prisma.motorista.update({
        where: { id: vinculo.id },
        data: { aceite: "RECUSADO", aceiteEm: new Date() },
      });
      await this.auditoria.log({
        entidade: "Motorista",
        entidadeId: vinculo.id,
        acao: AcaoAuditoria.MOTORISTA_RECUSOU_VINCULO,
        campo: "aceite",
        valorAntes: "PENDENTE",
        valorDepois: "RECUSADO",
      });
    });
    return { ok: true };
  }

  async atualizarPerfil(
    identidadeId: string,
    data: { nome?: string; telefone?: string; email?: string | null },
  ) {
    await comoSistema(() =>
      this.prisma.motoristaIdentidade.update({ where: { id: identidadeId }, data }),
    );
    // As cópias no vínculo são o que o painel lê — atualizar só a pessoa faria a
    // empresa continuar vendo o telefone velho.
    await this.identidades.sincronizarVinculos(identidadeId);
    return this.perfil(identidadeId);
  }

  /**
   * O convite existe, é dele e ainda está pendente?
   *
   * Mesma resposta pros três casos: quem chutar id de motorista não descobre
   * nem que ele existe. A trava não protege esta consulta (roda sem conta), a
   * checagem é aqui na mão.
   */
  private async convitePropio(identidadeId: string, motoristaId: string) {
    const vinculo = await comoSistema(() =>
      this.prisma.motorista.findUnique({
        where: { id: motoristaId },
        select: {
          id: true,
          contaId: true,
          identidadeId: true,
          aceite: true,
          ativo: true,
          status: true,
        },
      }),
    );
    if (
      !vinculo ||
      vinculo.identidadeId !== identidadeId ||
      vinculo.aceite !== "PENDENTE" ||
      !vinculo.ativo ||
      vinculo.status === "REJEITADO"
    ) {
      throw new ForbiddenException("Esse convite não está mais disponível.");
    }
    return vinculo;
  }

  /** As empresas onde ele já está dentro — usado pelo seletor do app. */
  empresas(identidadeId: string) {
    return this.auth.cadastrosDaIdentidade(identidadeId);
  }

  /** Guarda o token de push do aparelho na PESSOA (o aparelho é dela). */
  async registrarPushToken(identidadeId: string, token: string) {
    await comoSistema(() =>
      this.prisma.motoristaIdentidade.update({
        where: { id: identidadeId },
        data: { expoPushToken: token, pushTokenAtualizadoEm: new Date() },
      }),
    );
    return { ok: true };
  }

  /** Placas que ele diz rodar. Vira veículo quando entra numa empresa. */
  async atualizarPlacas(identidadeId: string, placas: { placa: string; modelo?: string }[], placaDefault?: string | null) {
    const def = placaDefault ?? (placas.length === 1 ? placas[0]!.placa : null);
    await comoSistema(() =>
      this.prisma.motoristaIdentidade.update({
        where: { id: identidadeId },
        data: {
          placas: placas.map((p) => ({
            placa: p.placa,
            ...(p.modelo ? { modelo: p.modelo } : {}),
            default: p.placa === def,
          })),
        },
      }),
    );
    // Já está em alguma empresa? Então a placa nova precisa existir lá também —
    // senão ele cadastra a placa no perfil e ela não aparece no lançamento.
    const vinculos = await comoSistema(() =>
      this.prisma.motorista.findMany({
        where: { identidadeId, ...VINCULO_VIVO },
        select: { id: true, contaId: true },
      }),
    );
    for (const v of vinculos) {
      await comConta(v.contaId, () =>
        this.prisma.$transaction((tx) => vincularPlacas(tx, v.id, placas, def)),
      );
    }
    return this.perfil(identidadeId);
  }

  /**
   * Apagar a conta — de verdade, e a partir do próprio app.
   *
   * A App Store exige (5.1.1-v) que quem cria conta no app consiga apagá-la por
   * lá, sem e-mail nem telefone pro suporte. Faltava, e era recusa na triagem.
   *
   * O que some: a PESSOA e tudo que é dela — caderno, fretes por conta própria,
   * comprovantes, documentos (inclusive os arquivos no MinIO) e o pedido de
   * senha pendente. Cascata do banco cuida das tabelas; os arquivos a gente
   * apaga antes, porque MinIO não tem FK.
   *
   * O que FICA: as viagens que ele rodou pra uma transportadora. São documento
   * fiscal dela, não dado pessoal dele — apagar seria destruir o registro de um
   * terceiro. O vínculo em si é DESLIGADO (`ativo: false`) e a auditoria conta o
   * porquê, então a empresa vê o que aconteceu e consegue reativar se foi
   * engano. Desligar é obrigatório, não cosmético: `garantirPorCpf` recria a
   * identidade a partir de um vínculo vivo, e sem isso a conta ressuscitaria no
   * próximo login.
   */
  async excluirConta(identidadeId: string) {
    const eu = await comoSistema(() =>
      this.prisma.motoristaIdentidade.findUniqueOrThrow({
        where: { id: identidadeId },
        select: { id: true, nome: true, cpf: true },
      }),
    );

    const vinculos = await comoSistema(() =>
      this.prisma.motorista.findMany({
        where: { identidadeId },
        select: { id: true, contaId: true, ativo: true },
      }),
    );

    // Arquivos primeiro: se o banco cair no meio, sobra objeto órfão no bucket
    // (barato de varrer) em vez de linha apontando pra arquivo que já não existe.
    const documentos = await comoSistema(() =>
      this.prisma.documentoPessoal.findMany({
        where: { identidadeId },
        select: { arquivoKey: true },
      }),
    );
    for (const d of documentos) {
      if (d.arquivoKey) await this.uploads.removerObjeto(d.arquivoKey);
    }

    for (const v of vinculos.filter((v) => v.ativo)) {
      await comConta(v.contaId, async () => {
        await this.prisma.motorista.update({
          where: { id: v.id },
          data: { ativo: false },
        });
        await this.auditoria.log({
          entidade: "Motorista",
          entidadeId: v.id,
          acao: AcaoAuditoria.DELETE,
          campo: "ativo",
          valorAntes: "true",
          valorDepois: "false (o motorista apagou a conta dele no app)",
        });
      });
    }

    await comoSistema(() =>
      this.prisma.motoristaIdentidade.delete({ where: { id: identidadeId } }),
    );

    this.log.log(
      `Identidade ${eu.id} apagada a pedido do próprio motorista ` +
        `(${vinculos.length} vínculo(s) desligado(s))`,
    );
    return { ok: true as const, vinculosDesligados: vinculos.filter((v) => v.ativo).length };
  }
}
