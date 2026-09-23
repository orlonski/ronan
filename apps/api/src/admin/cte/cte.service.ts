import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { contaIdAtual } from "../../common/conta/conta-context";
import { soDigitos } from "../../common/chave-fiscal";
import {
  montarCte,
  type ConfigFiscal,
  type Emitente,
  type EntradaCte,
  type PapelTomador,
  type Participante,
  type RegraIcms,
  type ResponsavelTecnico,
  valorDaCarga,
} from "../../common/cte/montar";
import { validarCte, type Validacao } from "../../common/cte/validar";
import { gerarXmlCte } from "../../common/cte/xml";
import { validarContraXsd, type ErroXsd } from "../../common/cte/xsd";
import { GatewayCte, SefazDireto, SimuladorCte, type EmissorCte } from "./emissor";
import { cifrar, decifrar, lerCertificado } from "../../common/cte/assinatura";
import { MODELO_CTE } from "../../common/cte/chave";
import { gerarDacte } from "../../common/cte/dacte";
import { escolherTomador } from "../../common/cte/tomador";

/**
 * Emitir o CT-e de uma viagem.
 *
 * A ordem aqui é deliberada e é o que separa este serviço de um wrapper de API:
 *
 *   1. monta a entrada a partir dos cadastros
 *   2. VALIDA offline — e só então
 *   3. consome um número da série
 *
 * Número é recurso escasso e auditável: a SEFAZ pergunta por buraco na
 * numeração. Gastar um número num documento que a validação local já sabia que
 * ia falhar cria um buraco que alguém vai ter que justificar depois. Por isso a
 * prévia não consome nada e a emissão só consome depois de passar.
 */
@Injectable()
export class CteService {
  private readonly log = new Logger(CteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Quem desenvolveu o sistema — o `infRespTec` do CT-e.
   *
   * Vem de env porque é o MESMO pra todas as contas: é sempre a mesma
   * desenvolvedora, não um dado de cada transportadora. Ausente devolve null e
   * a prévia avisa; não trava, porque a obrigatoriedade varia e uma env
   * esquecida não pode impedir uma emissão que o gateway aceitaria.
   */
  private responsavelTecnico(): ResponsavelTecnico | null {
    const cnpj = soDigitos(this.config.get<string>("RESP_TECNICO_CNPJ") ?? "");
    if (cnpj.length !== 14) return null;
    return {
      cnpj,
      contato: this.config.get<string>("RESP_TECNICO_CONTATO") ?? "",
      email: this.config.get<string>("RESP_TECNICO_EMAIL") ?? "",
      telefone: this.config.get<string>("RESP_TECNICO_FONE") ?? "",
    };
  }

  // -------------------------------------------------------------------------
  // Numeração
  // -------------------------------------------------------------------------

  /** O próximo número SEM consumir — só pra mostrar na prévia. */
  private async espiarNumero(modelo: string, serie: number): Promise<number> {
    const seq = await this.prisma.sequenciaFiscal.findFirst({ where: { modelo, serie } });
    return seq?.proximo ?? 1;
  }

  /**
   * Consome um número. `UPDATE ... RETURNING` é atômico: dois usuários
   * emitindo ao mesmo tempo recebem números diferentes. Ler o máximo e somar um
   * daria o mesmo número pros dois, e a SEFAZ recusaria o segundo.
   */
  private async consumirNumero(contaId: string, modelo: string, serie: number): Promise<number> {
    const linhas = await this.prisma.$queryRaw<{ proximo: number }[]>`
      UPDATE "sequencias_fiscais"
         SET "proximo" = "proximo" + 1
       WHERE "contaId" = ${contaId} AND "modelo" = ${modelo} AND "serie" = ${serie}
      RETURNING "proximo" - 1 AS "proximo"
    `;
    if (linhas.length > 0) return linhas[0]!.proximo;

    // Primeira emissão desta série: cria a linha já consumindo o 1.
    await this.prisma.sequenciaFiscal.create({
      data: { contaId, modelo, serie, proximo: 2 },
    });
    return 1;
  }

  // -------------------------------------------------------------------------
  // Montagem a partir dos cadastros
  // -------------------------------------------------------------------------

  private participanteDoLocal(
    local: {
      nome: string;
      cnpjCpf: string | null;
      razaoSocialFiscal: string | null;
      inscricaoEstadual: string | null;
      indicadorIe: string | null;
      logradouro: string;
      numero: string | null;
      bairro: string | null;
      cidade: string;
      uf: string;
      cep: string | null;
      codigoMunicipioIbge: string | null;
    } | null,
    papel: string,
  ): Participante {
    if (!local) throw new BadRequestException(`A viagem está sem o local de ${papel}.`);
    return {
      cnpjCpf: soDigitos(local.cnpjCpf ?? ""),
      razaoSocial: local.razaoSocialFiscal?.trim() || local.nome,
      inscricaoEstadual: local.inscricaoEstadual,
      indicadorIe: (local.indicadorIe as "1" | "2" | "9") ?? "9",
      endereco: {
        logradouro: local.logradouro,
        numero: local.numero ?? "S/N",
        bairro: local.bairro ?? "CENTRO",
        codigoMunicipio: local.codigoMunicipioIbge ?? "",
        municipio: local.cidade,
        cep: local.cep,
        uf: local.uf,
      },
    };
  }

  private regraIcms(c: {
    cteIcmsTipo: string | null;
    cteIcmsAliquota: Prisma.Decimal | null;
    cteIcmsReducao: Prisma.Decimal | null;
    cteIcmsCst: string | null;
  }): RegraIcms {
    const aliq = c.cteIcmsAliquota == null ? 0 : Number(c.cteIcmsAliquota);
    const red = c.cteIcmsReducao == null ? 0 : Number(c.cteIcmsReducao);
    switch (c.cteIcmsTipo) {
      case "SN":
        return { tipo: "SN" };
      case "00":
        return { tipo: "00", aliquota: aliq };
      case "20":
        return { tipo: "20", aliquota: aliq, reducaoBase: red };
      case "45":
        return { tipo: "45", cst: (c.cteIcmsCst as "40" | "41" | "51") ?? "41" };
      case "60":
        return { tipo: "60" };
      case "90":
        return { tipo: "90", aliquota: aliq, reducaoBase: red || undefined };
      default:
        throw new BadRequestException(
          "Falta configurar o ICMS do CT-e em Configurações → Emissão de CT-e. O sistema não escolhe tributo.",
        );
    }
  }

  /**
   * Monta a entrada do CT-e a partir da viagem.
   *
   * Quem é quem: o local de CARGA é o remetente (de onde a mercadoria sai), o
   * local de DESCARGA é o destinatário. O tomador — quem paga — é uma escolha
   * de cadastro, e não uma dedução: frete CIF a pedreira paga, FOB a obra paga,
   * e o sistema não tem como saber olhando a viagem.
   */
  async montarEntrada(viagemId: string): Promise<{ entrada: EntradaCte; conta: { id: string } }> {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      include: {
        localCarga: true,
        localDescarga: true,
        material: true,
        // A obra e o cliente que paga: o tomador sai de um dos dois.
        cliente: { include: { empresa: true } },
        valor: true,
      },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada.");

    // `Conta` é model global: a trava de multi-tenant NÃO filtra aqui. Sem o
    // alvo explícito isto devolveria a linha de qualquer empresa — e o CT-e
    // sairia com o CNPJ de outra transportadora.
    const conta = await this.prisma.conta.findUniqueOrThrow({
      where: { id: contaIdAtual() },
    });

    if (!conta.cnpj) {
      throw new BadRequestException(
        "A empresa está sem CNPJ. Preencha em Configurações → Minha empresa antes de emitir.",
      );
    }
    if (!conta.cteNaturezaCfop || !conta.cteNaturezaOperacao) {
      throw new BadRequestException(
        "Falta configurar o CFOP e a natureza da operação em Configurações → Emissão de CT-e.",
      );
    }

    const emitente: Emitente = {
      cnpjCpf: soDigitos(conta.cnpj),
      razaoSocial: conta.razaoSocial?.trim() || conta.nome,
      nomeFantasia: conta.nome,
      inscricaoEstadual: conta.inscricaoEstadual,
      // Quem emite CT-e é transportadora, e transportadora é contribuinte de
      // ICMS — não é escolha de cadastro, é o que o documento significa. Fica
      // fixo aqui pra que a falta da IE apareça como o que é (cadastro
      // incompleto) em vez de virar um CT-e de "não contribuinte" que a SEFAZ
      // autoriza e o contador descobre depois.
      indicadorIe: "1",
      crt: (conta.crt as "1" | "2" | "3") ?? "3",
      rntrc: conta.rntrc ?? "",
      telefone: conta.telefoneFiscal,
      endereco: {
        logradouro: conta.logradouro ?? "",
        numero: conta.numero ?? "S/N",
        complemento: conta.complemento,
        bairro: conta.bairro ?? "",
        codigoMunicipio: conta.codigoMunicipioIbge ?? "",
        municipio: conta.municipio ?? "",
        cep: conta.cep,
        uf: conta.uf ?? "",
      },
    };

    const remetente = this.participanteDoLocal(viagem.localCarga, "carga");
    const destinatario = this.participanteDoLocal(viagem.localDescarga, "descarga");

    // O tomador — quem paga. A regra (obra com CNPJ próprio, senão o cliente
    // que paga, senão o destinatário) mora em common/cte/tomador.ts.
    const { papelTomador, tomadorOutro } = escolherTomador({
      obra: viagem.cliente,
      pagador: viagem.cliente?.empresa ?? null,
      remetente,
      destinatario,
    });

    const config: ConfigFiscal = {
      naturezaCfop: conta.cteNaturezaCfop,
      naturezaOperacao: conta.cteNaturezaOperacao,
      serie: conta.cteSerie ?? 1,
      icms: this.regraIcms(conta),
    };

    const entrada: EntradaCte = {
      emitente,
      remetente,
      destinatario,
      papelTomador,
      tomadorOutro,
      inicioPrestacao: {
        codigo: viagem.localCarga?.codigoMunicipioIbge ?? "",
        nome: viagem.localCarga?.cidade ?? "",
        uf: viagem.localCarga?.uf ?? "",
      },
      fimPrestacao: {
        codigo: viagem.localDescarga?.codigoMunicipioIbge ?? "",
        nome: viagem.localDescarga?.cidade ?? "",
        uf: viagem.localDescarga?.uf ?? "",
      },
      carga: {
        produtoPredominante: viagem.material?.nome ?? "CARGA GERAL",
        toneladas: viagem.toneladas == null ? 0 : Number(viagem.toneladas),
        // O valor da MERCADORIA, que o CT-e exige no modal rodoviário
        // (rejeição 581) e que não é o valor do frete. Duas fontes, nesta
        // ordem: o valor real da viagem, quando alguém o conhece (veio da
        // NF-e), e a referência por tonelada do material como aproximação.
        // Aproximação nunca passa por cima de número sabido.
        valorCarga: valorDaCarga(viagem),
        chaveNfe: viagem.nfeChave,
        documentoAvulso: viagem.ticket,
      },
      valores: {
        // O valor do frete sai de `ViagemValor` — a fonte materializada e
        // congelada. Recalcular aqui poderia divergir do que já foi faturado.
        valorFrete: viagem.valor ? Number(viagem.valor.valorFrete) : 0,
        valorPedagio: viagem.valor ? Number(viagem.valor.valorPedagio) : null,
      },
      config,
      numero: await this.espiarNumero(MODELO_CTE, config.serie),
      responsavelTecnico: this.responsavelTecnico(),
      emitidoEm: new Date(),
      ambiente: (conta.cteAmbiente as 1 | 2) ?? 2,
    };

    return { entrada, conta: { id: conta.id } };
  }

  /** Monta e valida SEM consumir número nem gravar nada. */
  async previa(viagemId: string): Promise<{
    validacao: Validacao;
    leiaute: ErroXsd[];
    numeroPrevisto: number;
    ambiente: number;
    emissor: string;
    cte: ReturnType<typeof montarCte> | null;
  }> {
    const { entrada } = await this.montarEntrada(viagemId);
    const validacao = validarCte(entrada);

    // Só monta se as regras passaram: montar com dado faltando lançaria antes
    // de a tela conseguir mostrar a lista de pendências, que é o que o usuário
    // precisa ver.
    const cte = validacao.ok ? montarCte(entrada) : null;

    // E aí o leiaute, contra o XSD oficial. As regras de cima são as do
    // negócio; esta é a do documento — tamanho de campo, enumeração, ordem.
    // Uma passa sem a outra, e as duas precisam passar.
    const leiaute = cte ? (await validarContraXsd(gerarXmlCte(cte))).erros : [];

    return {
      validacao,
      leiaute,
      numeroPrevisto: entrada.numero,
      ambiente: entrada.ambiente,
      emissor: await this.nomeDoEmissor(),
      cte,
    };
  }

  private async nomeDoEmissor(): Promise<string> {
    const c = await this.prisma.conta.findUniqueOrThrow({
      where: { id: contaIdAtual() },
      select: { cteEmissor: true },
    });
    return c.cteEmissor ?? "SIMULADOR";
  }

  /**
   * O certificado A1 da conta, aberto.
   *
   * A chave de decifra vem de env e nunca do banco: é o que faz um dump do
   * Postgres não carregar o poder de assinar em nome de cada cliente.
   */
  private async certificadoDaConta() {
    const chave = this.config.get<string>("CERTIFICADO_CHAVE");
    if (!chave) {
      throw new BadRequestException(
        "Falta a variável CERTIFICADO_CHAVE no servidor. Sem ela o certificado não pode ser lido.",
      );
    }
    const linha = await this.prisma.certificadoDigital.findUnique({
      where: { contaId: contaIdAtual() },
    });
    if (!linha) {
      throw new BadRequestException(
        "Nenhum certificado digital cadastrado. Suba o A1 em Configurações → Emissão de CT-e.",
      );
    }
    if (linha.validoAte.getTime() < Date.now()) {
      // Certificado vencido não assina, e o erro da SEFAZ não diz isso com
      // clareza. Barrar aqui economiza a viagem e o número da série.
      throw new BadRequestException(
        `O certificado venceu em ${linha.validoAte.toLocaleDateString("pt-BR")}. Suba o novo antes de emitir.`,
      );
    }
    const pfx = decifrar(Buffer.from(linha.arquivo), chave);
    const senha = decifrar(Buffer.from(linha.senha), chave).toString("utf8");
    return { cert: lerCertificado(pfx, senha), pfx, senha, linha };
  }

  private async emissorDaConta(): Promise<EmissorCte> {
    const c = await this.prisma.conta.findUniqueOrThrow({
      where: { id: contaIdAtual() },
      select: {
        cteEmissor: true,
        cteGatewayUrl: true,
        cteGatewayToken: true,
        cteUfAutorizador: true,
        uf: true,
      },
    });

    if (c.cteEmissor === "SEFAZ") {
      const { cert, pfx, senha } = await this.certificadoDaConta();
      const uf = c.cteUfAutorizador ?? c.uf;
      if (!uf) {
        throw new BadRequestException("Falta dizer por qual UF a empresa emite.");
      }
      return new SefazDireto(cert, pfx, senha, uf);
    }

    if (c.cteEmissor === "GATEWAY") {
      if (!c.cteGatewayUrl || !c.cteGatewayToken) {
        throw new BadRequestException(
          "O emissor está como gateway, mas a URL ou o token não estão configurados.",
        );
      }
      return new GatewayCte({ url: c.cteGatewayUrl, token: c.cteGatewayToken });
    }
    return new SimuladorCte();
  }

  /**
   * Guarda o A1.
   *
   * Os metadados saem do PRÓPRIO arquivo — CNPJ, titular e validade. Digitar
   * qualquer um deles seria a brecha pra cadastrar o certificado de uma empresa
   * dizendo que é de outra.
   */
  async salvarCertificado(pfx: Buffer, senha: string, usuarioId: string) {
    const chave = this.config.get<string>("CERTIFICADO_CHAVE");
    if (!chave) {
      throw new BadRequestException("Falta a variável CERTIFICADO_CHAVE no servidor.");
    }
    // Abre antes de guardar: arquivo que não abre não entra no banco.
    const cert = lerCertificado(pfx, senha);
    if (cert.validoAte.getTime() < Date.now()) {
      throw new BadRequestException(
        `Esse certificado venceu em ${cert.validoAte.toLocaleDateString("pt-BR")}.`,
      );
    }

    const contaId = contaIdAtual();
    const conta = await this.prisma.conta.findUniqueOrThrow({
      where: { id: contaId },
      select: { cnpj: true },
    });
    // O CNPJ do certificado tem que ser o da empresa. Sem esta conferência o
    // sistema assinaria documento de uma transportadora com o A1 de outra.
    if (conta.cnpj && cert.cnpj && soDigitos(conta.cnpj) !== cert.cnpj) {
      throw new BadRequestException(
        `Esse certificado é do CNPJ ${cert.cnpj}, e a empresa é ${soDigitos(conta.cnpj)}.`,
      );
    }

    const dados = {
      // `Uint8Array` e não `Buffer`: o tipo do Prisma para `Bytes` é o genérico,
      // e um `Buffer` cru não casa com ele no TypeScript.
      arquivo: new Uint8Array(cifrar(pfx, chave)),
      senha: new Uint8Array(cifrar(Buffer.from(senha, "utf8"), chave)),
      cnpj: cert.cnpj,
      titular: cert.titular,
      validoDe: cert.validoDe,
      validoAte: cert.validoAte,
      criadoPorId: usuarioId,
    };
    await this.prisma.certificadoDigital.upsert({
      where: { contaId },
      create: { contaId, ...dados },
      update: dados,
    });

    this.log.log(`certificado de ${cert.titular} guardado (vence ${cert.validoAte.toISOString()})`);
    return this.certificadoResumo();
  }

  /** O que a tela mostra. NUNCA o arquivo nem a senha. */
  async certificadoResumo() {
    const c = await this.prisma.certificadoDigital.findUnique({
      where: { contaId: contaIdAtual() },
      select: { cnpj: true, titular: true, validoDe: true, validoAte: true, criadoEm: true },
    });
    if (!c) return null;
    const diasParaVencer = Math.floor((c.validoAte.getTime() - Date.now()) / 86_400_000);
    return { ...c, diasParaVencer, vencido: diasParaVencer < 0 };
  }

  /**
   * "A SEFAZ está no ar e o meu certificado serve?"
   *
   * A única chamada que não precisa de documento nenhum — e por isso a primeira
   * que se faz: prova certificado, cadeia, credenciamento e rede de uma vez,
   * sem arriscar um CT-e nem queimar um número da série.
   */
  async testarConexao() {
    const emissor = await this.emissorDaConta();
    if (!(emissor instanceof SefazDireto)) {
      throw new BadRequestException(
        "O teste de conexão vale pro emissor SEFAZ. Hoje a empresa está configurada de outro jeito.",
      );
    }
    const c = await this.prisma.conta.findUniqueOrThrow({
      where: { id: contaIdAtual() },
      select: { cteAmbiente: true },
    });
    try {
      const r = await emissor.status((c.cteAmbiente as 1 | 2) ?? 2);
      return { ok: r.cStat === "107", codigo: r.cStat, motivo: r.xMotivo };
    } catch (e) {
      return { ok: false, codigo: null, motivo: (e as Error).message };
    }
  }

  // -------------------------------------------------------------------------
  // Emissão de teste
  // -------------------------------------------------------------------------

  /**
   * Série reservada pro teste.
   *
   * 999 e uma sequência própria: a emissão de teste passa pelo MESMO caminho da
   * de verdade — é esse o ponto —, e sem série separada ela gastaria número da
   * numeração fiscal real. Buraco na numeração é coisa que a SEFAZ pergunta, e
   * "foi um teste" não é resposta que se dê ao fisco.
   */
  private static readonly SERIE_TESTE = 999;

  /**
   * Emite um CT-e sintético contra a SEFAZ de homologação.
   *
   * Serve pra responder, em um clique, a pergunta que nenhum teste de unidade
   * responde: "o que a SEFAZ diz do MEU documento, com o MEU certificado?".
   *
   * A rejeição é resultado válido — na maioria das vezes é a resposta esperada,
   * e ela vem com código e motivo em português da própria SEFAZ, que é
   * infinitamente mais útil que qualquer suposição nossa sobre o que falta.
   *
   * Os participantes são a própria empresa, dos dois lados. Inventar um CNPJ de
   * terceiro seria pôr no ar um documento citando alguém que não sabe disso.
   */
  async emitirTeste(usuarioId: string) {
    const contaId = contaIdAtual();
    const conta = await this.prisma.conta.findUniqueOrThrow({ where: { id: contaId } });

    if (conta.cteEmissor !== "SEFAZ") {
      throw new BadRequestException(
        "A emissão de teste vale pro emissor SEFAZ — é ela que prova o caminho até lá.",
      );
    }
    if (!conta.cnpj) throw new BadRequestException("Falta o CNPJ da empresa.");
    if (!conta.codigoMunicipioIbge || !conta.uf) {
      throw new BadRequestException(
        "Falta o endereço fiscal com código IBGE do município em Minha empresa.",
      );
    }

    const municipio = {
      codigo: conta.codigoMunicipioIbge,
      nome: conta.municipio ?? "",
      uf: conta.uf,
    };
    const eu: Participante = {
      cnpjCpf: soDigitos(conta.cnpj),
      razaoSocial: conta.razaoSocial?.trim() || conta.nome,
      inscricaoEstadual: conta.inscricaoEstadual,
      // O MESMO fato da emissão real: contribuinte, sempre. Antes isto era
      // deduzido da presença da IE, e a emissão de teste passava num cadastro
      // que a real recusaria — teste que mente sobre o que vai acontecer é
      // pior do que teste nenhum.
      indicadorIe: "1",
      endereco: {
        logradouro: conta.logradouro ?? "RUA DE TESTE",
        numero: conta.numero ?? "S/N",
        bairro: conta.bairro ?? "CENTRO",
        codigoMunicipio: conta.codigoMunicipioIbge,
        municipio: conta.municipio ?? "",
        cep: conta.cep,
        uf: conta.uf,
      },
    };

    const serie = CteService.SERIE_TESTE;
    const numero = await this.consumirNumero(contaId, MODELO_CTE, serie);

    const entrada: EntradaCte = {
      emitente: {
        ...eu,
        crt: (conta.crt as "1" | "2" | "3") ?? "3",
        rntrc: conta.rntrc ?? "00000000",
      },
      remetente: eu,
      destinatario: eu,
      papelTomador: "DESTINATARIO",
      inicioPrestacao: municipio,
      fimPrestacao: municipio,
      carga: {
        produtoPredominante: "TESTE DE HOMOLOGACAO",
        toneladas: 1,
        valorCarga: 1,
        documentoAvulso: "TESTE",
      },
      valores: { valorFrete: 1 },
      config: {
        naturezaCfop: conta.cteNaturezaCfop ?? "353",
        naturezaOperacao: conta.cteNaturezaOperacao ?? "TESTE DE HOMOLOGACAO",
        serie,
        icms: this.regraIcms(conta),
      },
      numero,
      emitidoEm: new Date(),
      // SEMPRE homologação, mesmo que a conta esteja apontada pra produção: uma
      // emissão de teste que vira documento fiscal de verdade é o pior acidente
      // possível aqui, e ele não pode depender de ninguém lembrar.
      ambiente: 2,
      responsavelTecnico: this.responsavelTecnico(),
    };

    const cte = montarCte(entrada);
    const xml = gerarXmlCte(cte);
    const leiaute = await validarContraXsd(xml);

    const doc = await this.prisma.documentoFiscal.create({
      data: {
        modelo: MODELO_CTE,
        serie,
        numero,
        chave: cte.chave,
        ambiente: 2,
        emissor: "SEFAZ",
        status: "ENVIADO",
        payload: cte as unknown as Prisma.InputJsonValue,
        xml,
        motivo: "Emissão de teste — série reservada, sem valor fiscal",
        criadoPorId: usuarioId,
      },
    });

    const emissor = await this.emissorDaConta();
    const r = await emissor.emitir(cte, 2);

    const atualizado = await this.prisma.documentoFiscal.update({
      where: { id: doc.id },
      data:
        r.situacao === "AUTORIZADO"
          ? {
              status: "AUTORIZADO",
              protocolo: r.protocolo,
              autorizadoEm: r.autorizadoEm,
              codigoRetorno: r.codigo,
              motivo: r.motivo,
              xml: r.xml ?? xml,
              retorno: r.cru as Prisma.InputJsonValue,
            }
          : r.situacao === "REJEITADO"
            ? {
                status: "REJEITADO",
                codigoRetorno: r.codigo,
                motivo: r.motivo,
                retorno: r.cru as Prisma.InputJsonValue,
              }
            : { status: "ERRO", motivo: r.motivo, retorno: (r.cru ?? {}) as Prisma.InputJsonValue },
    });

    this.log.log(`emissão de teste ${numero}/${serie}: ${atualizado.status} — ${atualizado.motivo}`);
    return {
      documentoId: atualizado.id,
      situacao: r.situacao,
      codigo: atualizado.codigoRetorno,
      motivo: atualizado.motivo,
      chave: cte.chave,
      leiauteOk: leiaute.ok,
      erroDeLeiaute: leiaute.erros.map((e) => e.mensagem),
    };
  }

  // -------------------------------------------------------------------------
  // Emissão
  // -------------------------------------------------------------------------

  async emitir(viagemId: string, usuarioId: string) {
    const jaTem = await this.prisma.documentoFiscal.findFirst({
      where: { viagemId, modelo: MODELO_CTE, status: { in: ["AUTORIZADO", "ENVIADO"] } },
    });
    if (jaTem) {
      throw new BadRequestException(
        `Esta viagem já tem o CT-e ${jaTem.numero} (${jaTem.status.toLowerCase()}). Cancele antes de emitir outro.`,
      );
    }

    const { entrada, conta } = await this.montarEntrada(viagemId);
    const validacao = validarCte(entrada);
    if (!validacao.ok) {
      // Não consome número: buraco na numeração é coisa que a SEFAZ pergunta.
      throw new BadRequestException({
        message: "O CT-e não pode ser emitido ainda.",
        pendencias: validacao.erros,
      });
    }

    // Daqui pra frente o número está gasto, mesmo se a emissão falhar. É
    // deliberado: num timeout não dá pra saber se o documento chegou à SEFAZ, e
    // reaproveitar o número correria o risco de duplicar um CT-e autorizado —
    // muito pior que um buraco na numeração, que se justifica com um relatório.
    // O leiaute é conferido com o número que SERÁ usado: a chave entra no XML e
    // no atributo Id, e validar com outro número não provaria o documento real.
    // Roda antes de consumir, com o número espiado.
    const leiaute = await validarContraXsd(gerarXmlCte(montarCte(entrada)));
    if (!leiaute.ok) {
      throw new BadRequestException({
        message: "O CT-e não fecha com o leiaute oficial da SEFAZ.",
        pendencias: leiaute.erros.map((e) => ({ campo: "leiaute", mensagem: e.mensagem })),
      });
    }

    const numero = await this.consumirNumero(conta.id, MODELO_CTE, entrada.config.serie);
    const cte = montarCte({ ...entrada, numero });

    const doc = await this.prisma.documentoFiscal.create({
      data: {
        viagemId,
        modelo: MODELO_CTE,
        serie: entrada.config.serie,
        numero,
        chave: cte.chave,
        ambiente: entrada.ambiente,
        emissor: await this.nomeDoEmissor(),
        status: "ENVIADO",
        payload: cte as unknown as Prisma.InputJsonValue,
        // O XML é guardado desde o rascunho: é ele que foi (ou seria) assinado,
        // e sem ele uma rejeição vira discussão sobre o que foi mandado.
        xml: gerarXmlCte(cte),
        criadoPorId: usuarioId,
      },
    });

    const emissor = await this.emissorDaConta();
    const r = await emissor.emitir(cte, entrada.ambiente);

    const atualizado = await this.prisma.documentoFiscal.update({
      where: { id: doc.id },
      data:
        r.situacao === "AUTORIZADO"
          ? {
              status: "AUTORIZADO",
              protocolo: r.protocolo,
              autorizadoEm: r.autorizadoEm,
              codigoRetorno: r.codigo,
              motivo: r.motivo,
              xml: r.xml ?? null,
              retorno: r.cru as Prisma.InputJsonValue,
            }
          : r.situacao === "REJEITADO"
            ? {
                status: "REJEITADO",
                codigoRetorno: r.codigo,
                motivo: r.motivo,
                retorno: r.cru as Prisma.InputJsonValue,
              }
            : {
                status: "ERRO",
                motivo: r.motivo,
                retorno: (r.cru ?? {}) as Prisma.InputJsonValue,
              },
    });

    // Espelha a chave na Viagem: as telas de viagem, fechamento e o comprovante
    // já leem `cteChave` — quem emite aqui e quem digitou a chave emitida fora
    // aparecem do mesmo jeito pro resto do sistema.
    if (r.situacao === "AUTORIZADO") {
      await this.prisma.viagem.update({
        where: { id: viagemId },
        data: {
          cteChave: cte.chave,
          cteNumero: String(numero),
          cteSerie: String(entrada.config.serie),
        },
      });
    }

    this.log.log(
      `CT-e ${numero}/${entrada.config.serie} da viagem ${viagemId}: ${atualizado.status}` +
        (atualizado.motivo ? ` — ${atualizado.motivo}` : ""),
    );
    return { documento: atualizado, avisos: validacao.avisos };
  }

  async cancelar(documentoId: string, justificativa: string) {
    if (justificativa.trim().length < 15) {
      // A SEFAZ exige 15 caracteres. Barrar aqui evita gastar o evento.
      throw new BadRequestException("A justificativa do cancelamento precisa ter ao menos 15 letras.");
    }
    const doc = await this.prisma.documentoFiscal.findUnique({ where: { id: documentoId } });
    if (!doc) throw new NotFoundException("Documento não encontrado.");
    if (doc.status !== "AUTORIZADO") {
      throw new BadRequestException("Só dá pra cancelar um documento autorizado.");
    }

    const emissor = await this.emissorDaConta();
    const r = await emissor.cancelar(
      doc.chave,
      justificativa,
      doc.ambiente as 1 | 2,
      // O protocolo da autorização: é ele que a SEFAZ confere no evento de
      // cancelamento, e sem ele o documento a desfazer é ambíguo.
      doc.protocolo ?? undefined,
    );
    if (r.situacao === "ERRO") {
      throw new BadRequestException(`Não deu pra cancelar: ${r.motivo}`);
    }

    const atualizado = await this.prisma.documentoFiscal.update({
      where: { id: documentoId },
      data: {
        status: "CANCELADO",
        canceladoEm: r.canceladoEm,
        cancelamentoMotivo: justificativa,
        retorno: r.cru as Prisma.InputJsonValue,
      },
    });

    // A viagem volta a não ter CT-e: deixar a chave de um documento cancelado
    // ali faria o fechamento sair citando um CT-e que não vale mais.
    if (doc.viagemId) {
      await this.prisma.viagem.update({
        where: { id: doc.viagemId },
        data: { cteChave: null, cteNumero: null, cteSerie: null },
      });
    }
    return atualizado;
  }

  // -------------------------------------------------------------------------
  // Configuração
  // -------------------------------------------------------------------------

  /**
   * O que está configurado hoje.
   *
   * O token do gateway NUNCA sai daqui — sai só um booleano dizendo se existe.
   * Devolver credencial numa resposta de API é como ela vaza: fica no cache do
   * navegador, no log do proxy e no print que alguém manda no WhatsApp.
   */
  async configuracao() {
    const c = await this.prisma.conta.findUniqueOrThrow({
      where: { id: contaIdAtual() },
      select: {
        cnpj: true,
        razaoSocial: true,
        inscricaoEstadual: true,
        crt: true,
        rntrc: true,
        uf: true,
        municipio: true,
        codigoMunicipioIbge: true,
        cteEmissor: true,
        cteAmbiente: true,
        cteSerie: true,
        // Estava faltando: o campo GRAVAVA e nunca voltava, então a tela
        // reabria em branco e o usuário achava que não tinha salvado.
        cteUfAutorizador: true,
        cteNaturezaCfop: true,
        cteNaturezaOperacao: true,
        cteIcmsTipo: true,
        cteIcmsAliquota: true,
        cteIcmsReducao: true,
        cteIcmsCst: true,
        cteGatewayUrl: true,
        cteGatewayToken: true,
      },
    });

    const proximoNumero = await this.espiarNumero(MODELO_CTE, c.cteSerie ?? 1);
    const { cteGatewayToken, ...resto } = c;

    return {
      ...resto,
      cteIcmsAliquota: c.cteIcmsAliquota == null ? null : Number(c.cteIcmsAliquota),
      cteIcmsReducao: c.cteIcmsReducao == null ? null : Number(c.cteIcmsReducao),
      gatewayTemToken: Boolean(cteGatewayToken),
      proximoNumero,
      /// O que ainda falta pra conseguir emitir. A tela lista isso em vez de
      /// deixar o usuário descobrir campo a campo na primeira tentativa.
      pendencias: this.pendenciasDeConfiguracao(c),
    };
  }

  private pendenciasDeConfiguracao(c: {
    cnpj: string | null;
    razaoSocial: string | null;
    inscricaoEstadual: string | null;
    crt: string | null;
    rntrc: string | null;
    uf: string | null;
    codigoMunicipioIbge: string | null;
    cteNaturezaCfop: string | null;
    cteNaturezaOperacao: string | null;
    cteIcmsTipo: string | null;
    cteEmissor: string | null;
    cteGatewayUrl: string | null;
    cteGatewayToken: string | null;
  }): string[] {
    const falta: string[] = [];
    if (!c.cnpj) falta.push("CNPJ da empresa");
    if (!c.razaoSocial) falta.push("Razão social");
    if (!c.inscricaoEstadual) falta.push("Inscrição estadual");
    if (!c.crt) falta.push("Regime tributário (CRT)");
    if (!c.rntrc) falta.push("RNTRC");
    if (!c.uf || !c.codigoMunicipioIbge) falta.push("Endereço fiscal com código IBGE do município");
    if (!c.cteNaturezaCfop) falta.push("Natureza do CFOP");
    if (!c.cteNaturezaOperacao) falta.push("Texto da natureza da operação");
    if (!c.cteIcmsTipo) falta.push("Regra de ICMS");
    if (c.cteEmissor === "GATEWAY" && (!c.cteGatewayUrl || !c.cteGatewayToken)) {
      falta.push("URL e token do gateway");
    }
    return falta;
  }

  async salvarConfiguracao(
    contaId: string,
    dados: {
      cteEmissor?: string;
      cteAmbiente?: number;
      cteSerie?: number;
      cteNaturezaCfop?: string | null;
      cteNaturezaOperacao?: string | null;
      cteIcmsTipo?: string | null;
      cteIcmsAliquota?: number | null;
      cteIcmsReducao?: number | null;
      cteIcmsCst?: string | null;
      cteGatewayUrl?: string | null;
      cteGatewayToken?: string | null;
    },
  ) {
    await this.prisma.conta.update({
      where: { id: contaId },
      data: {
        ...dados,
        cteGatewayToken: undefined,
        cteIcmsAliquota:
          dados.cteIcmsAliquota == null ? null : new Prisma.Decimal(dados.cteIcmsAliquota),
        cteIcmsReducao:
          dados.cteIcmsReducao == null ? null : new Prisma.Decimal(dados.cteIcmsReducao),
        // Token vazio na tela significa "não mexi", e não "apague": o campo
        // volta em branco do servidor de propósito, e gravar isso apagaria a
        // credencial de quem só quis trocar a série.
        ...(dados.cteGatewayToken ? { cteGatewayToken: dados.cteGatewayToken } : {}),
      },
    });
    return this.configuracao();
  }

  listar(filtro: { status?: string; viagemId?: string }) {
    const STATUS = ["RASCUNHO", "ENVIADO", "AUTORIZADO", "REJEITADO", "CANCELADO", "ERRO"];
    // Status desconhecido vindo da query string derrubaria o Prisma com 500.
    // Ignorar o filtro é melhor resposta que erro pra quem digitou na URL.
    const status = filtro.status && STATUS.includes(filtro.status) ? filtro.status : undefined;
    return this.prisma.documentoFiscal.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(filtro.viagemId ? { viagemId: filtro.viagemId } : {}),
      },
      orderBy: { criadoEm: "desc" },
      take: 200,
      select: {
        id: true,
        viagemId: true,
        modelo: true,
        serie: true,
        numero: true,
        chave: true,
        ambiente: true,
        emissor: true,
        status: true,
        protocolo: true,
        autorizadoEm: true,
        codigoRetorno: true,
        motivo: true,
        criadoEm: true,
        // `payload` e `retorno` ficam de fora da lista: são grandes e só
        // interessam no detalhe de um documento que deu errado.
      },
    });
  }

  async detalhe(id: string) {
    const doc = await this.prisma.documentoFiscal.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException("Documento não encontrado.");
    return doc;
  }

  /**
   * O DACTE — o papel que acompanha a carga.
   *
   * Sai do que foi GRAVADO, nunca de uma remontagem: remontar abriria a chance
   * de o papel divergir do que a SEFAZ autorizou, que é o defeito mais caro
   * possível aqui, porque só aparece na fiscalização.
   *
   * Rascunho não imprime. Um documento que a SEFAZ nunca viu não tem
   * representação impressa, e um PDF com cara de DACTE circulando sem
   * autorização é pior do que não ter PDF nenhum.
   */
  async dacte(id: string): Promise<{ pdf: Buffer; nome: string }> {
    const doc = await this.detalhe(id);
    if (doc.status === "RASCUNHO") {
      throw new BadRequestException("Este CT-e ainda não foi enviado à SEFAZ — não há DACTE.");
    }

    const situacao =
      doc.status === "AUTORIZADO"
        ? null
        : doc.status === "CANCELADO"
          ? `CANCELADO — ${doc.cancelamentoMotivo ?? ""}`
          : doc.codigoRetorno
            ? `SEM AUTORIZAÇÃO DE USO — ${doc.codigoRetorno} ${doc.motivo ?? ""}`
            : "SEM AUTORIZAÇÃO DE USO";

    const pdf = await gerarDacte({
      payload: doc.payload as never,
      chave: doc.chave,
      ambiente: doc.ambiente,
      protocolo: doc.status === "AUTORIZADO" ? doc.protocolo : null,
      autorizadoEm: doc.autorizadoEm,
      cancelado: doc.status === "CANCELADO",
      situacao,
    });
    return { pdf, nome: `dacte-${doc.chave}` };
  }
}
