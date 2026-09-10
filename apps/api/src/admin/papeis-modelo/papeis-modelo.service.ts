import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { TODAS_AS_CHAVES, type PapelModeloInput } from "@ronan/shared-types";
import { comoSistema } from "../../common/conta/conta-context";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Os papéis-modelo que a plataforma publica pras empresas copiarem.
 *
 * `PapelModelo` é global (está em `MODELS_GLOBAIS`), então tudo aqui roda em
 * `comoSistema`: quem administra os modelos pode estar visitando uma empresa
 * qualquer no momento, e os modelos não são de empresa nenhuma.
 *
 * Modelo não autoriza ninguém. Ele só descreve um conjunto de chaves que vira
 * uma CÓPIA quando alguma empresa escolhe usá-lo — a cópia é que é um papel de
 * verdade. Por isso não há risco em um modelo citar chave que uma empresa não
 * pode ter: `PapeisService.criarDoModelo` filtra pelo teto de quem copia.
 */
@Injectable()
export class PapeisModeloService {
  constructor(private readonly prisma: PrismaService) {}

  listar() {
    return comoSistema(() =>
      this.prisma.papelModelo.findMany({
        orderBy: [{ ativo: "desc" }, { nome: "asc" }],
        include: { _count: { select: { copias: true } } },
      }),
    ).then((linhas) => linhas.map(({ _count, ...m }) => ({ ...m, copias: _count.copias })));
  }

  async criar(input: PapelModeloInput) {
    const nome = input.nome.trim();
    const existe = await comoSistema(() => this.prisma.papelModelo.findUnique({ where: { nome } }));
    if (existe) throw new ConflictException(`Já existe um modelo chamado "${nome}".`);

    return comoSistema(() =>
      this.prisma.papelModelo.create({
        data: {
          nome,
          descricao: input.descricao,
          permissoes: this.somenteDoCatalogo(input.permissoes),
          ativo: input.ativo ?? true,
        },
      }),
    );
  }

  async atualizar(id: string, input: PapelModeloInput) {
    const modelo = await comoSistema(() => this.prisma.papelModelo.findUnique({ where: { id } }));
    if (!modelo) throw new NotFoundException("Modelo não encontrado.");

    const nome = input.nome.trim();
    if (nome !== modelo.nome) {
      const conflito = await comoSistema(() =>
        this.prisma.papelModelo.findUnique({ where: { nome } }),
      );
      if (conflito) throw new ConflictException(`Já existe um modelo chamado "${nome}".`);
    }

    // Mudar o modelo NÃO mexe em quem já copiou: a cópia virou papel da empresa
    // e vive a vida dela. Quem quiser a versão nova copia de novo.
    return comoSistema(() =>
      this.prisma.papelModelo.update({
        where: { id },
        data: {
          nome,
          descricao: input.descricao,
          permissoes: this.somenteDoCatalogo(input.permissoes),
          ativo: input.ativo ?? modelo.ativo,
        },
      }),
    );
  }

  async remover(id: string) {
    const modelo = await comoSistema(() => this.prisma.papelModelo.findUnique({ where: { id } }));
    if (!modelo) throw new NotFoundException("Modelo não encontrado.");
    // Sem checar cópias: a FK é `ON DELETE SET NULL` e `modeloId` é só rastro de
    // origem. Apagar o modelo não pode tirar permissão de ninguém.
    return comoSistema(() => this.prisma.papelModelo.delete({ where: { id } }));
  }

  /** Chave que não existe no catálogo não entra — evita modelo com lixo dentro. */
  private somenteDoCatalogo(chaves: string[]): string[] {
    const validas = new Set(TODAS_AS_CHAVES);
    return chaves.filter((c) => validas.has(c));
  }
}
