import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { TipoLocal } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthService } from "../../auth/auth.service";
import { IdentidadeService } from "../../auth/identidade.service";
import { AcessoAppService } from "../../common/acesso-app/acesso-app.service";
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
    private readonly acessoApp: AcessoAppService,
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
    // Zera o cache de cadastros a cada importação: entre uma subida e outra o
    // usuário acabou de cadastrar o que faltava, e reaproveitar o mapa velho
    // devolveria "motorista não cadastrado" pra quem ele acabou de criar.
    this.contexto = null;
    this.ocorrencias = new Map();
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

    // Quem entrou pela planilha nasce no padrão de acesso da empresa, na hora.
    if (entidade.chave === "motoristas" && criados > 0) {
      this.acessoApp.agendarRecalculo("MOTORISTA_IMPORTADO");
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
        if (!args.empresaId) throw new BadRequestException("Escolha o cliente dessas obras.");
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

      case "viagens":
        return this.gravarViagem(linha, avisos);
    }
  }

  /**
   * Uma viagem do histórico.
   *
   * Ela é a única entidade que aponta pra todas as outras, e por isso não cria
   * NENHUMA delas: placa desconhecida vira erro na linha com o nome do que
   * faltou. Criar um veículo em silêncio no meio de uma importação de viagens é
   * como se monta uma frota fantasma que ninguém sabe de onde veio.
   *
   * Entra como ENVIADA — o mesmo status de uma viagem lançada pelo app e ainda
   * não conferida. É o que faz ela contar em fechamento e KPI sem se passar por
   * conferida por alguém que nunca a viu.
   */
  private async gravarViagem(
    linha: LinhaValidada,
    avisos: string[],
  ): Promise<"criado" | "atualizado" | "pulado"> {
    const v = linha.valores;
    const ctx = await this.contextoDeViagens();

    const motorista = this.acharMotorista(String(v.motorista), ctx);
    if (!motorista) {
      avisos.push(`Linha ${linha.numero}: motorista "${v.motorista}" não está cadastrado.`);
      return "pulado";
    }
    const veiculo = ctx.veiculos.get(String(v.placa));
    if (!veiculo) {
      avisos.push(`Linha ${linha.numero}: veículo ${v.placa} não está cadastrado.`);
      return "pulado";
    }

    // `clientId` é a chave de idempotência da Viagem — no app ele é gerado pelo
    // celular. Aqui é derivado do que identifica a viagem na planilha, pra que
    // subir o arquivo duas vezes não crie o histórico em dobro.
    const assinatura = [
      String(v.data),
      motorista.id,
      veiculo.id,
      String(v.ticket ?? ""),
      String(v.toneladas ?? ""),
    ].join("|");
    // Duas viagens REALMENTE iguais no mesmo dia (mesmo motorista, mesmo
    // caminhão, sem ticket) existem — é o dia inteiro puxando brita da mesma
    // pedreira. O contador as separa sem inventar dado e sem colapsar em uma.
    const ocorrencia = (this.ocorrencias.get(assinatura) ?? 0) + 1;
    this.ocorrencias.set(assinatura, ocorrencia);
    const clientId = `import:${createHash("sha1")
      .update(`${assinatura}|${ocorrencia}`)
      .digest("hex")}`;

    const dados = {
      motoristaId: motorista.id,
      veiculoId: veiculo.id,
      data: new Date(`${String(v.data)}T00:00:00.000Z`),
      clienteId: v.cliente === undefined ? null : (ctx.clientes.get(normalizar(String(v.cliente))) ?? null),
      materialId: v.material === undefined ? null : (ctx.materiais.get(normalizar(String(v.material))) ?? null),
      localCargaId: v.origem === undefined ? null : (ctx.locais.get(normalizar(String(v.origem))) ?? null),
      localDescargaId:
        v.destino === undefined ? null : (ctx.locais.get(normalizar(String(v.destino))) ?? null),
      toneladas: v.toneladas === undefined ? null : new Prisma.Decimal(v.toneladas),
      km: v.km === undefined ? null : new Prisma.Decimal(v.km),
      ticket: v.ticket === undefined ? null : String(v.ticket),
      valorPedagioTotal:
        v.valorPedagio === undefined ? null : new Prisma.Decimal(v.valorPedagio),
    };

    // O que a planilha cita e o cadastro não tem vira aviso, não erro: a viagem
    // com cliente em branco continua valendo pro km e pro peso do histórico, e
    // perder a linha inteira por causa de um nome escrito diferente seria pior.
    for (const [campo, valor, resolvido] of [
      ["obra", v.cliente, dados.clienteId],
      ["material", v.material, dados.materialId],
      ["local de carga", v.origem, dados.localCargaId],
      ["local de descarga", v.destino, dados.localDescargaId],
    ] as const) {
      if (valor !== undefined && resolvido === null) {
        avisos.push(`Linha ${linha.numero}: ${campo} "${valor}" não tem cadastro — ficou em branco.`);
      }
    }

    const existente = await this.prisma.viagem.findUnique({
      where: { clientId },
      select: { id: true },
    });
    const viagem = existente
      ? await this.prisma.viagem.update({ where: { id: existente.id }, data: dados })
      : await this.prisma.viagem.create({
          // Sem `revisadoPorId`: a Viagem não tem "criado por", e carimbar o
          // revisor CONGELA a viagem no fechamento. Quem importou fica no log
          // da importação, não numa viagem que ninguém conferiu.
          data: { clientId, ...dados, status: "ENVIADA" },
        });

    await this.gravarValor(viagem.id, v);
    return existente ? "atualizado" : "criado";
  }

  /**
   * O dinheiro da viagem importada.
   *
   * `base: VIAGEM` porque o que a planilha traz é o total combinado, não um
   * preço unitário: inventar "R$/tonelada" dividindo o total pelo peso criaria
   * um preço que nunca existiu e que apareceria como se fosse tabela.
   */
  private async gravarValor(viagemId: string, v: Record<string, string | number>) {
    if (v.valorFrete === undefined) return;
    const valorFrete = new Prisma.Decimal(v.valorFrete);
    const valorPedagio = new Prisma.Decimal(v.valorPedagio ?? 0);
    await this.prisma.viagemValor.upsert({
      where: { viagemId },
      create: {
        viagemId,
        base: "VIAGEM",
        precoUnitario: valorFrete,
        quantidade: new Prisma.Decimal(1),
        valorFrete,
        valorPedagio,
        valorTotal: valorFrete.add(valorPedagio),
        alteracaoMotivo: "Importado do histórico da empresa",
      },
      update: {
        base: "VIAGEM",
        precoUnitario: valorFrete,
        quantidade: new Prisma.Decimal(1),
        valorFrete,
        valorPedagio,
        valorTotal: valorFrete.add(valorPedagio),
      },
    });
  }

  /**
   * Os cadastros, em memória, pra casar nome com id.
   *
   * Uma consulta por linha faria 400 idas ao banco numa planilha de 400
   * viagens; os cadastros de uma transportadora cabem todos na memória.
   */
  private async contextoDeViagens() {
    if (this.contexto) return this.contexto;
    const [motoristas, veiculos, clientes, materiais, locais] = await Promise.all([
      this.prisma.motorista.findMany({ select: { id: true, cpf: true, nome: true } }),
      this.prisma.veiculo.findMany({ select: { id: true, placa: true } }),
      this.prisma.cliente.findMany({ select: { id: true, nome: true } }),
      this.prisma.material.findMany({ select: { id: true, nome: true } }),
      this.prisma.local.findMany({ select: { id: true, nome: true } }),
    ]);
    this.contexto = {
      motoristasPorCpf: new Map(motoristas.map((m) => [m.cpf, m])),
      motoristasPorNome: new Map(motoristas.map((m) => [normalizar(m.nome), m])),
      veiculos: new Map(veiculos.map((v) => [v.placa, v])),
      clientes: new Map(clientes.map((c) => [normalizar(c.nome), c.id])),
      materiais: new Map(materiais.map((m) => [normalizar(m.nome), m.id])),
      locais: new Map(locais.map((l) => [normalizar(l.nome), l.id])),
    };
    return this.contexto;
  }

  /**
   * Quantas vezes a mesma assinatura de viagem já apareceu NESTE arquivo.
   *
   * Zerado a cada importação. É o que dá um `clientId` estável pra cada linha:
   * subir a mesma planilha de novo reencontra as mesmas viagens; subir uma
   * planilha com as linhas em outra ordem, não — e é por isso que a tela pede a
   * coluna do ticket quando ela existe.
   */
  private ocorrencias = new Map<string, number>();

  private contexto: {
    motoristasPorCpf: Map<string, { id: string; nome: string }>;
    motoristasPorNome: Map<string, { id: string; nome: string }>;
    veiculos: Map<string, { id: string }>;
    clientes: Map<string, string>;
    materiais: Map<string, string>;
    locais: Map<string, string>;
  } | null = null;

  /** CPF primeiro: casa com certeza. Nome é o caminho de quem não tem a coluna. */
  private acharMotorista(
    bruto: string,
    ctx: NonNullable<ImportacaoService["contexto"]>,
  ): { id: string } | null {
    const digitos = bruto.replace(/\D/g, "");
    if (digitos.length === 11) return ctx.motoristasPorCpf.get(digitos) ?? null;
    return ctx.motoristasPorNome.get(normalizar(bruto)) ?? null;
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
