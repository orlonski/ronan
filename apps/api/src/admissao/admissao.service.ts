import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { OrigemDocumento } from "@prisma/client";
import { TIPOS_DOCUMENTO_MOTORISTA, type TipoDocumentoMotorista } from "@ronan/shared-types";
import { chaveDaExigencia, chaveDocumento } from "../common/chave-documento";
import { checarArquivoEnviado, MIMES_DOCUMENTO } from "../common/arquivo-enviado";
import { regimeVivo } from "../common/regime-vigente";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { PushService } from "../push/push.service";
import { UploadsService } from "../uploads/uploads.service";
import { detectarAssinaturaEmbutida, hashDoArquivo } from "./assinatura-arquivo";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * O arquivo assinado do gov.br/assinador: `.p7s` (destacado) e `.p7m`.
 *
 * Passa pela lista de mimes porque o navegador manda esses como
 * `application/octet-stream` na metade das vezes — a extensão é o único
 * sinal na hora do upload. Deixar entrar NÃO é confiar nela: logo abaixo, o
 * arquivo só é aceito se o conteúdo carregar mesmo o OID de PKCS#7, então um
 * JPEG renomeado pra `.p7s` continua sendo recusado.
 */
const ASSINATURA_DESTACADA = [".p7s", ".p7m"] as const;

function ehExtensaoAssinada(nome: string): boolean {
  const n = nome.toLowerCase();
  return ASSINATURA_DESTACADA.some((e) => n.endsWith(e));
}

/**
 * Teto de arquivos por link.
 *
 * Não é desconfiança de quem recebe o link: é que endpoint público de escrita
 * sem teto vira hospedagem grátis pra quem descobrir a URL. Generoso o
 * bastante pra ninguém legítimo esbarrar.
 */
const MAX_ENVIOS_POR_CONVITE = 40;

/** Quanto tempo o link vale. Curto o bastante pra um link vazado envelhecer. */
const DIAS_DE_VALIDADE = 14;

/**
 * A admissão: os papéis que o contratante exige antes do caminhão entrar na
 * obra, e o link por onde eles chegam.
 *
 * ⚠️ O sistema não nomeia documento. O título é o que a operação escreveu,
 * copiando o que o contratante pede — ver o comentário do model
 * `DocumentoExigido`. Nós transportamos o arquivo.
 */
/** O que define uma exigência do catálogo, criando ou editando. */
type DadosExigencia = {
  titulo: string;
  ajuda?: string | null;
  tipo: string;
  empresaId?: string;
  publico?: "MENSAL" | "TODOS" | "REGISTRADOS";
  obrigatorio?: boolean;
  ordem?: number;
  comoAssinar?: "NAO" | "NO_APP" | "JA_ASSINADO";
  exigeIcpBrasil?: boolean;
};

/**
 * DE QUEM é um documento: do cadastro de motorista ou do de funcionário
 * (registrado em carteira sem cadastro de motorista — mecânico, escritório).
 * O banco garante que é exatamente um dos dois (CHECK `*_um_dono`).
 */
export type DonoDocumento = { motoristaId: string } | { funcionarioId: string };

/** Quem está no app: o que o token traz. O motorista CLT traz os dois. */
export type QuemNoApp = { motoristaId?: string | null; funcionarioId?: string | null };

function ehDoMotorista(d: DonoDocumento): d is { motoristaId: string } {
  return "motoristaId" in d;
}
function ondeDono(d: DonoDocumento) {
  return ehDoMotorista(d) ? { motoristaId: d.motoristaId } : { funcionarioId: d.funcionarioId };
}
function unicoDoDono(d: DonoDocumento, chave: string) {
  return ehDoMotorista(d)
    ? { motoristaId_chave: { motoristaId: d.motoristaId, chave } }
    : { funcionarioId_chave: { funcionarioId: d.funcionarioId, chave } };
}
/** A pasta no storage. `func-` não colide com uuid de motorista. */
function pastaDoDono(d: DonoDocumento) {
  return ehDoMotorista(d) ? d.motoristaId : `func-${d.funcionarioId}`;
}

@Injectable()
export class AdmissaoService {
  private readonly log = new Logger(AdmissaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly push: PushService,
  ) {}

  // --------------------------------------------------- o que se exige ---

  /**
   * O que é exigido deste motorista.
   *
   * Duas perguntas, e as duas decidem:
   *
   * 1. **QUEM PEDE** — as exigências da transportadora (contratante nulo).
   * 2. **DE QUEM SE PEDE** (`publico`) — papelada de admissão se cobra de quem
   *    TEM VÍNCULO com a empresa, e não da frota inteira: o motorista de frete
   *    comum não pode abrir o app com "3 documentos faltam" de uma papelada
   *    que nunca foi dele.
   *
   * ⚠️ VÍNCULO: a pergunta é "esta pessoa tem vínculo vivo aqui?", e quem
   * responde é o `RegimeVigente`.
   *
   * ⚠️ O filtro só vale pra TELA DO MOTORISTA (`soDoPublicoDele`). O escritório
   * e o link de coleta continuam vendo o catálogo inteiro, e isso não é
   * inconsistência: a admissão acontece ANTES de qualquer vínculo formal.
   * Filtrar o link deixaria a coleta vazia exatamente no momento em que ela
   * serve — o escritório junta a papelada e só então contrata.
   */
  async exigidosPara(motoristaId: string, opts?: { soDoPublicoDele?: boolean }) {
    const motorista = await this.prisma.motorista.findFirst({
      where: { id: motoristaId },
      select: { cpf: true },
    });

    // Quem tem vínculo vivo manda documento. Quem não tem é o motorista de
    // frete comum, e dele só se pede o que vale pra frota inteira.
    // (O contratante vinha da alocação de obra, que saiu do sistema: sem ela,
    // o motorista vê as exigências da transportadora inteira.)
    const temVinculo = (await regimeVivo(this.prisma as never, motorista?.cpf ?? "")) !== null;

    return this.prisma.documentoExigido.findMany({
      where: {
        ativo: true,
        // O que se pede de REGISTRADO mora no cadastro de funcionário, não no
        // de motorista: aparece junto no app dele, mas não é deste dono.
        publico: { not: "REGISTRADOS" },
        empresaId: null,
        // Sem vínculo, só o que vale pra todo mundo — e só quando quem
        // pergunta é o app dele.
        ...(opts?.soDoPublicoDele && !temVinculo ? { publico: "TODOS" as const } : {}),
      },
      orderBy: [{ ordem: "asc" }, { titulo: "asc" }],
    });
  }

  /**
   * O que se pede de quem é REGISTRADO EM CARTEIRA. Vale pra empresa inteira:
   * papel de admissão CLT não é de obra nenhuma.
   */
  exigidosDoRegistrado() {
    return this.prisma.documentoExigido.findMany({
      where: { ativo: true, publico: "REGISTRADOS" },
      orderBy: [{ ordem: "asc" }, { titulo: "asc" }],
    });
  }

  listarExigidos(empresaId?: string) {
    return this.prisma.documentoExigido.findMany({
      where: empresaId ? { OR: [{ empresaId: null }, { empresaId }] } : {},
      orderBy: [{ ordem: "asc" }, { titulo: "asc" }],
    });
  }

  criarExigido(dados: DadosExigencia) {
    this.assertTipo(dados.tipo);
    return this.prisma.documentoExigido.create({
      data: {
        titulo: dados.titulo,
        ajuda: dados.ajuda?.trim() || null,
        tipo: dados.tipo,
        // Papel de registrado é da empresa inteira, nunca de um contratante.
        empresaId: dados.publico === "REGISTRADOS" ? null : (dados.empresaId ?? null),
        // Default MENSAL: o silêncio é o padrão seguro. Exigência que nasce
        // valendo pra frota inteira cobra gente que nunca foi chamada pra obra.
        publico: dados.publico ?? "MENSAL",
        obrigatorio: dados.obrigatorio ?? true,
        ordem: dados.ordem ?? 0,
        ...this.camposDeAssinatura(dados),
      },
    });
  }

  /**
   * EDITAR uma exigência.
   *
   * ⚠️ Não existia, e a falta custava caro: pra mudar como um papel é assinado
   * a operação tinha que "não exigir mais" e criar de novo — e aí os arquivos
   * já enviados apontavam pra exigência velha, sumiam da lista do motorista e
   * ele mandava tudo outra vez. A gaveta (`tipo`) fica de fora de propósito:
   * mudá-la moveria o arquivo de lugar no storage, e isso é criar outro
   * documento, não editar este.
   */
  async editarExigido(id: string, dados: Omit<DadosExigencia, "tipo">) {
    const e = await this.prisma.documentoExigido.findFirst({ where: { id } });
    if (!e) throw new NotFoundException("Exigência não encontrada.");

    return this.prisma.documentoExigido.update({
      where: { id },
      data: {
        titulo: dados.titulo,
        ajuda: dados.ajuda?.trim() || null,
        empresaId: (dados.publico ?? e.publico) === "REGISTRADOS" ? null : (dados.empresaId ?? null),
        publico: dados.publico ?? e.publico,
        obrigatorio: dados.obrigatorio ?? e.obrigatorio,
        ordem: dados.ordem ?? e.ordem,
        ...this.camposDeAssinatura({ ...dados, tipo: e.tipo }),
      },
    });
  }

  /**
   * Os três campos de assinatura, derivados de UM.
   *
   * `comoAssinar` é quem manda; `exigeAssinatura` é espelho dele (existe pra
   * não reescrever as consultas antigas) e `exigeIcpBrasil` só sobrevive
   * dentro de `JA_ASSINADO` — "só vale digital" não quer dizer nada pra um
   * papel que ninguém assina, nem pro aceite feito aqui dentro.
   */
  private camposDeAssinatura(dados: DadosExigencia) {
    const comoAssinar = dados.comoAssinar ?? "NAO";
    return {
      comoAssinar,
      exigeAssinatura: comoAssinar !== "NAO",
      exigeIcpBrasil: comoAssinar === "JA_ASSINADO" && (dados.exigeIcpBrasil ?? false),
    };
  }

  async removerExigido(id: string) {
    const e = await this.prisma.documentoExigido.findFirst({ where: { id } });
    if (!e) throw new NotFoundException("Exigência não encontrada.");
    // Desativa em vez de apagar: coleta antiga referencia o que era exigido na
    // época, e sumir com a linha faria um pacote entregue parecer incompleto.
    return this.prisma.documentoExigido.update({ where: { id }, data: { ativo: false } });
  }

  private assertTipo(tipo: string): TipoDocumentoMotorista {
    if (!(TIPOS_DOCUMENTO_MOTORISTA as readonly string[]).includes(tipo)) {
      throw new BadRequestException(`Gaveta de documento inválida: ${tipo}`);
    }
    return tipo as TipoDocumentoMotorista;
  }

  // ------------------------------------------------------------ link ---

  /**
   * Gera o link de coleta. Serve ao dono do caminhão E ao motorista.
   *
   * 192 bits de aleatoriedade, como o comprovante de viagem: o link É a
   * credencial, então adivinhar tem que ser impossível.
   */
  async criarConvite(motoristaId: string, usuarioId: string) {
    const m = await this.prisma.motorista.findFirst({
      where: { id: motoristaId },
      select: { id: true, nome: true },
    });
    if (!m) throw new NotFoundException("Motorista não encontrado.");

    const expiraEm = new Date(Date.now() + DIAS_DE_VALIDADE * 86_400_000);
    const convite = await this.prisma.conviteColeta.create({
      data: {
        motoristaId,
        token: randomBytes(24).toString("base64url"),
        criadoPorId: usuarioId,
        expiraEm,
      },
    });
    this.log.log(`Convite de coleta criado para ${m.nome}.`);
    return convite;
  }

  listarConvites(motoristaId: string) {
    return this.prisma.conviteColeta.findMany({
      where: { motoristaId },
      orderBy: { criadoEm: "desc" },
    });
  }

  /** Soft-revoke: a linha fica, pra o histórico de quem expôs o quê sobreviver. */
  async revogarConvite(id: string) {
    const c = await this.prisma.conviteColeta.findFirst({ where: { id } });
    if (!c) throw new NotFoundException("Convite não encontrado.");
    if (c.revogadoEm) return c;
    return this.prisma.conviteColeta.update({
      where: { id },
      data: { revogadoEm: new Date() },
    });
  }

  // -------------------------------------------------------- o público ---

  /**
   * Resolve o token. Roda `comoSistema` porque rota pública não tem conta no
   * contexto — é o token que diz de qual conta é.
   *
   * 404 genérico pra token inválido, expirado e revogado: distinguir os três
   * contaria a quem tem um link velho que ele já existiu.
   */
  private async resolverToken(token: string) {
    const c = await comoSistema(() =>
      this.prisma.conviteColeta.findFirst({
        where: { token },
        include: { motorista: { select: { id: true, nome: true } } },
      }),
    );
    if (!c || c.revogadoEm || c.expiraEm.getTime() < Date.now()) {
      throw new NotFoundException("Este link não está mais disponível.");
    }
    return c;
  }

  /**
   * O que a página pública mostra.
   *
   * ⚠️ ISTO JÁ FOI MAIS FECHADO E ESTAVA ERRADO. A primeira versão devolvia só
   * o que FALTAVA, escondendo o que já tinha chegado, com o argumento de que
   * quem abre o link pode não ser o titular. Na prática: a pessoa mandava sete
   * arquivos sem saber qual entrou, não tinha como trocar uma foto tremida, e
   * o link virava um buraco. O argumento também não se sustentava — a página
   * já mostra o NOME do motorista, então esconder "CNH recebida" protegia
   * quase nada e custava o uso inteiro.
   *
   * O que continua valendo: NUNCA devolve o arquivo, nem o nome dele, nem a
   * chave de storage, nem miniatura. Só o TIPO pedido e se chegou ou não —
   * que é exatamente o que quem está enviando precisa saber.
   */
  async paginaPublica(token: string, ip?: string) {
    const c = await this.resolverToken(token);

    await comoSistema(() =>
      this.prisma.conviteColeta.update({
        where: { id: c.id },
        data: {
          visualizacoes: { increment: 1 },
          primeiroAcessoEm: c.primeiroAcessoEm ?? new Date(),
          ultimoAcessoEm: new Date(),
          ultimoAcessoIp: ip ?? null,
        },
      }),
    );

    return comConta(c.contaId, async () => {
      const estado = await this.estadoDosDocumentos(c.motoristaId);
      return {
        motorista: c.motorista.nome,
        expiraEm: c.expiraEm,
        // A página pública mostra o ESTADO, nunca o arquivo: sem nome de
        // arquivo, sem storageKey, sem miniatura e sem a trilha da assinatura.
        // Quem abre o link pode não ser o titular.
        documentos: estado.documentos.map((d) => ({
          exigenciaId: d.exigenciaId,
          tipo: d.tipo,
          titulo: d.titulo,
          obrigatorio: d.obrigatorio,
          recebido: d.recebido,
          exigeAssinatura: d.exigeAssinatura,
          exigeIcpBrasil: d.exigeIcpBrasil,
          assinado: d.assinado,
          /** Só a data. Nome, CPF e hash são evidência, não coisa de tela pública. */
          assinadoEm: d.assinadoEm,
          /** Devolvido pelo escritório, com o motivo — quem abre o link precisa saber. */
          recusado: d.recusado,
          recusaMotivo: d.recusaMotivo,
        })),
        /**
         * ⚠️ Aqui é CHEGOU, não "conferido" — e a diferença é de propósito.
         *
         * Esta página existe pra quem está MANDANDO: ele precisa saber o que
         * já entrou, pra não mandar a mesma coisa sete vezes. Exigir a
         * conferência do escritório aqui mostraria "0 de 7" pra alguém que
         * acabou de mandar os sete, e a página voltaria a ser o buraco que
         * ela já foi.
         *
         * O que não pode é a página dizer que acabou: por isso o número de
         * conferências pendentes vai junto, e a tela avisa.
         */
        recebidos: estado.documentos.filter(
          (d) => d.recebido && !d.recusado && (!d.exigeAssinatura || d.assinado),
        ).length,
        total: estado.total,
        /** Chegou e está esperando o escritório olhar. */
        emConferencia: estado.comOEscritorio,
      };
    });
  }

  /**
   * O ESTADO da admissão deste motorista — a verdade única.
   *
   * ⚠️ Três telas fazem a mesma pergunta ("o que falta?"): o link público, a
   * ficha do motorista no painel e, em breve, o app. Enquanto cada uma
   * calculava por conta própria, "faltam 3" significava coisas diferentes em
   * cada lugar — e a que estava certa era sempre a que ninguém tinha aberto.
   * Quem quiser um recorte diferente, recorta DEPOIS: o cálculo é aqui.
   *
   * Roda dentro da conta: quem chama é responsável pelo `comConta`.
   */
  async estadoDosDocumentos(motoristaId: string, opts?: { soDoPublicoDele?: boolean }) {
    return this.estadoDe({ motoristaId }, await this.exigidosPara(motoristaId, opts));
  }

  /** O mesmo estado, do cadastro de funcionário (quem é registrado). */
  async estadoDoFuncionario(funcionarioId: string) {
    return this.estadoDe({ funcionarioId }, await this.exigidosDoRegistrado());
  }

  private async estadoDe(
    dono: DonoDocumento,
    exigidos: Awaited<ReturnType<AdmissaoService["exigidosDoRegistrado"]>>,
  ) {
    const [enviados, assinaturas] = await Promise.all([
      this.prisma.motoristaDocumento.findMany({
        where: ondeDono(dono),
        select: {
          chave: true,
          nomeArquivo: true,
          mimetype: true,
          tamanho: true,
          hashArquivo: true,
          origem: true,
          validade: true,
          criadoEm: true,
          conferidoEm: true,
          recusadoEm: true,
          recusaMotivo: true,
        },
      }),
      this.prisma.assinaturaDocumento.findMany({
        where: ondeDono(dono),
        select: { chave: true, modo: true, assinadoEm: true, hashArquivo: true },
      }),
    ]);
    const porChave = new Map(enviados.map((e) => [e.chave, e]));
    const assinadoPorChave = new Map(assinaturas.map((a) => [a.chave, a]));

    const documentos = exigidos.map((e) => {
      const chave = chaveDaExigencia(e.id);
      const doc = porChave.get(chave) ?? null;
      const ass = assinadoPorChave.get(chave) ?? null;

      return {
        exigenciaId: e.id,
        chave,
        tipo: e.tipo,
        titulo: e.titulo,
        ajuda: e.ajuda,
        obrigatorio: e.obrigatorio,
        exigeAssinatura: e.exigeAssinatura,
        comoAssinar: e.comoAssinar,
        exigeIcpBrasil: e.exigeIcpBrasil,

        recebido: doc !== null,
        recebidoEm: doc?.criadoEm ?? null,

        /**
         * O QUE O ESCRITÓRIO JÁ DISSE SOBRE ESTE ARQUIVO.
         *
         * ⚠️ Três estados, e a diferença entre eles é o que impede o produto
         * de mentir: `null` = chegou e ninguém olhou; conferido = alguém
         * olhou e aceitou; recusado = alguém olhou e devolveu, com motivo.
         *
         * O sistema não consegue ver o que está dentro de uma foto. Enquanto
         * não houver um humano dizendo que olhou, "chegou" não pode virar
         * "está certo" — era exatamente isso que acontecia, e a contagem do
         * app zerava sozinha.
         */
        conferido: doc?.conferidoEm != null,
        conferidoEm: doc?.conferidoEm ?? null,
        recusado: doc?.recusadoEm != null,
        recusaMotivo: doc?.recusaMotivo ?? null,
        nomeArquivo: doc?.nomeArquivo ?? null,
        mimetype: doc?.mimetype ?? null,
        tamanho: doc?.tamanho ?? null,
        origem: doc?.origem ?? null,
        validade: doc?.validade ?? null,
        versaoArquivo: doc?.hashArquivo?.slice(0, 12) ?? null,

        assinado: ass !== null,
        assinadoEm: ass?.assinadoEm ?? null,
        modoAssinatura: ass?.modo ?? null,
        /**
         * A assinatura ainda bate com o arquivo que está guardado?
         *
         * `null` = não dá pra dizer (documento anterior a 21/09/2026, quando o
         * hash passou a ser persistido no upload). Nulo NUNCA deve ser lido
         * como "confere" — a tela tem que dizer que não sabe.
         */
        assinaturaConfere:
          ass === null || doc === null || !doc.hashArquivo
            ? null
            : doc.hashArquivo === ass.hashArquivo,
      };
    });

    /**
     * ⚠️ DUAS PERGUNTAS DIFERENTES, e confundi-las é o defeito que este
     * método já teve:
     *
     * - `faltaDele`: o que o MOTORISTA ainda tem que fazer — não mandou,
     *   mandou e foi recusado, ou falta assinar. É o número que vai pro app.
     * - `pendente`: o que ainda não está fechado pra ADMISSÃO, o que inclui o
     *   que está esperando o escritório olhar.
     *
     * Enquanto os dois eram a mesma conta, o documento que chegava zerava a
     * contagem do motorista mesmo sem ninguém ter conferido — ele ia pra obra
     * achando que estava resolvido. E se fossem a MESMA conta pro outro lado,
     * ele veria como "falta" algo que já está na mão do escritório e que ele
     * não tem como resolver.
     */
    const faltaDele = (d: (typeof documentos)[number]) =>
      !d.recebido || d.recusado || (d.exigeAssinatura && d.comoAssinar === "NO_APP" && !d.assinado);

    const esperandoEscritorio = (d: (typeof documentos)[number]) =>
      d.recebido && !d.recusado && !d.conferido;

    const pendente = (d: (typeof documentos)[number]) => faltaDele(d) || esperandoEscritorio(d);

    return {
      documentos,
      prontos: documentos.filter((d) => !pendente(d)).length,
      total: documentos.length,
      faltamObrigatorios: documentos.filter((d) => d.obrigatorio && pendente(d)).length,
      /** O que ELE resolve. É este número que o app mostra. */
      faltamDele: documentos.filter((d) => faltaDele(d)).length,
      /** Chegou e está esperando alguém olhar. Não é tarefa dele. */
      comOEscritorio: documentos.filter((d) => esperandoEscritorio(d)).length,
    };
  }

  /**
   * O que o MOTORISTA vê no app.
   *
   * Mesmo cálculo das outras telas (`estadoDosDocumentos`), com dois recortes:
   *
   * 1. **Vem o nome da obra.** É o que responde "quem está pedindo isso?" antes
   *    de ele decidir se vale o esforço — e o dono foi explícito em não querer
   *    que ele perca tempo à toa.
   * 2. **Não vem trilha de assinatura nem storageKey.** Nome, CPF, IP e hash
   *    são evidência pro escritório; na tela dele isso não ajuda em nada e é
   *    dado sensível viajando à toa. Ele vê que assinou e quando.
   *
   * Lista vazia é resposta legítima e comum: motorista que não está em obra
   * nenhuma e cuja transportadora não exige nada. O app some com a tela.
   */
  async paraOMotorista(motoristaId: string) {
    return this.paraOApp({ motoristaId });
  }

  /**
   * A tela "Meus documentos" de quem está no app: o que se pede do cadastro
   * de motorista E, se a pessoa é registrada em carteira, o que se pede do
   * registrado. Uma lista só: pra ela é tudo "papel que a empresa pediu".
   */
  async paraOApp(quem: QuemNoApp) {
    const [doMotorista, doRegistrado] = await Promise.all([
      // Na tela DELE, só o que é dele.
      quem.motoristaId ? this.estadoDosDocumentos(quem.motoristaId, { soDoPublicoDele: true }) : null,
      quem.funcionarioId ? this.estadoDoFuncionario(quem.funcionarioId) : null,
    ]);
    const partes = [doMotorista, doRegistrado].filter((p): p is NonNullable<typeof p> => p !== null);
    const soma = (k: "prontos" | "total" | "faltamObrigatorios" | "faltamDele" | "comOEscritorio") =>
      partes.reduce((t, p) => t + p[k], 0);
    const estado = {
      documentos: partes.flatMap((p) => p.documentos),
      prontos: soma("prontos"),
      total: soma("total"),
      faltamObrigatorios: soma("faltamObrigatorios"),
      faltamDele: soma("faltamDele"),
      comOEscritorio: soma("comOEscritorio"),
    };

    return {
      // Sempre null: vinha da alocação de obra, que saiu do sistema. Fica na
      // resposta porque o app já instalado lê o campo (e cai no "Pedidos pelo
      // escritório" com null).
      obra: null,
      documentos: estado.documentos.map((d) => ({
        id: d.exigenciaId,
        titulo: d.titulo,
        ajuda: d.ajuda,
        obrigatorio: d.obrigatorio,
        precisaAssinar: d.exigeAssinatura,
        /** `NAO` | `NO_APP` | `JA_ASSINADO` — decide o botão que ele vê. */
        comoAssinar: d.comoAssinar,
        /**
         * Este não dá pra resolver pelo celular: assinatura com certificado
         * digital é feita fora, porque a chave privada é do titular. A tela
         * diz isso em vez de oferecer um botão que vai falhar.
         */
        soComCertificado: d.exigeIcpBrasil,
        recebido: d.recebido,
        recebidoEm: d.recebidoEm,
        /** O escritório olhou e aceitou? Nulo/false = ainda não olharam. */
        conferido: d.conferido,
        /** Devolveram, e o motivo — que aparece no próprio item da lista. */
        recusado: d.recusado,
        recusaMotivo: d.recusaMotivo,
        /**
         * O app decide com isto se consegue MOSTRAR o papel antes de assinar.
         * Foto ele desenha; PDF não — não há visualizador de PDF no app, e
         * mandar assinar sem ver é o defeito que a assinatura simples não
         * sobrevive numa audiência.
         */
        mimetype: d.mimetype,
        /**
         * Pedaço do hash do arquivo, pro app pôr na URL da miniatura.
         *
         * É o que torna o cache seguro: a chave do objeto no storage é
         * determinística (trocar a foto reusa o mesmo nome), então sem isto o
         * aparelho continuaria mostrando a miniatura do arquivo antigo pra
         * sempre.
         */
        versao: d.versaoArquivo,
        assinado: d.assinado,
        assinadoEm: d.assinadoEm,
        validade: d.validade,
      })),
      prontos: estado.prontos,
      total: estado.total,
      faltamObrigatorios: estado.faltamObrigatorios,
      /**
       * ⚠️ É ESTE o número que a tela dele mostra, não `total - prontos`.
       *
       * O que está esperando o escritório olhar não é tarefa dele: mostrar
       * como "falta" mandaria ele resolver o que não tem como resolver. E o
       * contrário — contar como pronto — foi o defeito que fez a contagem
       * zerar sozinha assim que o arquivo chegava.
       */
      faltamDele: estado.faltamDele,
      comOEscritorio: estado.comOEscritorio,
    };
  }

  // ------------------------------------ documentos do registrado (painel) ---

  private async garantirFuncionario(funcionarioId: string) {
    const f = await this.prisma.funcionario.findFirst({
      where: { id: funcionarioId },
      select: { id: true },
    });
    if (!f) throw new NotFoundException("Funcionário não encontrado.");
  }

  /** O que se pediu deste registrado e o estado de cada papel, pro escritório. */
  async documentosDoFuncionario(funcionarioId: string) {
    await this.garantirFuncionario(funcionarioId);
    return this.estadoDoFuncionario(funcionarioId);
  }

  /**
   * O arquivo, pro ESCRITÓRIO baixar. Não carimba `vistoEm`: esse carimbo é a
   * prova de que o TITULAR abriu o papel antes de assinar.
   */
  async arquivoDoFuncionario(funcionarioId: string, exigenciaId: string) {
    await this.garantirFuncionario(funcionarioId);
    const doc = await this.prisma.motoristaDocumento.findFirst({
      where: { funcionarioId, chave: chaveDaExigencia(exigenciaId) },
      select: { storageKey: true, mimetype: true, nomeArquivo: true },
    });
    if (!doc) throw new NotFoundException("Documento não encontrado.");
    return doc;
  }

  /**
   * O escritório sobe o papel de um registrado: o contrato que ELE emitiu pra
   * o funcionário assinar pelo app, ou a cópia que a pessoa trouxe em mãos.
   * Mesma regra de gravação das outras portas (`receberDocumento`).
   */
  async receberDoPainelFuncionario(
    funcionarioId: string,
    exigenciaId: string,
    arquivo: { buffer: Buffer; mimetype: string; size: number; originalname: string },
  ) {
    await this.garantirFuncionario(funcionarioId);
    checarArquivoEnviado(arquivo, {
      mimes: MIMES_DOCUMENTO,
      maxBytes: MAX_BYTES,
      extensoesTambem: ASSINATURA_DESTACADA,
      comoDizer: "Use PDF, JPG, PNG ou WebP.",
    });
    const exigencia = (await this.exigidosDoRegistrado()).find((e) => e.id === exigenciaId);
    if (!exigencia) throw new BadRequestException("Esta exigência não é de quem é registrado.");
    const { doc } = await this.receberDocumento({
      dono: { funcionarioId },
      exigencia,
      tipo: exigencia.tipo,
      arquivo,
      origem: "PAINEL",
    });
    return { recebido: true, exigenciaId, criadoEm: doc.criadoEm };
  }

  // ------------------------------------------------- conferência humana ---

  /**
   * O escritório diz que olhou e ACEITOU.
   *
   * ⚠️ É a peça que faltava pro produto parar de mentir. O sistema não vê o
   * que está dentro da foto: se a CNH está legível, se o comodato está mesmo
   * assinado, se o carimbo do cartório existe. Enquanto isso não tinha lugar,
   * "chegou" virava "conferido" por omissão — a ficha mostrava visto verde e a
   * contagem do app zerava sozinha.
   *
   * Fica escrito QUEM conferiu, pelo mesmo princípio da alteração de km e do
   * lançamento de presença pelo painel: quem decide por outra pessoa assina.
   */
  async conferirDocumento(motoristaId: string, chaveOuExigencia: string, usuarioId: string) {
    return this.conferirDoDono({ motoristaId }, chaveOuExigencia, usuarioId);
  }

  async conferirDoDono(dono: DonoDocumento, chaveOuExigencia: string, usuarioId: string) {
    const doc = await this.acharPorChave(dono, chaveOuExigencia);
    return this.prisma.motoristaDocumento.update({
      where: { id: doc.id },
      data: {
        conferidoEm: new Date(),
        conferidoPor: usuarioId,
        recusadoEm: null,
        recusadoPor: null,
        recusaMotivo: null,
      },
    });
  }

  /**
   * O escritório devolve o documento, com MOTIVO.
   *
   * O motivo é obrigatório e vai inteiro pro app dele, no próprio item da
   * lista: "mande de novo" sem dizer o que houve faz a pessoa repetir o mesmo
   * erro — e no caso dela, dirigir de novo até o escritório pra descobrir.
   */
  async recusarDocumento(
    motoristaId: string,
    chaveOuExigencia: string,
    motivo: string,
    usuarioId: string,
  ) {
    return this.recusarDoDono({ motoristaId }, chaveOuExigencia, motivo, usuarioId);
  }

  async recusarDoDono(
    dono: DonoDocumento,
    chaveOuExigencia: string,
    motivo: string,
    usuarioId: string,
  ) {
    const texto = motivo.trim();
    if (texto.length < 3) {
      throw new BadRequestException("Escreva o que houve com o documento.");
    }
    const doc = await this.acharPorChave(dono, chaveOuExigencia);
    const atualizado = await this.prisma.motoristaDocumento.update({
      where: { id: doc.id },
      data: {
        recusadoEm: new Date(),
        recusadoPor: usuarioId,
        recusaMotivo: texto,
        conferidoEm: null,
        conferidoPor: null,
      },
      include: { exigencia: { select: { titulo: true } } },
    });

    /**
     * ⚠️ AVISAR É PARTE DA RECUSA, não um extra.
     *
     * Sem a push, devolver um documento é escrever num lugar que o motorista
     * não tem motivo pra abrir: ele já tinha feito a parte dele, a tela dizia
     * que estava resolvido, e ele só descobriria na portaria da obra — que é
     * exatamente o que este módulo existe pra evitar.
     *
     * É um dos DOIS únicos avisos desta feature (o outro é o convite). Nada de
     * lembrete recorrente de "ainda faltam 4": cobrança periódica no celular
     * de quem já sabe o que deve é o que faz a pessoa desligar a notificação —
     * e aí ela perde a que importa.
     *
     * `tentar` e não `enviar`: falha de push não pode desfazer a recusa, que
     * já está gravada. O item aparece no app dele assim que ele abrir.
     */
    // A push mora no cadastro de motorista. O registrado sem esse cadastro
    // vê a recusa no próprio item, quando abrir a tela.
    const m = ehDoMotorista(dono)
      ? await this.prisma.motorista.findFirst({
          where: { id: dono.motoristaId },
          select: { id: true, expoPushToken: true },
        })
      : null;
    if (m?.expoPushToken) {
      const nome = atualizado.exigencia?.titulo ?? "Um documento";
      await this.push
        .enviar({
          motoristaId: m.id,
          token: m.expoPushToken,
          titulo: `${nome}: precisa mandar de novo`,
          corpo: texto,
          tipo: "documento-recusado",
          criadoPorId: usuarioId,
        })
        .catch(() => {
          // Já está gravado; ele vê ao abrir o app.
        });
    }

    return atualizado;
  }

  /** Aceita a chave (`exig:<id>` / `gaveta:<TIPO>`) ou só o id da exigência. */
  private async acharPorChave(dono: DonoDocumento, chaveOuExigencia: string) {
    const chave =
      chaveOuExigencia.startsWith("exig:") || chaveOuExigencia.startsWith("gaveta:")
        ? chaveOuExigencia
        : chaveDaExigencia(chaveOuExigencia);
    const doc = await this.prisma.motoristaDocumento.findFirst({
      where: { ...ondeDono(dono), chave },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException("Documento não encontrado.");
    return doc;
  }

  /**
   * O motorista mandando um arquivo PELO APP.
   *
   * Mesma regra de gravação das outras portas; o que muda é quem responde por
   * ela. Aqui não há teto de envios como no link: o teto do link existe porque
   * endpoint público de escrita sem limite vira hospedagem grátis pra quem
   * descobrir a URL — com JWT, quem está do outro lado é o dono dos documentos.
   */
  async receberDoMotorista(
    motoristaId: string,
    exigenciaId: string,
    arquivo: { buffer: Buffer; mimetype: string; size: number; originalname: string },
  ) {
    return this.receberDoApp({ motoristaId }, exigenciaId, arquivo);
  }

  /**
   * A exigência que esta pessoa pode atender pelo app, e DE QUEM fica o
   * arquivo: o que se pede de registrado vai pro cadastro de funcionário, o
   * resto pro de motorista. Exigência que não é pra ela → 400, como sempre.
   */
  private async exigenciaDoApp(quem: QuemNoApp, exigenciaId: string) {
    const [doMotorista, doRegistrado] = await Promise.all([
      quem.motoristaId ? this.exigidosPara(quem.motoristaId, { soDoPublicoDele: true }) : [],
      quem.funcionarioId ? this.exigidosDoRegistrado() : [],
    ]);
    const m = doMotorista.find((e) => e.id === exigenciaId);
    if (m && quem.motoristaId) return { exigencia: m, dono: { motoristaId: quem.motoristaId } as DonoDocumento };
    const f = doRegistrado.find((e) => e.id === exigenciaId);
    if (f && quem.funcionarioId) return { exigencia: f, dono: { funcionarioId: quem.funcionarioId } as DonoDocumento };
    throw new BadRequestException("Este documento não é pedido pra você.");
  }

  async receberDoApp(
    quem: QuemNoApp,
    exigenciaId: string,
    arquivo: { buffer: Buffer; mimetype: string; size: number; originalname: string },
  ) {
    checarArquivoEnviado(arquivo, {
      mimes: MIMES_DOCUMENTO,
      maxBytes: MAX_BYTES,
      // `.p7s`/`.p7m` do gov.br chegam como octet-stream: recusar pelo mime
      // jogaria fora justamente o documento ASSINADO.
      extensoesTambem: ASSINATURA_DESTACADA,
      comoDizer: "Mande uma foto ou um PDF.",
    });

    const { exigencia, dono } = await this.exigenciaDoApp(quem, exigenciaId);

    const { assinaturaEmbutida } = await this.receberDocumento({
      dono,
      exigencia,
      tipo: exigencia.tipo,
      arquivo,
      origem: "APP",
    });

    this.log.log(`Documento "${exigencia.titulo}" recebido pelo app.`);
    return { recebido: true, exigenciaId, assinaturaEmbutida };
  }

  /**
   * O arquivo que o motorista já mandou, pra ele ver.
   *
   * ⚠️ Isto é o contrário da regra do link público, e de propósito: lá o GET
   * nunca devolve arquivo porque quem abre pode não ser o titular. Aqui o
   * titular está provado pelo JWT do cadastro dele.
   *
   * E é o que torna a assinatura pelo app valer alguma coisa: o documento que
   * exige assinatura quase sempre foi subido pelo ESCRITÓRIO (contrato,
   * ordem de serviço, ficha de EPI). Sem mostrar, o motorista assinaria um
   * papel que nunca viu — que é exatamente a fragilidade que a assinatura
   * simples não sobrevive numa audiência.
   *
   * O `vistoEm` é carimbado aqui, pelo servidor. Não é o app que declara.
   */
  async arquivoParaMotorista(motoristaId: string, exigenciaId: string) {
    return this.arquivoParaApp({ motoristaId }, exigenciaId);
  }

  async arquivoParaApp(quem: QuemNoApp, exigenciaId: string) {
    const chave = chaveDaExigencia(exigenciaId);
    // Procura nos dois donos DELE: o arquivo pode ter sido subido pelo
    // escritório numa exigência de registrado ou de motorista.
    const donos = [
      ...(quem.motoristaId ? [{ motoristaId: quem.motoristaId }] : []),
      ...(quem.funcionarioId ? [{ funcionarioId: quem.funcionarioId }] : []),
    ];
    if (!donos.length) throw new NotFoundException("Documento não encontrado.");
    const doc = await this.prisma.motoristaDocumento.findFirst({
      where: { OR: donos, chave },
      // `hashArquivo` vai junto porque a miniatura é guardada POR VERSÃO: sem
      // ele, trocar a foto devolveria a miniatura antiga pra sempre.
      select: {
        id: true,
        storageKey: true,
        mimetype: true,
        nomeArquivo: true,
        hashArquivo: true,
      },
    });
    if (!doc) throw new NotFoundException("Documento não encontrado.");

    await this.prisma.motoristaDocumento.update({
      where: { id: doc.id },
      data: { vistoEm: new Date() },
    });
    return doc;
  }

  /**
   * O aceite eletrônico PELO APP.
   *
   * A diferença que importa em relação ao link: quem assina está autenticado
   * com CPF e senha, num aparelho que ele usa há meses. A trilha registra isso
   * (`origem: APP`) e registra se ele ABRIU o documento antes — e esse segundo
   * fato vem do banco, não de um campo que o app manda.
   *
   * O CPF continua sendo conferido contra o cadastro mesmo com JWT: é a
   * invariante que impede a porta nova de afrouxar a regra da porta velha.
   */
  async assinarPeloMotorista(
    motoristaId: string,
    exigenciaId: string,
    dados: { nome: string; cpf: string },
    ip?: string,
    userAgent?: string,
  ) {
    return this.assinarPeloApp({ motoristaId }, exigenciaId, dados, ip, userAgent);
  }

  async assinarPeloApp(
    quem: QuemNoApp,
    exigenciaId: string,
    dados: { nome: string; cpf: string },
    ip?: string,
    userAgent?: string,
  ) {
    const { exigencia, dono } = await this.exigenciaDoApp(quem, exigenciaId);
    if (!exigencia.exigeAssinatura) {
      throw new BadRequestException("Este documento não precisa de assinatura.");
    }
    if (exigencia.exigeIcpBrasil) {
      throw new BadRequestException(
        "Este documento exige certificado digital: ele tem que chegar já assinado.",
      );
    }

    const chave = chaveDaExigencia(exigencia.id);
    const doc = await this.prisma.motoristaDocumento.findFirst({
      where: { ...ondeDono(dono), chave },
      select: { storageKey: true, vistoEm: true },
    });
    if (!doc) throw new BadRequestException("O arquivo ainda não chegou aqui.");

    // O CPF confere contra o cadastro DONO do papel, seja qual for.
    const cadastro = ehDoMotorista(dono)
      ? await this.prisma.motorista.findFirst({ where: { id: dono.motoristaId }, select: { cpf: true } })
      : await this.prisma.funcionario.findFirst({ where: { id: dono.funcionarioId }, select: { cpf: true } });
    const so = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
    if (cadastro?.cpf && so(cadastro.cpf) !== so(dados.cpf)) {
      throw new BadRequestException("O CPF não confere com o do seu cadastro.");
    }

    // O hash sai do arquivo GUARDADO: é o papel que ele está assinando agora.
    const buffer = await this.uploads.getObjectBuffer(doc.storageKey);

    const assinatura = await this.prisma.assinaturaDocumento.upsert({
      where: unicoDoDono(dono, chave),
      create: {
        ...ondeDono(dono),
        tipoDocumento: exigencia.tipo,
        chave,
        modo: "SIMPLES",
        origem: "APP",
        viuDocumento: doc.vistoEm !== null,
        nomeDeclarado: dados.nome,
        cpfDeclarado: so(dados.cpf),
        ip: ip ?? null,
        userAgent: userAgent?.slice(0, 500) ?? null,
        hashArquivo: hashDoArquivo(buffer),
      },
      update: {
        modo: "SIMPLES",
        origem: "APP",
        viuDocumento: doc.vistoEm !== null,
        nomeDeclarado: dados.nome,
        cpfDeclarado: so(dados.cpf),
        ip: ip ?? null,
        userAgent: userAgent?.slice(0, 500) ?? null,
        hashArquivo: hashDoArquivo(buffer),
        conviteColetaId: null,
        assinadoEm: new Date(),
      },
    });

    this.log.log(`Documento "${exigencia.titulo}" assinado pelo app.`);
    return { assinado: true, exigenciaId, assinadoEm: assinatura.assinadoEm };
  }

  /**
   * GRAVA um documento. A regra de negócio, sem token e sem HTTP.
   *
   * ⚠️ Existem três portas pra este mesmo ato — link público, painel e app — e
   * elas JÁ divergiram: o link derrubava a assinatura ao trocar o arquivo e o
   * painel não. O resultado era uma assinatura órfã apontando, pelo hash, pra
   * um arquivo que o próprio painel tinha acabado de apagar do MinIO: o
   * sistema afirmando que o motorista assinou um papel que não existe mais.
   * Porta nova que não passe por aqui volta a criar uma quarta regra.
   *
   * Quem chama é responsável pelo `comConta` — e pelo `await` DENTRO dele.
   */
  async receberDocumento(e: {
    /** Quem é o dono. `motoristaId` sozinho segue valendo (link e painel). */
    dono?: DonoDocumento;
    motoristaId?: string;
    exigencia: {
      id: string;
      tipo: string;
      exigeAssinatura: boolean;
      exigeIcpBrasil: boolean;
      comoAssinar: "NAO" | "NO_APP" | "JA_ASSINADO";
    } | null;
    tipo: string;
    arquivo: { buffer: Buffer; mimetype: string; size: number; originalname: string };
    origem: OrigemDocumento;
    conviteColetaId?: string | null;
    validade?: Date | null;
  }) {
    const { exigencia, tipo, arquivo, origem } = e;
    const dono: DonoDocumento = e.dono ?? { motoristaId: e.motoristaId! };
    const chave = chaveDocumento({ exigenciaId: exigencia?.id ?? null, tipo });

    const deteccao = detectarAssinaturaEmbutida(
      arquivo.buffer,
      arquivo.mimetype,
      arquivo.originalname,
    );

    // `.p7s` que não carrega PKCS#7 é lixo (ou um arquivo renomeado pra furar
    // a exigência). Recusa antes de guardar.
    if (ehExtensaoAssinada(arquivo.originalname) && !deteccao.temAssinaturaEmbutida) {
      throw new BadRequestException(
        "Esse arquivo .p7s não tem assinatura digital dentro. Gere de novo no assinador.",
      );
    }
    // Contratante que só aceita assinatura DIGITAL não pode receber um
    // escaneado: a pessoa salva, acha que assinou, e a transportadora só
    // descobre na auditoria.
    //
    // ⚠️ Isto vale só pro contratante rigoroso (`exigeIcpBrasil`). O caso
    // comum é `JA_ASSINADO` sem essa marca, que aceita os DOIS caminhos reais
    // da operação: o PDF do gov.br (assinatura dentro do arquivo) e a foto do
    // papel com firma reconhecida em cartório. Recusar a segunda fazia o
    // motorista ir ao cartório, pagar, e o app dizer não.
    if (exigencia?.exigeIcpBrasil && !deteccao.temAssinaturaEmbutida) {
      throw new BadRequestException(
        "Este documento só vale assinado com certificado digital. " +
          "Assine em gov.br/assinatura-eletronica e mande o arquivo assinado (PDF ou .p7s) — " +
          "a foto do papel não serve pra este.",
      );
    }

    const hash = hashDoArquivo(arquivo.buffer);

    // O objeto anterior sai do MinIO antes do novo entrar: a key muda quando a
    // extensão muda, e sem remover ficava lixo no bucket.
    const anterior = await this.prisma.motoristaDocumento.findFirst({
      where: { ...ondeDono(dono), chave },
      select: { storageKey: true },
    });

    const storageKey = await this.uploads.putMotoristaDocumento(
      arquivo.buffer,
      arquivo.mimetype,
      pastaDoDono(dono),
      chave,
      arquivo.originalname,
    );
    if (anterior && anterior.storageKey !== storageKey) {
      await this.uploads.removerObjeto(anterior.storageKey).catch(() => {
        // Objeto órfão no bucket não pode derrubar o envio do motorista: o que
        // importa é o arquivo novo ter entrado.
      });
    }

    const doc = await this.prisma.motoristaDocumento.upsert({
      where: unicoDoDono(dono, chave),
      create: {
        ...ondeDono(dono),
        tipo: tipo as never,
        exigenciaId: exigencia?.id ?? null,
        chave,
        storageKey,
        nomeArquivo: arquivo.originalname,
        mimetype: arquivo.mimetype,
        tamanho: arquivo.size,
        hashArquivo: hash,
        origem,
        validade: e.validade ?? null,
      },
      update: {
        tipo: tipo as never,
        exigenciaId: exigencia?.id ?? null,
        storageKey,
        nomeArquivo: arquivo.originalname,
        mimetype: arquivo.mimetype,
        tamanho: arquivo.size,
        hashArquivo: hash,
        origem,
        // ⚠️ Arquivo novo zera a conferência, pelo mesmo motivo que derruba a
        // assinatura: quem conferiu olhou O ARQUIVO ANTERIOR. Manter o visto
        // faria a ficha dizer que alguém aprovou um papel que ninguém viu.
        // Vale também pra recusa: mandar de novo é a resposta a ela.
        conferidoEm: null,
        conferidoPor: null,
        recusadoEm: null,
        recusadoPor: null,
        recusaMotivo: null,
        ...(e.validade === undefined ? {} : { validade: e.validade }),
      },
    });

    // Trocar o arquivo DERRUBA a assinatura antiga. Ela apontava, pelo hash,
    // pro papel anterior — mantê-la faria a tela dizer que a pessoa assinou um
    // documento que ela nunca viu.
    await this.prisma.assinaturaDocumento.deleteMany({ where: { ...ondeDono(dono), chave } });

    // Arquivo que já chega assinado dispensa o aceite: a assinatura é o
    // próprio arquivo, e pedir pra digitar o nome depois seria teatro.
    //
    // Dois jeitos de chegar assinado, e o registro diz QUAL foi:
    //
    // - **Digital** (gov.br, certificado): a assinatura está dentro do arquivo.
    //   O sistema detecta e carimba `ICP_BRASIL` — sem validar a cadeia, e a
    //   tela do escritório diz isso (`AVISO_ICP`).
    // - **No papel** (cartório): é tinta numa foto. Não há nada pra detectar,
    //   então o registro é `NO_PAPEL` — que significa "chegou dizendo estar
    //   assinado, CONFIRA". Tratar isso como assinatura conferida seria a
    //   única coisa pior do que não registrar nada.
    if (exigencia?.comoAssinar === "JA_ASSINADO") {
      await this.prisma.assinaturaDocumento.create({
        data: {
          ...ondeDono(dono),
          tipoDocumento: tipo,
          chave,
          modo: deteccao.temAssinaturaEmbutida ? "ICP_BRASIL" : "NO_PAPEL",
          origem: e.origem,
          hashArquivo: hash,
          conviteColetaId: e.conviteColetaId ?? null,
        },
      });
    } else if (deteccao.temAssinaturaEmbutida && exigencia?.exigeAssinatura) {
      // Exigência de aceite no app que recebeu um arquivo já assinado por
      // fora: a assinatura de dentro do arquivo vale mais que o aceite, e
      // pedir o aceite por cima seria pedir duas vezes a mesma coisa.
      await this.prisma.assinaturaDocumento.create({
        data: {
          ...ondeDono(dono),
          tipoDocumento: tipo,
          chave,
          modo: "ICP_BRASIL",
          origem: e.origem,
          hashArquivo: hash,
          conviteColetaId: e.conviteColetaId ?? null,
        },
      });
    }

    return { doc, assinaturaEmbutida: deteccao.temAssinaturaEmbutida };
  }

  /**
   * Recebe um arquivo pelo link público.
   *
   * O `comConta` embrulha a escrita inteira e o `await` mora DENTRO dele: a
   * promise do Prisma é preguiçosa, e devolvê-la pra fora do `run` faria a
   * consulta executar sem conta no contexto — a trava lançaria, ou pior,
   * gravaria no lugar errado.
   */
  async receberArquivo(
    token: string,
    alvo: { exigenciaId?: string; tipo?: string },
    arquivo: { buffer: Buffer; mimetype: string; size: number; originalname: string },
  ) {
    const c = await this.resolverToken(token);

    if (c.enviosFeitos >= MAX_ENVIOS_POR_CONVITE) {
      throw new ForbiddenException("Este link já recebeu arquivos demais. Peça um novo.");
    }
    checarArquivoEnviado(arquivo, {
      mimes: MIMES_DOCUMENTO,
      maxBytes: MAX_BYTES,
      // `.p7s`/`.p7m` do gov.br chegam como octet-stream: recusar pelo mime
      // jogaria fora justamente o documento ASSINADO.
      extensoesTambem: ASSINATURA_DESTACADA,
      comoDizer: "Mande uma foto, um PDF ou o arquivo assinado (.p7s).",
    });

    return comConta(c.contaId, async () => {
      // Só aceita o que ESTE motorista precisa mandar. Sem isto, um link
      // válido viraria upload livre de qualquer gaveta.
      const exigidos = await this.exigidosPara(c.motoristaId);
      const exigencia = this.acharExigencia(exigidos, alvo);

      // Reenviar SUBSTITUI. É o "refazer a foto": a primeira saiu tremida, a
      // segunda vale. O upsert lá dentro já fazia isso no banco; o que faltava
      // era a página oferecer o caminho.
      const { assinaturaEmbutida } = await this.receberDocumento({
        motoristaId: c.motoristaId,
        exigencia,
        tipo: exigencia.tipo,
        arquivo,
        origem: "LINK",
        conviteColetaId: c.id,
      });

      await this.prisma.conviteColeta.update({
        where: { id: c.id },
        data: { enviosFeitos: { increment: 1 } },
      });

      this.log.log(`Documento "${exigencia.titulo}" recebido pelo link de coleta.`);
      return { recebido: true, exigenciaId: exigencia.id, tipo: exigencia.tipo, assinaturaEmbutida };
    });
  }

  /**
   * Qual exigência o envio está atendendo.
   *
   * ⚠️ O `tipo` sozinho NÃO identifica mais nada — é aqui que o defeito antigo
   * morava. `exigidos.find(e => e.tipo === tipo)` devolvia a primeira da lista,
   * sem critério, e as exigências gerais vêm junto com as do contratante: uma
   * "OS" geral sem assinatura ganhava da "OS" do contratante que exige ICP, e
   * a validação simplesmente não rodava. O caminhão era barrado na portaria.
   *
   * Por isso o `exigenciaId` é o caminho normal, e o `tipo` só é aceito quando
   * ele é inequívoco. Ambíguo, recusa e explica — nunca escolhe por sorteio.
   */
  private acharExigencia<T extends { id: string; tipo: string; titulo: string }>(
    exigidos: T[],
    alvo: { exigenciaId?: string; tipo?: string },
  ): T {
    if (alvo.exigenciaId) {
      const e = exigidos.find((x) => x.id === alvo.exigenciaId);
      if (!e) throw new BadRequestException("Este documento não é pedido aqui.");
      return e;
    }
    if (!alvo.tipo) throw new BadRequestException("Diga qual documento é.");

    this.assertTipo(alvo.tipo);
    const candidatos = exigidos.filter((x) => x.tipo === alvo.tipo);
    if (candidatos.length === 0) {
      throw new BadRequestException("Este documento não é pedido aqui.");
    }
    if (candidatos.length > 1) {
      throw new BadRequestException(
        `Mais de um documento usa essa gaveta (${candidatos.map((c) => c.titulo).join(", ")}). ` +
          "Atualize a página e escolha qual deles você está mandando.",
      );
    }
    return candidatos[0];
  }

  /**
   * O aceite eletrônico de um documento já enviado.
   *
   * Assinatura eletrônica SIMPLES, que a MP 2.200-2 (art. 10, §2º) admite
   * quando as partes aceitam — e o que dá valor a ela é a trilha, não o
   * clique: quem declarou ser, o CPF, o IP, a hora e o HASH do arquivo
   * naquele momento.
   *
   * O hash é a peça que não pode faltar. Sem ele, "fulano assinou a ordem de
   * serviço" é frase solta: trocar o arquivo depois deixaria a assinatura
   * apontando pro papel novo. Com ele, reenviar derruba a assinatura e a tela
   * diz isso em vez de mentir.
   *
   * ⚠️ O CPF tem que ser o DO MOTORISTA. É o que impede o dono do caminhão
   * assinar no lugar dele — que é exatamente o que aconteceria, por
   * conveniência, se a página aceitasse qualquer nome.
   */
  async assinarDocumento(
    token: string,
    dados: { exigenciaId?: string; tipo?: string; nome: string; cpf: string },
    ip?: string,
    userAgent?: string,
  ) {
    const c = await this.resolverToken(token);

    return comConta(c.contaId, async () => {
      const exigidos = await this.exigidosPara(c.motoristaId);
      const exigencia = this.acharExigencia(exigidos, dados);
      if (!exigencia.exigeAssinatura) {
        throw new BadRequestException("Este documento não precisa de assinatura.");
      }
      if (exigencia.exigeIcpBrasil) {
        throw new BadRequestException(
          "Este documento exige certificado digital: mande o arquivo já assinado, não há o que aceitar aqui.",
        );
      }

      const chave = chaveDaExigencia(exigencia.id);
      const doc = await this.prisma.motoristaDocumento.findFirst({
        where: { motoristaId: c.motoristaId, chave },
        select: { storageKey: true },
      });
      if (!doc) throw new BadRequestException("Mande o arquivo antes de assinar.");

      const motorista = await this.prisma.motorista.findFirst({
        where: { id: c.motoristaId },
        select: { cpf: true },
      });
      const so = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
      if (motorista?.cpf && so(motorista.cpf) !== so(dados.cpf)) {
        throw new BadRequestException(
          "O CPF não confere com o do motorista. Quem assina tem que ser ele.",
        );
      }

      // O hash sai do arquivo que está GUARDADO, não de um que veio junto: é o
      // papel que a pessoa está assinando agora.
      const buffer = await this.uploads.getObjectBuffer(doc.storageKey);

      const assinatura = await this.prisma.assinaturaDocumento.upsert({
        where: { motoristaId_chave: { motoristaId: c.motoristaId, chave } },
        create: {
          motoristaId: c.motoristaId,
          tipoDocumento: exigencia.tipo,
          chave,
          modo: "SIMPLES",
          nomeDeclarado: dados.nome,
          cpfDeclarado: so(dados.cpf),
          ip: ip ?? null,
          userAgent: userAgent?.slice(0, 500) ?? null,
          hashArquivo: hashDoArquivo(buffer),
          conviteColetaId: c.id,
        },
        update: {
          modo: "SIMPLES",
          nomeDeclarado: dados.nome,
          cpfDeclarado: so(dados.cpf),
          ip: ip ?? null,
          userAgent: userAgent?.slice(0, 500) ?? null,
          hashArquivo: hashDoArquivo(buffer),
          conviteColetaId: c.id,
          assinadoEm: new Date(),
        },
      });

      this.log.log(`Documento "${exigencia.titulo}" assinado pelo link de coleta.`);
      return {
        assinado: true,
        exigenciaId: exigencia.id,
        tipo: exigencia.tipo,
        assinadoEm: assinatura.assinadoEm,
      };
    });
  }
}
