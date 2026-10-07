import { Injectable } from "@nestjs/common";
import { AcaoAuditoria, TipoLocal } from "@prisma/client";
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { contaIdAtual } from "../common/conta/conta-context";
import type { AuthIntegracao } from "./integracao.guard";
import { ErroPublico } from "./erros";
import type { PutLocalV1, PutMotoristaV1, PutVeiculoV1 } from "./contrato";
import { externoPorId, idPorExterno, travarNumero, vincular, type EntidadeExterna } from "./vinculos";

type Aviso = { codigo: string; mensagem: string };
type Resultado<T> = { status: 200 | 201; corpo: { criado: boolean; alterado: boolean; avisos: Aviso[] } & T };

/**
 * Senha que nenhum texto produz: o motorista criado pela integração existe pra
 * viagem e pro acerto, não pra entrar no app. O convite pro app continua sendo
 * gesto de uma pessoa no painel.
 */
function senhaInutilizavel(): string {
  return `!sem-acesso-app:${randomBytes(16).toString("hex")}`;
}

const AVISO_NAO_E_SEU = (oque: string): Aviso => ({
  codigo: "CAMPO_PROTEGIDO",
  mensagem: `${oque} já existia aqui (cadastrado no painel ou pelo app). Ligamos ao número de vocês, mas os dados dele não foram alterados.`,
});

/**
 * Cadastros que a viagem exige, criados pelo número do sistema de fora.
 *
 * Regra de dono, a mesma da viagem: a integração cria e atualiza o que ELA
 * criou. O que já existia (feito no painel, ou motorista que usa o app) ela
 * só LIGA ao número dela — nunca muda. É o que impede uma chave de trocar o
 * telefone de um motorista que entra no app e, com o "esqueci a senha",
 * tomar a conta dele.
 */
@Injectable()
export class CadastrosPublicaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async motorista(integ: AuthIntegracao, idExterno: string, c: z.infer<typeof PutMotoristaV1>) {
    return this.gravar(integ, "motorista", idExterno, {
      porChaveNatural: async (tx) =>
        (await tx.motorista.findFirst({ where: { cpf: c.cpf }, select: { id: true } }))?.id ?? null,
      ler: (tx, id) => tx.motorista.findUnique({ where: { id }, select: { id: true, nome: true, cpf: true, telefone: true, origemIntegracao: { select: { sistema: true } } } }),
      criar: async (tx) =>
        (
          await tx.motorista.create({
            data: {
              nome: c.nome,
              cpf: c.cpf,
              telefone: c.telefone ?? null,
              senhaHash: senhaInutilizavel(),
              status: "APROVADO",
              aceite: "ACEITO",
              origemIntegracaoId: integ.integracaoId,
              // Nunca aceitou os nossos termos: o nosso número de WhatsApp e o
              // push não falam com ele (denúncia de spam derruba o número de
              // todas as empresas).
              aceitaWhatsapp: false,
              aceitaPush: false,
              receberResumoDiario: false,
              receberConferenciaDiaria: false,
            },
            select: { id: true },
          })
        ).id,
      atualizar: async (tx, id, atual) => {
        const mudou = atual.nome !== c.nome || atual.cpf !== c.cpf || (c.telefone !== undefined && atual.telefone !== c.telefone);
        if (!mudou) return false;
        if (atual.cpf !== c.cpf && (await tx.motorista.findFirst({ where: { cpf: c.cpf, id: { not: id } }, select: { id: true } }))) {
          throw new ErroPublico("VALIDACAO", "Já existe outro motorista com este CPF nesta empresa.");
        }
        await tx.motorista.update({
          where: { id },
          data: { nome: c.nome, cpf: c.cpf, ...(c.telefone !== undefined ? { telefone: c.telefone } : {}) },
        });
        return true;
      },
      saida: (m, externo) => ({ motorista: { id: m.id, nome: m.nome, externo } }),
      oque: "Este motorista",
    });
  }

  async veiculo(integ: AuthIntegracao, idExterno: string, c: z.infer<typeof PutVeiculoV1>) {
    return this.gravar(integ, "veiculo", idExterno, {
      porChaveNatural: async (tx) =>
        (await tx.veiculo.findFirst({ where: { placa: c.placa }, select: { id: true } }))?.id ?? null,
      ler: (tx, id) => tx.veiculo.findUnique({ where: { id }, select: { id: true, placa: true, modelo: true, origemIntegracao: { select: { sistema: true } } } }),
      criar: async (tx) =>
        (await tx.veiculo.create({ data: { placa: c.placa, modelo: c.modelo ?? null, origemIntegracaoId: integ.integracaoId }, select: { id: true } })).id,
      atualizar: async (tx, id, atual) => {
        const mudou = atual.placa !== c.placa || (c.modelo !== undefined && atual.modelo !== c.modelo);
        if (!mudou) return false;
        if (atual.placa !== c.placa && (await tx.veiculo.findFirst({ where: { placa: c.placa, id: { not: id } }, select: { id: true } }))) {
          throw new ErroPublico("VALIDACAO", "Já existe outro caminhão com esta placa nesta empresa.");
        }
        await tx.veiculo.update({ where: { id }, data: { placa: c.placa, ...(c.modelo !== undefined ? { modelo: c.modelo } : {}) } });
        return true;
      },
      saida: (v, externo) => ({ veiculo: { id: v.id, placa: v.placa, modelo: v.modelo, externo } }),
      oque: "Este caminhão",
    });
  }

  async local(integ: AuthIntegracao, idExterno: string, c: z.infer<typeof PutLocalV1>) {
    const dados = {
      nome: c.nome,
      tipo: c.tipo as TipoLocal,
      logradouro: c.logradouro ?? "",
      numero: c.numero ?? null,
      bairro: c.bairro ?? null,
      cidade: c.cidade,
      uf: c.uf,
      cep: c.cep ?? null,
      lat: c.lat ?? null,
      lng: c.lng ?? null,
    };
    return this.gravar(integ, "local", idExterno, {
      // Local NÃO casa por nome: "Pedreira" se repete, e escolher uma seria o
      // sistema afirmando o que não sabe. Sem o número, nasce um novo; o painel
      // tem a ferramenta de juntar duplicados.
      porChaveNatural: async () => null,
      ler: (tx, id) =>
        tx.local.findUnique({
          where: { id },
          select: { id: true, nome: true, tipo: true, logradouro: true, numero: true, bairro: true, cidade: true, uf: true, cep: true, lat: true, lng: true, origemIntegracao: { select: { sistema: true } } },
        }),
      criar: async (tx) => (await tx.local.create({ data: { ...dados, origemIntegracaoId: integ.integracaoId }, select: { id: true } })).id,
      atualizar: async (tx, id, atual) => {
        const mudou = (Object.keys(dados) as (keyof typeof dados)[]).some((k) => (atual as Record<string, unknown>)[k] !== dados[k]);
        if (!mudou) return false;
        const moveu = atual.lat !== dados.lat || atual.lng !== dados.lng;
        // Mudar a coordenada de um local que o app já usou muda a rota (o cache
        // é por PAR de locais) e o km sugerido de todo mundo. Isso só no painel.
        if (moveu && (await tx.viagem.findFirst({ where: { OR: [{ localCargaId: id }, { localDescargaId: id }], origemIntegracaoId: null }, select: { id: true } }))) {
          throw new ErroPublico(
            "VIAGEM_DE_OUTRA_ORIGEM",
            "Este local já foi usado em viagem lançada pelo app; mudar a coordenada dele só pelo painel.",
          );
        }
        await tx.local.update({ where: { id }, data: dados });
        return true;
      },
      saida: (l, externo) => ({ local: { id: l.id, nome: l.nome, tipo: l.tipo, cidade: l.cidade, uf: l.uf, lat: l.lat, lng: l.lng, externo } }),
      oque: "Este local",
    });
  }

  private async gravar<L extends { id: string; origemIntegracao: { sistema: string } | null }, S extends object>(
    integ: AuthIntegracao,
    entidade: EntidadeExterna,
    idExterno: string,
    ops: {
      porChaveNatural: (tx: PrismaService) => Promise<string | null>;
      ler: (tx: PrismaService, id: string) => Promise<L | null>;
      criar: (tx: PrismaService) => Promise<string>;
      atualizar: (tx: PrismaService, id: string, atual: L) => Promise<boolean>;
      saida: (l: L, externo: string) => S;
      oque: string;
    },
  ): Promise<Resultado<S>> {
    const contaId = contaIdAtual();
    const avisos: Aviso[] = [];
    const r = await this.prisma.$transaction(async (txBruto) => {
      const tx = txBruto as unknown as PrismaService;
      await travarNumero(tx, contaId, integ.sistema, entidade, idExterno);

      let id = await idPorExterno(tx, integ.sistema, entidade, idExterno);
      let criado = false;
      let alterado = false;
      if (!id) {
        const existente = await ops.porChaveNatural(tx);
        if (existente) {
          // Já existia (mesmo CPF, mesma placa). Se ele já tem OUTRO número
          // neste sistema, é o sistema de fora com dois cadastros pra mesma
          // coisa: não decidimos por ele.
          const outro = await externoPorId(tx, integ.sistema, entidade, existente);
          if (outro && outro !== idExterno) {
            throw new ErroPublico("VALIDACAO", `Este cadastro já está ligado ao número "${outro}" no sistema de vocês.`);
          }
          id = existente;
        } else {
          id = await ops.criar(tx);
          criado = true;
        }
        await vincular(tx, { sistema: integ.sistema, entidade, entidadeId: id, idExterno, integracaoId: integ.integracaoId });
      }

      const atual = await ops.ler(tx, id);
      if (!atual) throw new ErroPublico("NAO_ENCONTRADO");
      if (!criado) {
        if (atual.origemIntegracao?.sistema === integ.sistema) alterado = await ops.atualizar(tx, id, atual);
        else avisos.push(AVISO_NAO_E_SEU(ops.oque));
      }
      const final = alterado ? ((await ops.ler(tx, id)) as L) : atual;
      return { id, criado, alterado, final };
    });

    if (r.criado || r.alterado) {
      await this.auditoria.log({
        entidade: entidade[0]!.toUpperCase() + entidade.slice(1),
        entidadeId: r.id,
        acao: r.criado ? AcaoAuditoria.INTEGRACAO_CRIOU : AcaoAuditoria.INTEGRACAO_ALTEROU,
        integracaoId: integ.integracaoId,
        metadata: { integracao: integ.nome, sistema: integ.sistema, idExterno },
      });
    }
    return {
      status: r.criado ? 201 : 200,
      corpo: { criado: r.criado, alterado: r.alterado, ...ops.saida(r.final, idExterno), avisos },
    };
  }
}
