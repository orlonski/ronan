import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { MotoristaIdentidade } from "@prisma/client";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";

/**
 * A PESSOA por trás dos cadastros — quem ela é, independente de empresa.
 *
 * Tudo aqui atravessa contas de propósito (a identidade é da plataforma, não da
 * transportadora), então roda em `comoSistema`. E como `MotoristaIdentidade`
 * está em `MODELS_GLOBAIS`, a trava não filtra nada: todo `where` leva `id` ou
 * `cpf` na mão, e o que sai pra fora se monta campo a campo.
 *
 * Ver docs/identidade-motorista.md.
 */
@Injectable()
export class IdentidadeService {
  private readonly log = new Logger(IdentidadeService.name);

  constructor(private readonly prisma: PrismaService) {}

  porCpf(cpf: string): Promise<MotoristaIdentidade | null> {
    return comoSistema(() => this.prisma.motoristaIdentidade.findUnique({ where: { cpf } }));
  }

  /**
   * A identidade daquele CPF, criando-a na hora se o cadastro for anterior à
   * separação pessoa/vínculo.
   *
   * A migration criou uma identidade pra cada CPF que já existia, mas cadastro
   * feito pelo painel entre o deploy do banco e o do código nasceria sem — e sem
   * isto essa pessoa simplesmente não conseguiria entrar. O desempate é o mesmo
   * do backfill (cadastro ativo, mais recente primeiro), que por sua vez é o que
   * o antigo `senhaExistenteDoCpf` já usava pra herdar senha entre empresas.
   *
   * Devolve `null` só quando o CPF não existe em lugar nenhum.
   */
  async garantirPorCpf(cpf: string): Promise<MotoristaIdentidade | null> {
    const existente = await this.porCpf(cpf);
    if (existente) return existente;

    const vinculos = await comoSistema(() =>
      this.prisma.motorista.findMany({
        where: { cpf },
        orderBy: [{ ativo: "desc" }, { criadoEm: "desc" }],
      }),
    );
    const fonte = vinculos[0];
    if (!fonte) return null;

    try {
      const criada = await comoSistema(() =>
        this.prisma.motoristaIdentidade.create({
          data: {
            cpf,
            nome: fonte.nome,
            telefone: fonte.telefone,
            email: fonte.email,
            senhaHash: fonte.senhaHash,
            ultimoLoginEm: fonte.ultimoLoginEm,
            expoPushToken: fonte.expoPushToken,
            pushTokenAtualizadoEm: fonte.pushTokenAtualizadoEm,
            vinculos: { connect: vinculos.map((v) => ({ id: v.id })) },
          },
        }),
      );
      this.log.log(`Identidade criada sob demanda pro CPF ${cpf} (${vinculos.length} vínculos)`);
      return criada;
    } catch {
      // Corrida entre dois pedidos do mesmo CPF: o segundo bate no unique e lê a
      // que o primeiro acabou de criar.
      return this.porCpf(cpf);
    }
  }

  /** Cria a pessoa. Usado pelo cadastro no app e pelo cadastro feito no painel. */
  criar(data: {
    cpf: string;
    nome: string;
    telefone?: string | null;
    email?: string | null;
    senhaHash: string;
    /** { placa, modelo?, default } — vira Veiculo quando ela entra numa empresa. */
    placas?: Prisma.InputJsonValue;
  }): Promise<MotoristaIdentidade> {
    return comoSistema(() =>
      this.prisma.motoristaIdentidade.create({
        data: {
          cpf: data.cpf,
          nome: data.nome,
          telefone: data.telefone ?? null,
          email: data.email ?? null,
          senhaHash: data.senhaHash,
          ...(data.placas === undefined ? {} : { placas: data.placas }),
        },
      }),
    );
  }

  /**
   * Grava o celular da pessoa. Usado quando o painel corrige o número de alguém
   * que ainda não entrou no app — é por ele que o código de confirmação chega.
   */
  async definirTelefone(identidadeId: string, telefone: string | null): Promise<void> {
    await comoSistema(() =>
      this.prisma.motoristaIdentidade.update({
        where: { id: identidadeId },
        data: { telefone },
      }),
    );
  }

  /**
   * Copia nome/telefone/e-mail da pessoa pros cadastros dela.
   *
   * Os campos vivem duplicados no vínculo porque ~200 consultas do painel, dos
   * relatórios e do export fazem `select: { nome, cpf }` direto nele. A fonte da
   * verdade é a identidade; isto aqui é o único ponto que reescreve as cópias —
   * espalhar essa atualização seria garantir que uma delas ficaria pra trás.
   */
  async sincronizarVinculos(identidadeId: string): Promise<void> {
    const identidade = await comoSistema(() =>
      this.prisma.motoristaIdentidade.findUnique({
        where: { id: identidadeId },
        select: { nome: true, telefone: true, email: true },
      }),
    );
    if (!identidade) return;
    await comoSistema(() =>
      this.prisma.motorista.updateMany({
        where: { identidadeId },
        data: {
          nome: identidade.nome,
          telefone: identidade.telefone,
          email: identidade.email,
        },
      }),
    );
  }
}
