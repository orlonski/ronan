import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { TipoLocal } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthService } from "../../auth/auth.service";
import { IdentidadeService } from "../../auth/identidade.service";
import { parseArquivo } from "../../fechamentos/parsers";
import { ENTIDADE_POR_CHAVE, type EntidadeImportavel } from "../../common/importacao/campos";
import {
  acharCabecalho,
  casarColunas,
  faltandoObrigatorios,
  normalizar,
  type Celula,
  type Mapa,
} from "../../common/importacao/mapear";
import {
  resumirValidacao,
  validarLinhas,
  type LinhaValidada,
} from "../../common/importacao/validar";

/** Teto por arquivo. Acima disso a transação fica longa demais e o painel trava. */
const MAX_LINHAS = 5000;

export type Previa = {
  entidade: string;
  arquivo: string;
  aba: string;
  linhaCabecalho: number;
  cabecalho: Celula[];
  mapa: Mapa;
  faltando: string[];
  linhas: LinhaValidada[];
  resumo: ReturnType<typeof resumirValidacao>;
};

/**
 * Trazer a base que a transportadora já tem.
 *
 * Sem isto, toda venda vira piloto: o cliente abre o sistema num sábado, vê
 * tela vazia, e volta pra planilha na segunda. Com isto, ele abre o sistema com
 * a frota, os motoristas e as pedreiras dele dentro.
 *
 * Três decisões que organizam o resto:
 *
 * 1. **Nunca é tudo ou nada.** 400 linhas com 3 problemas importam 397 e
 *    mostram as 3. Recusar o arquivo por causa de um CPF digitado errado é o
 *    que faz a implantação voltar pro e-mail.
 * 2. **É repetível.** Cada entidade tem uma chave natural (CPF, placa, nome), e
 *    subir a planilha de novo ATUALIZA o que existe em vez de duplicar a base —
 *    que é o erro do qual não se volta.
 * 3. **Não inventa dado.** Célula vazia vira ausente, nunca zero. O que não dá
 *    pra converter com segurança vira erro na linha.
 */
@Injectable()
export class ImportacaoService {
  private readonly log = new Logger(ImportacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identidades: IdentidadeService,
  ) {}

  /** Lê o arquivo e devolve o que ENTRARIA, sem gravar nada. */
  async analisar(args: {
    entidade: string;
    buffer: Buffer;
    nomeArquivo: string;
    mimetype?: string;
    /** Sobrescreve o palpite automático quando o usuário corrige na tela. */
    mapa?: Mapa;
    linhaCabecalho?: number;
  }): Promise<Previa> {
    const entidade = this.entidade(args.entidade);
    const parsed = await parseArquivo(args.buffer, args.nomeArquivo, args.mimetype);

    // A aba com mais linhas: planilha de transportadora costuma ter uma aba de
    // dados e três de apoio ("Plan2", "dropdown", "Instruções").
    const aba = [...parsed.abas].sort((a, b) => b.linhas.length - a.linhas.length)[0];
    if (!aba || aba.linhas.length === 0) {
      throw new BadRequestException("O arquivo não tem nenhuma linha.");
    }

    const linhaCabecalho = args.linhaCabecalho ?? acharCabecalho(aba.linhas, entidade);
    if (linhaCabecalho < 0) {
      throw new BadRequestException(
        `Não achei o cabeçalho. A planilha precisa de uma linha com os nomes das colunas (ex.: ${entidade.campos
          .slice(0, 3)
          .map((c) => c.rotulo)
          .join(", ")}).`,
      );
    }

    const cabecalho = aba.linhas[linhaCabecalho] ?? [];
    const mapa = args.mapa ?? casarColunas(cabecalho, entidade);
    const corpo = aba.linhas.slice(linhaCabecalho + 1, linhaCabecalho + 1 + MAX_LINHAS);
    const linhas = validarLinhas(corpo, entidade, mapa);

    return {
      entidade: entidade.chave,
      arquivo: parsed.nomeArquivo,
      aba: aba.nome,
      linhaCabecalho,
      cabecalho,
      mapa,
      faltando: faltandoObrigatorios(mapa, entidade),
      linhas,
      resumo: resumirValidacao(linhas),
    };
  }

  /**
   * Grava. Só as linhas sem erro e sem duplicata no próprio arquivo.
   *
   * O que já existe é ATUALIZADO, não recriado: a segunda subida da planilha é
   * a correção da primeira, e criar de novo daria dois cadastros do mesmo CPF.
   */
  async aplicar(args: {
    entidade: string;
    linhas: LinhaValidada[];
    usuarioId: string;
    /** Obrigatório em clientes: `Cliente.empresaId` é NOT NULL. */
    empresaId?: string;
  }): Promise<{ criados: number; atualizados: number; ignorados: number; avisos: string[] }> {
    const entidade = this.entidade(args.entidade);
    const validas = args.linhas.filter((l) => l.erros.length === 0 && !l.duplicadaNoArquivo);
    const ignorados = args.linhas.length - validas.length;
    const avisos: string[] = [];

    let criados = 0;
    let atualizados = 0;

    for (const linha of validas) {
      const r = await this.gravar(entidade, linha, args, avisos);
      if (r === "criado") criados++;
      else if (r === "atualizado") atualizados++;
    }

    this.log.log(
      `importação ${entidade.chave}: ${criados} criados, ${atualizados} atualizados, ${ignorados} ignorados`,
    );
    return { criados, atualizados, ignorados, avisos };
  }

  private async gravar(
    entidade: EntidadeImportavel,
    linha: LinhaValidada,
    args: { usuarioId: string; empresaId?: string },
    avisos: string[],
  ): Promise<"criado" | "atualizado" | "pulado"> {
    const v = linha.valores;

    switch (entidade.chave) {
      case "clientes": {
        if (!args.empresaId) throw new BadRequestException("Escolha a empresa dos clientes.");
        const nome = String(v.nome);
        // Casa por nome NORMALIZADO: "Pedreira Norte" e "PEDREIRA NORTE  " são
        // o mesmo cliente, e importar os dois é o começo de uma base suja que
        // ninguém limpa depois.
        const existentes = await this.prisma.cliente.findMany({
          where: { empresaId: args.empresaId },
          select: { id: true, nome: true },
        });
        const achado = existentes.find((c) => normalizar(c.nome) === linha.chave);
        const apelidos = this.lista(v.apelidos);
        if (achado) {
          await this.prisma.cliente.update({
            where: { id: achado.id },
            data: { nome, ...(apelidos.length > 0 ? { apelidos } : {}) },
          });
          return "atualizado";
        }
        await this.prisma.cliente.create({
          data: { nome, empresaId: args.empresaId, apelidos, criadoPorId: args.usuarioId },
        });
        return "criado";
      }

      case "materiais": {
        const nome = String(v.nome);
        const existentes = await this.prisma.material.findMany({ select: { id: true, nome: true } });
        const achado = existentes.find((m) => normalizar(m.nome) === linha.chave);
        if (achado) {
          await this.prisma.material.update({ where: { id: achado.id }, data: { nome } });
          return "atualizado";
        }
        await this.prisma.material.create({ data: { nome, criadoPorId: args.usuarioId } });
        return "criado";
      }

      case "veiculos": {
        const placa = String(v.placa);
        const achado = await this.prisma.veiculo.findFirst({ where: { placa } });
        const dados = {
          modelo: v.modelo === undefined ? undefined : String(v.modelo),
          anoModelo: v.ano === undefined ? undefined : Number(v.ano),
        };
        if (achado) {
          await this.prisma.veiculo.update({ where: { id: achado.id }, data: dados });
          return "atualizado";
        }
        await this.prisma.veiculo.create({
          data: { placa, ...dados, criadoPorId: args.usuarioId },
        });
        return "criado";
      }

      case "locais": {
        const nome = String(v.nome);
        const existentes = await this.prisma.local.findMany({ select: { id: true, nome: true } });
        const achado = existentes.find((l) => normalizar(l.nome) === linha.chave);
        const dados = {
          logradouro: String(v.logradouro),
          cidade: String(v.cidade),
          uf: String(v.uf),
          tipo: this.tipoLocal(v.tipo),
          lat: v.lat === undefined ? undefined : Number(v.lat),
          lng: v.lng === undefined ? undefined : Number(v.lng),
        };
        if (achado) {
          await this.prisma.local.update({ where: { id: achado.id }, data: dados });
          return "atualizado";
        }
        await this.prisma.local.create({
          data: { nome, ...dados, criadoPorId: args.usuarioId },
        });
        return "criado";
      }

      case "motoristas":
        return this.gravarMotorista(linha, args.usuarioId, avisos);
    }
  }

  /**
   * O motorista é o caso especial, e por um motivo de plataforma: a PESSOA pode
   * já existir (roda pra outra transportadora, ou se cadastrou sozinha no app).
   * Nesse caso o vínculo nasce como CONVITE e a senha é a dela — criar outra
   * daria duas senhas pro mesmo CPF, e uma pararia de funcionar na primeira
   * troca.
   */
  private async gravarMotorista(
    linha: LinhaValidada,
    usuarioId: string,
    avisos: string[],
  ): Promise<"criado" | "atualizado"> {
    const v = linha.valores;
    const cpf = String(v.cpf);
    const nome = String(v.nome);
    const telefone = v.telefone === undefined ? null : String(v.telefone).replace(/\D/g, "");
    const email = v.email === undefined ? null : String(v.email);

    const jaNaConta = await this.prisma.motorista.findFirst({ where: { cpf } });
    if (jaNaConta) {
      await this.prisma.motorista.update({
        where: { id: jaNaConta.id },
        data: { nome, ...(telefone ? { telefone } : {}), ...(email ? { email } : {}) },
      });
      return "atualizado";
    }

    const identidade = await this.identidades.garantirPorCpf(cpf);
    // Senha aleatória pra quem ainda não existe na plataforma: ela nunca é
    // mostrada nem usada. O caminho de entrada dele é o "esqueci minha senha"
    // pelo celular — por isso o aviso quando o telefone não veio na planilha.
    const senhaHash =
      identidade?.senhaHash ?? (await AuthService.hashPassword(randomBytes(24).toString("hex")));

    const pessoa =
      identidade ??
      (await this.identidades.criar({ cpf, nome, telefone: telefone ?? undefined, email: email ?? undefined, senhaHash }));

    if (!identidade && !telefone) {
      avisos.push(
        `${nome} entrou sem telefone — sem ele não dá pra mandar o convite do app nem recuperar a senha.`,
      );
    }

    await this.prisma.motorista.create({
      data: {
        identidadeId: pessoa.id,
        // Pessoa que já existe é dona do próprio cadastro: o nome e o telefone
        // que valem são os dela, não os que vieram na planilha da empresa.
        nome: identidade ? identidade.nome : nome,
        cpf,
        senhaHash,
        telefone: identidade ? identidade.telefone : telefone,
        email: identidade ? identidade.email : email,
        ...(identidade
          ? { aceite: "PENDENTE" as const, convidadoPorId: usuarioId, convidadoEm: new Date() }
          : {}),
        criadoPorId: usuarioId,
      },
    });
    return "criado";
  }

  private tipoLocal(bruto: unknown): TipoLocal {
    const t = normalizar(String(bruto ?? ""));
    if (t.includes("descarga") || t === "destino" || t === "obra") return TipoLocal.DESCARGA;
    if (t.includes("carga") && !t.includes("descarga")) return TipoLocal.CARGA;
    // Em branco entra como AMBOS: é o valor que não impede nada, e o contrário
    // (chutar CARGA) esconderia o local na busca de destino.
    return TipoLocal.AMBOS;
  }

  private lista(bruto: unknown): string[] {
    if (bruto === undefined || bruto === null) return [];
    return String(bruto)
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private entidade(chave: string): EntidadeImportavel {
    const e = ENTIDADE_POR_CHAVE.get(chave as EntidadeImportavel["chave"]);
    if (!e) throw new BadRequestException(`Não sei importar "${chave}".`);
    return e;
  }
}
