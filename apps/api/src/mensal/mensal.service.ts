import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  CriarAlocacaoInput,
  EditarAlocacaoInput,
  LancarPresencaPainelInput,
  RegistrarPresencaInput,
} from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { inicioDoDiaBR, ymdSaoPaulo } from "../common/timezone";
import { competenciaDe, montarEspelho, type Espelho } from "../common/espelho-mensal";
import {
  compararMedicao,
  resumirDivergencias,
  type LadoDeles,
} from "../common/medicao-mensal";
import { valorDaDiariaObra, type TabelaPrecoRow } from "../common/viagem-preco";
import { resolverRemuneracao } from "../common/acerto-motorista";
import { abrirRegime, encerrarRegime, regimeVivo } from "../common/regime-vigente";
import { parseXlsx } from "../fechamentos/parsers/xlsx-parser";
import { lerMedicaoDaPlanilha } from "./medicao-planilha";
import { montarModeloMedicao } from "./medicao-modelo";
import { Prisma } from "@prisma/client";

/** "2026-09-19" → Date de meia-noite UTC, que é como coluna Date se compara. */
function dia(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/**
 * O que os dias registrados valem, dia a dia.
 *
 * Por dia, e não "dias × preço do mês", porque reajuste no meio da competência
 * tem que valer do dia em que entrou — é assim que o preço da viagem já
 * funciona, e divergir aqui faria a mesma tabela produzir dois resultados
 * conforme quem pergunta.
 *
 * `unitario` só vem preenchido quando UM preço valeu o período inteiro. Com
 * reajuste no meio não existe "o preço da diária", e inventar um faria a
 * multiplicação da divergência mentir — melhor a tela não mostrar número do
 * que mostrar um que não se sustenta na mesa.
 */
function valorDosDias(
  tabelas: TabelaPrecoRow[],
  empresaId: string,
  dias: string[],
): { total: string; unitario: string | null; motivo: string | null } {
  if (dias.length === 0) return { total: "0.00", unitario: null, motivo: null };

  let total = new Prisma.Decimal(0);
  const precos = new Set<string>();
  let motivo: string | null = null;

  for (const d of dias) {
    const r = valorDaDiariaObra({ tabelas, empresaId, data: d });
    if (r.motivo) {
      motivo = r.motivo;
      continue;
    }
    const p = new Prisma.Decimal(r.linha.precoUnitario as Prisma.Decimal);
    total = total.add(p);
    precos.add(p.toFixed(2));
  }

  return {
    total: total.toFixed(2),
    unitario: precos.size === 1 ? [...precos][0]! : null,
    motivo: total.isZero() ? motivo : null,
  };
}

/** Date de coluna Date → "2026-09-19", sem passar pelo fuso do container. */
export function paraYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * O mensal: o caminhão à disposição de uma obra, pago por diária.
 *
 * ⚠️ Antes de mexer aqui, leia o cabeçalho de `shared-types/src/mensal.ts`.
 * Não existe ponto, jornada, falta nem atraso neste módulo — nem no código,
 * nem em texto de tela. O motorista é parceiro autônomo e o que se registra é
 * a presença do CAMINHÃO na obra num dia.
 */
@Injectable()
export class MensalService {
  private readonly log = new Logger(MensalService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------- alocação ---

  async listarAlocacoes(filtros: { clienteId?: string; ativas?: boolean }) {
    return this.prisma.alocacaoObra.findMany({
      where: {
        ...(filtros.clienteId ? { clienteId: filtros.clienteId } : {}),
        ...(filtros.ativas === undefined ? {} : { ativa: filtros.ativas }),
      },
      include: {
        cliente: { select: { id: true, nome: true } },
        motorista: { select: { id: true, nome: true, cpf: true } },
        veiculo: { select: { id: true, placa: true } },
      },
      orderBy: [{ ativa: "desc" }, { inicio: "desc" }],
    });
  }

  /**
   * Cria a alocação — e é ela que faz o app do motorista não perguntar nada.
   *
   * A trava de UMA obra por vez mora no banco (índice único sobre `vigenteDe`),
   * mas a checagem acontece aqui antes pra que o erro seja uma frase que a
   * pessoa entende, e não uma violação de constraint.
   */
  async criarAlocacao(dados: CriarAlocacaoInput, usuarioId: string) {
    const [cliente, motorista, veiculo] = await Promise.all([
      this.prisma.cliente.findFirst({ where: { id: dados.clienteId }, select: { id: true, nome: true } }),
      this.prisma.motorista.findFirst({
        where: { id: dados.motoristaId },
        select: { id: true, nome: true, status: true, cpf: true },
      }),
      this.prisma.veiculo.findFirst({ where: { id: dados.veiculoId }, select: { id: true, placa: true } }),
    ]);
    if (!cliente) throw new NotFoundException("Obra não encontrada.");
    if (!motorista) throw new NotFoundException("Motorista não encontrado.");
    if (!veiculo) throw new NotFoundException("Caminhão não encontrado.");

    if (dados.fim && dados.fim < dados.inicio) {
      throw new BadRequestException("O fim não pode ser antes do início.");
    }

    const viva = await this.prisma.alocacaoObra.findFirst({
      where: { motoristaId: dados.motoristaId, ativa: true },
      include: { cliente: { select: { nome: true } } },
    });
    if (viva) {
      // Mensagem com o nome da obra de propósito: "já tem alocação ativa" faria
      // a pessoa abrir outra tela pra descobrir qual.
      throw new ConflictException(
        `${motorista.nome} já está alocado na obra ${viva.cliente.nome}. Encerre aquela alocação antes de criar outra.`,
      );
    }

    // As duas escritas na MESMA transação: a alocação e o registro de que esta
    // pessoa é parceira autônoma nesta empresa. Separadas, uma falha deixaria
    // a outra de pé — e o furo seria exatamente o que a trava existe pra
    // impedir. O `await` mora DENTRO, porque a promise do Prisma é preguiçosa
    // e a trava de conta vive num AsyncLocalStorage.
    return this.prisma.$transaction(async (tx) => {
      /**
       * ⚠️ O REGIME DERIVA DO VÍNCULO QUE JÁ EXISTE, e não do formulário.
       *
       * Até 21/09/2026 isto abria PARCEIRO incondicionalmente, e quem já era
       * registrado em carteira batia num 409 sem caminho de saída: "encerre o
       * anterior antes de continuar" — mas o anterior é o contrato de trabalho
       * dele, que ninguém encerra pra entrar numa obra. O escritório ficava
       * sem conseguir alocar o próprio empregado.
       *
       * Com regime derivado: empregado entra na obra como EMPREGADO, e a
       * alocação passa a significar o CAMINHÃO-DIA à disposição do contratante
       * — fato comercial —, não um contrato de parceria que contradiria a
       * carteira assinada dele.
       */
      const vivo = await regimeVivo(tx, motorista.cpf ?? "");
      const regime = vivo?.regime ?? "PARCEIRO";

      if (regime === "PARCEIRO") {
        await abrirRegime(tx, {
          cpf: motorista.cpf ?? "",
          regime: "PARCEIRO",
          inicio: dia(dados.inicio),
          criadoPorId: usuarioId,
        });
      }

      // Dinheiro por dia pra empregado é salário por fora (art. 457 §1º da
      // CLT). O banco tem CHECK, mas a recusa vem aqui pra virar uma frase que
      // a pessoa entende em vez de violação de constraint.
      if (regime === "EMPREGADO" && dados.valorDiariaCentavos !== undefined) {
        throw new BadRequestException(
          `${motorista.nome} é registrado em carteira nesta empresa. ` +
            "A diária não se paga por fora da folha — deixe o valor em branco: " +
            "a obra mede o caminhão-dia, e o pagamento dele sai pela folha.",
        );
      }

      return tx.alocacaoObra.create({
        data: {
          clienteId: dados.clienteId,
          motoristaId: dados.motoristaId,
          veiculoId: dados.veiculoId,
          regime,
          inicio: dia(dados.inicio),
          fim: dados.fim ? dia(dados.fim) : null,
          valorDiaria:
            dados.valorDiariaCentavos === undefined ? null : dados.valorDiariaCentavos / 100,
          // Enquanto viva, a chave é o motorista: é isto que o índice único usa
          // pra garantir uma obra por vez sem proibir histórico.
          vigenteDe: dados.motoristaId,
          criadoPorId: usuarioId,
        },
      });
    });
  }

  async editarAlocacao(id: string, dados: EditarAlocacaoInput) {
    const a = await this.buscarAlocacao(id);
    if (!a.ativa) throw new ConflictException("Alocação encerrada não se edita.");

    const inicio = dados.inicio ? dia(dados.inicio) : a.inicio;
    const fim = dados.fim ? dia(dados.fim) : a.fim;
    if (fim && fim < inicio) {
      throw new BadRequestException("O fim não pode ser antes do início.");
    }

    // Empurrar o início pra depois de um dia já registrado deixaria aquele dia
    // fora da vigência — presente no banco e invisível no espelho, que é a
    // pior combinação: some da conta sem ninguém apagar nada.
    if (dados.inicio) {
      const primeiro = await this.prisma.registroPresenca.findFirst({
        where: { alocacaoId: id },
        orderBy: { data: "asc" },
        select: { data: true },
      });
      if (primeiro && inicio > primeiro.data) {
        throw new BadRequestException(
          `Já existe dia registrado em ${paraYmd(primeiro.data)}. O início não pode ser depois disso.`,
        );
      }
    }

    return this.prisma.alocacaoObra.update({
      where: { id },
      data: {
        ...(dados.inicio === undefined ? {} : { inicio }),
        ...(dados.fim === undefined ? {} : { fim: dia(dados.fim) }),
        ...(dados.valorDiariaCentavos === undefined
          ? {}
          : { valorDiaria: dados.valorDiariaCentavos / 100 }),
      },
    });
  }

  /**
   * Encerrar NÃO apaga: os dias registrados apontam pra alocação, e o espelho
   * de um mês fechado tem que continuar legível daqui a um ano.
   *
   * `vigenteDe` vira nulo no MESMO update que `ativa: false` — é isso que
   * libera a próxima alocação sem quebrar o índice único.
   */
  async encerrarAlocacao(id: string, motivo: string) {
    const a = await this.buscarAlocacao(id);
    if (!a.ativa) return a;

    const motorista = await this.prisma.motorista.findFirst({
      where: { id: a.motoristaId },
      select: { cpf: true },
    });

    return this.prisma.$transaction(async (tx) => {
      const atualizada = await tx.alocacaoObra.update({
        where: { id },
        data: { ativa: false, vigenteDe: null, encerradaEm: new Date(), encerradaMotivo: motivo },
      });
      // Libera a pessoa da trava junto: quem encerrou aqui pode ser contratado
      // amanhã, e deixar a chave presa faria o cadastro dele ser recusado sem
      // que ninguém entendesse por quê.
      //
      // ⚠️ Mas SÓ se o regime vivo for o que esta alocação abriu. Encerrar uma
      // obra não pode desfazer um vínculo de EMPREGO: a alocação e o contrato
      // de trabalho são fatos independentes, e quem encerra obra no painel não
      // está demitindo ninguém. Sem esta checagem, encerrar a obra de um
      // motorista registrado soltaria a chave dele em silêncio — e o próximo
      // `criarAlocacao` abriria um regime de PARCEIRO por cima de um contrato
      // de trabalho vivo, que é exatamente o desenho que a trava existe pra
      // impedir.
      if (motorista?.cpf) {
        // O alvo vai no WHERE do encerramento: decidir aqui fora com um
        // `findFirst` antes deixava uma fresta entre ler e escrever.
        await encerrarRegime(tx, { cpf: motorista.cpf, motivo, regime: "PARCEIRO" });
      }
      return atualizada;
    });
  }

  private async buscarAlocacao(id: string) {
    const a = await this.prisma.alocacaoObra.findFirst({ where: { id } });
    if (!a) throw new NotFoundException("Alocação não encontrada.");
    return a;
  }

  // ----------------------------------------------------------- presença ---

  /**
   * A obra de hoje, do ponto de vista do motorista. É o que decide se ele vê o
   * botão gigante ou a home normal.
   *
   * Devolve também os dias em branco do período aberto: são eles que viram a
   * pendência na tela dele. Dia em branco NÃO é falta — é dia que ninguém
   * marcou, e só ele pode dizer se esteve lá.
   */
  async obraDeHoje(motoristaId: string) {
    const a = await this.prisma.alocacaoObra.findFirst({
      // ⚠️ `regime: PARCEIRO` decide QUEM VÊ A CONTA DE DIÁRIAS no app.
      //
      // Quem é registrado em carteira também é alocado numa obra — a alocação
      // dele existe e mede o caminhão-dia pro contratante. O que ele NÃO pode
      // ver é o bloco de diárias: "somar o dia", "sua conta do mês", o léxico
      // inteiro é de parceiro autônomo, e mostrá-lo a um empregado desenha os
      // dois vínculos na mesma pessoa, na mesma tela, no mesmo período. Ele
      // registra a jornada dele na aba Ponto, que é o instrumento certo.
      where: { motoristaId, ativa: true, regime: "PARCEIRO" },
      include: { cliente: { select: { id: true, nome: true } }, veiculo: { select: { placa: true } } },
    });
    if (!a) return { alocacao: null, hoje: null, pendentes: [] as string[] };

    const [ano, mes, d] = ymdSaoPaulo();
    const hojeYmd = `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

    const desde = a.inicio > dia(`${ano}-${String(mes).padStart(2, "0")}-01`)
      ? a.inicio
      : dia(`${ano}-${String(mes).padStart(2, "0")}-01`);

    const registros = await this.prisma.registroPresenca.findMany({
      where: { alocacaoId: a.id, data: { gte: desde, lte: dia(hojeYmd) } },
      select: { data: true },
    });
    const marcados = new Set(registros.map((r) => paraYmd(r.data)));

    // O total do MÊS, pelo mesmo critério de `meusDias`.
    //
    // Tem que ser o mesmo, e não "os dias desta alocação": o número do card é
    // a PORTA da tela do mês, e o motorista pode ter tido duas obras em
    // sequência no mesmo mês. Card mostrando 8 e a tela que ele abre mostrando
    // 19 é o pior lugar possível pra uma divergência — o produto existe
    // justamente pra ser contraprova.
    const doMes = await this.meusDias(motoristaId, `${ano}-${String(mes).padStart(2, "0")}`);

    return {
      alocacao: {
        id: a.id,
        obra: a.cliente.nome,
        placa: a.veiculo.placa,
      },
      hoje: { data: hojeYmd, registrado: marcados.has(hojeYmd) },
      /** Quantas diárias já entraram na conta deste mês. É o herói da tela. */
      mes: { rotulo: `${ano}-${String(mes).padStart(2, "0")}`, total: doMes.total },
      pendentes: this.diasEntre(desde, dia(hojeYmd)).filter(
        (x) => x !== hojeYmd && !marcados.has(x),
      ),
    };
  }

  /** Todos os dias de um intervalo, inclusive, em "AAAA-MM-DD". */
  private diasEntre(de: Date, ate: Date): string[] {
    const out: string[] = [];
    for (let t = de.getTime(); t <= ate.getTime(); t += 86_400_000) {
      out.push(paraYmd(new Date(t)));
    }
    return out;
  }

  /**
   * O toque. Um dia, uma linha.
   *
   * Idempotente por construção e em dois níveis: o `clientId` do outbox é
   * determinístico e o banco tem unique em (alocação, dia). Tocar cinco vezes
   * com 4G ruim continua sendo um dia, e a segunda tentativa devolve 200 com o
   * registro que já existe — nunca 409 na cara do motorista, que não teria o
   * que fazer com um conflito.
   */
  async registrarPresenca(motoristaId: string, dados: RegistrarPresencaInput) {
    const a = await this.prisma.alocacaoObra.findFirst({
      where: { motoristaId, ativa: true },
      select: { id: true, inicio: true, fim: true, regime: true },
    });
    // 4xx, nunca 500: erro de servidor trava o outbox em loop, e um 4xx manda o
    // item pra tela de Pendentes, onde alguém resolve.
    if (!a) throw new BadRequestException("Você não está alocado em nenhuma obra.");
    // Cinto de segurança do filtro em `obraDeHoje`: quem é registrado não vê o
    // botão, mas um app com cache antigo (ou um item do outbox enfileirado
    // antes da contratação) ainda pode tentar. Diária de empregado não se
    // registra — a jornada dele é o ponto.
    if (a.regime === "EMPREGADO") {
      // ⚠️ A frase NÃO pode citar o outro módulo pelo nome: o léxico deste
      // arquivo é varrido por teste, e o motivo é o mesmo da regra toda — o
      // mensal não fala da jornada de ninguém. Quem sabe explicar o caminho é
      // o app, que já mostra a aba certa pra quem é registrado.
      throw new BadRequestException("Nesta obra o seu dia não é contado por diária.");
    }

    const d = dia(dados.data);
    if (d < a.inicio) throw new BadRequestException("Esse dia é anterior ao início na obra.");
    if (a.fim && d > a.fim) throw new BadRequestException("Esse dia é posterior ao fim na obra.");
    if (d.getTime() > inicioDoDiaBR(paraYmd(new Date())).getTime() + 86_400_000) {
      throw new BadRequestException("Não dá pra marcar presença em dia futuro.");
    }

    const existente = await this.prisma.registroPresenca.findFirst({
      where: { alocacaoId: a.id, data: d },
    });
    if (existente) return existente;

    return this.prisma.registroPresenca.create({
      data: {
        alocacaoId: a.id,
        data: d,
        origem: "APP",
        clientId: dados.clientId,
        latitude: dados.latitude ?? null,
        longitude: dados.longitude ?? null,
        precisao: dados.precisao ?? null,
      },
    });
  }

  /**
   * O motorista desmarcando o próprio dia.
   *
   * Não contradiz a regra de que o PAINEL não apaga dia marcado no app: ali o
   * escritório apagaria prova de outra pessoa sem ela saber. Aqui é ele
   * mesmo, sobre o registro dele — e existir esse caminho é o que torna
   * honesto não ter diálogo de confirmação antes do toque. Sem desfazer, um
   * toque errado seria definitivo, e aí a tela precisaria perguntar "tem
   * certeza?" a cada dia, todo dia.
   *
   * Só mexe no que veio do APP: dia lançado pelo escritório tem motivo escrito
   * e história própria, e some só por lá.
   */
  async desmarcarPresenca(motoristaId: string, dataYmd: string) {
    const a = await this.prisma.alocacaoObra.findFirst({
      where: { motoristaId, ativa: true },
      select: { id: true, regime: true },
    });
    if (!a) throw new BadRequestException("Você não está alocado em nenhuma obra.");
    // Mesma trava de `registrarPresenca`, e a assimetria era o defeito: marcar
    // era recusado pra quem é registrado, desmarcar passava. Um caminho aberto
    // sobre o registro de diária é um caminho sobre o mesmo assunto.
    if (a.regime === "EMPREGADO") {
      throw new BadRequestException("Nesta obra o seu dia não é contado por diária.");
    }

    const r = await this.prisma.registroPresenca.findFirst({
      where: { alocacaoId: a.id, data: dia(dataYmd) },
    });
    // Nada a desfazer não é erro: o app pode estar desfazendo algo que nunca
    // chegou a subir, e devolver 404 faria a tela mostrar falha num sucesso.
    if (!r) return { desmarcado: true };

    if (r.origem !== "APP") {
      throw new ForbiddenException(
        "Esse dia foi lançado pelo escritório. Fale com eles para corrigir.",
      );
    }

    await this.prisma.registroPresenca.delete({ where: { id: r.id } });
    return { desmarcado: true };
  }

  /**
   * Os dias do mês, do ponto de vista do motorista.
   *
   * Pra quem é pago por diária, "quantos dias eu já fiz" é a pergunta do mês
   * inteiro — e até agora ele só conseguia responder de cabeça. O escritório
   * tem a grade; ele não tinha nada.
   *
   * Vale pra QUALQUER alocação dele no mês, não só a ativa: obra que terminou
   * dia 10 e outra que começou dia 11 são dois contratos e um mês só, e somar
   * errado aqui é discutir pagamento com número errado.
   *
   * O que este método NÃO devolve: valor em dinheiro. Isso é conversa do
   * acerto, e misturar transformaria uma tela de conferência numa tela de
   * cobrança. Existe a flag `podeVerValorDiaria` pra quando for a hora.
   */
  async meusDias(motoristaId: string, mesRotulo: string) {
    const [ano, mes] = mesRotulo.split("-").map(Number);
    if (!ano || !mes) throw new BadRequestException("Mês inválido.");
    const primeiro = new Date(Date.UTC(ano, mes - 1, 1));
    const ultimo = new Date(Date.UTC(ano, mes, 0));

    const alocacoes = await this.prisma.alocacaoObra.findMany({
      where: {
        motoristaId,
        // ⚠️ Mesmo filtro de `obraDeHoje`, e faltar aqui era um buraco com
        // dinheiro dentro: a home escondia o bloco pra quem é registrado, mas
        // esta rota seguia aberta e a tela dela diz "cada dia na obra é uma
        // diária" — com valor, quando ele pode ver valor. O léxico de parceiro
        // autônomo inteiro, pra um empregado, na mesma empresa.
        regime: "PARCEIRO",
        inicio: { lte: ultimo },
        OR: [{ fim: null }, { fim: { gte: primeiro } }],
      },
      include: { cliente: { select: { nome: true } } },
    });
    if (alocacoes.length === 0) return { mes: mesRotulo, total: 0, dias: [], obras: [] };

    const registros = await this.prisma.registroPresenca.findMany({
      where: {
        alocacaoId: { in: alocacoes.map((a) => a.id) },
        data: { gte: primeiro, lte: ultimo },
      },
      select: { data: true, origem: true, alocacaoId: true },
      orderBy: { data: "asc" },
    });
    const marcados = new Map(registros.map((r) => [paraYmd(r.data), r.origem]));

    // Um dia "vazio" só existe se ele estava alocado naquele dia E o dia já
    // passou. Cobrar dia futuro seria inventar dívida; cobrar dia fora da
    // vigência seria cobrar de quem nem estava lá.
    const [ay, am, ad] = ymdSaoPaulo();
    const hoje = `${ay}-${String(am).padStart(2, "0")}-${String(ad).padStart(2, "0")}`;
    const alocadoEm = (d: string) =>
      alocacoes.some((a) => d >= paraYmd(a.inicio) && (!a.fim || d <= paraYmd(a.fim)));

    const dias = this.diasEntre(primeiro, ultimo)
      .filter((d) => alocadoEm(d))
      .map((d) => ({
        data: d,
        marcado: marcados.has(d),
        origem: marcados.get(d) ?? null,
        futuro: d > hoje,
      }));

    return {
      mes: mesRotulo,
      total: registros.length,
      dias,
      obras: [...new Set(alocacoes.map((a) => a.cliente.nome))],
      valor: await this.valorDoMotoristaNoMes(motoristaId, alocacoes, registros),
    };
  }

  /**
   * Quanto os dias do mês valem PRA ELE — ou `null`, que é o default.
   *
   * Sai desligado (`Motorista.podeVerValorDiaria` nasce false) e é o dono quem
   * liga, por motorista. Não é pudor: misturar dinheiro na tela de conferência
   * transforma um documento de contraprova numa tela de cobrança, e a primeira
   * coisa que ele veria de manhã seria quanto tem a receber. Quando o combinado
   * é claro, ligar ajuda; quando não é, atrapalha — e quem sabe qual dos dois é
   * o caso não é o código.
   *
   * O valor é o DELE (a régua do acerto), nunca o que a obra paga ao
   * contratante. São números diferentes e confundir os dois seria mostrar ao
   * motorista a margem da transportadora.
   */
  private async valorDoMotoristaNoMes(
    motoristaId: string,
    alocacoes: { id: string; valorDiaria: Prisma.Decimal | null }[],
    registros: { alocacaoId: string }[],
  ): Promise<{ total: string; unitario: string | null } | null> {
    const m = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: {
        podeVerValorDiaria: true,
        tipoRemuneracao: true,
        percentualFrete: true,
        valorPorViagem: true,
        valorPorTonelada: true,
        valorPorKm: true,
        valorDiaria: true,
        modalidade: true,
      },
    });
    if (!m?.podeVerValorDiaria) return null;

    const regra = resolverRemuneracao(m, m.modalidade);
    const porAlocacao = new Map(alocacoes.map((a) => [a.id, a.valorDiaria]));

    let total = new Prisma.Decimal(0);
    const precos = new Set<string>();
    for (const r of registros) {
      const v = porAlocacao.get(r.alocacaoId) ?? regra.valorDiaria;
      if (v == null) continue;
      const d = new Prisma.Decimal(v as Prisma.Decimal);
      total = total.add(d);
      precos.add(d.toFixed(2));
    }
    // Duas obras no mesmo mês com diárias diferentes não têm "o valor da
    // diária" — o total continua certo, o unitário some.
    return { total: total.toFixed(2), unitario: precos.size === 1 ? [...precos][0]! : null };
  }

  /** A grade do período, por alocação. É a base do espelho da Fase 2. */
  async grade(clienteId: string | undefined, de: string, ate: string) {
    const registros = await this.prisma.registroPresenca.findMany({
      where: {
        data: { gte: dia(de), lte: dia(ate) },
        ...(clienteId ? { alocacao: { clienteId } } : {}),
      },
      include: {
        alocacao: {
          include: {
            cliente: { select: { id: true, nome: true } },
            motorista: { select: { id: true, nome: true } },
            veiculo: { select: { placa: true } },
          },
        },
      },
      orderBy: [{ data: "asc" }],
    });

    const porAlocacao = new Map<string, { alocacao: unknown; dias: { data: string; origem: string }[] }>();
    for (const r of registros) {
      const atual = porAlocacao.get(r.alocacaoId) ?? {
        alocacao: {
          id: r.alocacao.id,
          obra: r.alocacao.cliente.nome,
          motorista: r.alocacao.motorista.nome,
          placa: r.alocacao.veiculo.placa,
        },
        dias: [],
      };
      atual.dias.push({ data: paraYmd(r.data), origem: r.origem });
      porAlocacao.set(r.alocacaoId, atual);
    }

    return [...porAlocacao.values()].map((x) => ({ ...x, total: x.dias.length }));
  }

  // ------------------------------------------------------------ espelho ---

  /**
   * O espelho da competência: o que o contrato esperava contra o que
   * aconteceu, alocação por alocação.
   *
   * É o documento que a transportadora leva pra conversa do dia 20. Hoje ela
   * chega sem nada e pergunta no grupo de WhatsApp.
   *
   * O calendário e o dia de corte vêm da configuração DO CONTRATANTE, nunca do
   * código: são vários, cada um com o seu combinado.
   */
  async espelho(competenciaRotulo: string, filtros: { clienteId?: string; empresaId?: string }) {
    const alocacoes = await this.prisma.alocacaoObra.findMany({
      where: {
        ...(filtros.clienteId ? { clienteId: filtros.clienteId } : {}),
        ...(filtros.empresaId ? { cliente: { empresaId: filtros.empresaId } } : {}),
      },
      include: {
        cliente: { select: { id: true, nome: true, empresaId: true } },
        motorista: { select: { id: true, nome: true, cpf: true } },
        veiculo: { select: { placa: true } },
      },
      orderBy: [{ ativa: "desc" }],
    });
    // `total` também no caminho vazio: sem ele a conferência devolveria
    // `nosso: undefined` e a tela mostraria "R$ NaN" no mês sem alocação.
    if (alocacoes.length === 0) return { competencia: null, linhas: [], total: "0.00" };

    // Uma consulta de config por contratante, não por alocação: 45 obras do
    // mesmo contratante não podem virar 45 idas ao banco.
    const empresaIds = [...new Set(alocacoes.map((a) => a.cliente.empresaId))];
    const configs = await this.prisma.configMensalContratante.findMany({
      where: { empresaId: { in: empresaIds } },
    });
    const configPorEmpresa = new Map(configs.map((c) => [c.empresaId, c]));

    // Os preços de diária de obra dos contratantes envolvidos, de uma vez. É
    // o que transforma "eu conto 22 e vocês contam 20" em "faltam R$ 2.200" —
    // a única frase que resolve a mesa do dia 20.
    const tabelas = (await this.prisma.tabelaPreco.findMany({
      where: { empresaId: { in: empresaIds }, base: "DIARIA_OBRA", ativo: true },
    })) as unknown as TabelaPrecoRow[];

    const linhas: {
      alocacaoId: string;
      obra: string;
      motorista: string;
      /** Vai pro modelo da planilha: é a chave de reserva quando o código some. */
      cpf: string | null;
      placa: string;
      diaCorte: number;
      de: string;
      ate: string;
      espelho: Espelho;
      valor: { total: string; unitario: string | null; motivo: string | null };
    }[] = [];

    for (const a of alocacoes) {
      const cfg = configPorEmpresa.get(a.cliente.empresaId);
      // Contratante sem configuração ainda usa a semente. É o que faz a tela
      // abrir no primeiro dia, antes de alguém configurar nada.
      const diaCorte = cfg?.diaCorte ?? 20;
      const diasEsperadosSemana = cfg?.diasEsperadosSemana ?? [1, 2, 3, 4, 5, 6];
      const competencia = competenciaDe(competenciaRotulo, diaCorte);

      const registros = await this.prisma.registroPresenca.findMany({
        where: {
          alocacaoId: a.id,
          data: { gte: dia(competencia.de), lte: dia(competencia.ate) },
        },
        select: { data: true, origem: true },
      });

      const espelho = montarEspelho({
        competencia,
        diasEsperadosSemana,
        inicio: paraYmd(a.inicio),
        fim: a.fim ? paraYmd(a.fim) : null,
        registrados: registros.map((r) => ({ data: paraYmd(r.data), origem: r.origem })),
      });

      // Alocação que não tem nada a ver com o período não polui o documento.
      if (espelho.esperados.length === 0 && espelho.registrados.length === 0) continue;

      linhas.push({
        alocacaoId: a.id,
        obra: a.cliente.nome,
        motorista: a.motorista.nome,
        cpf: a.motorista.cpf ?? null,
        placa: a.veiculo.placa,
        diaCorte,
        de: competencia.de,
        ate: competencia.ate,
        espelho,
        valor: valorDosDias(tabelas, a.cliente.empresaId, espelho.registrados),
      });
    }

    const total = linhas
      .reduce((acc, l) => acc.add(new Prisma.Decimal(l.valor.total)), new Prisma.Decimal(0))
      .toFixed(2);

    return { competencia: competenciaRotulo, linhas, total };
  }

  // ------------------------------------------------------------ medição ---

  /**
   * Guarda o que o contratante mediu, SEM corrigir nada.
   *
   * É o documento dele, e a conversa do dia 20 é exatamente sobre o que ele
   * disse — ajustar na entrada apagaria a prova de que havia o que ajustar.
   */
  async lancarMedicao(
    dados: { empresaId: string; competencia: string; linhas: unknown[] },
    usuarioId: string,
  ) {
    const empresa = await this.prisma.empresa.findFirst({ where: { id: dados.empresaId } });
    if (!empresa) throw new NotFoundException("Contratante não encontrado.");

    return this.prisma.medicaoContratante.upsert({
      where: {
        empresaId_competencia: {
          empresaId: dados.empresaId,
          competencia: dados.competencia,
        },
      },
      create: {
        empresaId: dados.empresaId,
        competencia: dados.competencia,
        linhas: dados.linhas as never,
        origem: "MANUAL",
        criadoPorId: usuarioId,
      },
      update: { linhas: dados.linhas as never, criadoPorId: usuarioId },
    });
  }

  /**
   * A conferência do dia 20: o nosso espelho contra a medição dele.
   *
   * Sem medição lançada devolve só o espelho — a tela precisa abrir e mostrar
   * o nosso lado antes de existir o lado deles, senão ela só serve depois que
   * alguém digitou, que é tarde demais pra ajudar.
   */
  /**
   * O período da competência DESTE contratante, e quem está alocado nele.
   *
   * Sai do mesmo lugar que o espelho de propósito: o modelo que a gente manda
   * e a conferência que a gente faz têm que falar do mesmo período e das
   * mesmas pessoas, ou a planilha volta com uma linha que não existe na tela.
   */
  private async alvosDaMedicao(empresaId: string, competencia: string) {
    const cfg = await this.prisma.configMensalContratante.findFirst({ where: { empresaId } });
    const periodo = competenciaDe(competencia, cfg?.diaCorte ?? 20);
    const espelho = await this.espelho(competencia, { empresaId });
    return {
      periodo,
      dias: this.diasEntre(dia(periodo.de), dia(periodo.ate)),
      alvos: espelho.linhas.map((l) => ({
        alocacaoId: l.alocacaoId,
        motorista: l.motorista,
        cpf: l.cpf,
        obra: l.obra,
        placa: l.placa,
      })),
    };
  }

  /** O modelo em branco pra mandar pro contratante, já com quem está alocado. */
  async modeloDeMedicao(empresaId: string, competencia: string) {
    const empresa = await this.prisma.empresa.findFirst({
      where: { id: empresaId },
      select: { nome: true },
    });
    if (!empresa) throw new NotFoundException("Contratante não encontrado.");

    const { periodo, dias: diasDoPeriodo, alvos } = await this.alvosDaMedicao(empresaId, competencia);
    if (alvos.length === 0) {
      throw new BadRequestException(
        "Nenhum motorista alocado nesse contratante na competência — não há o que medir.",
      );
    }

    const buffer = await montarModeloMedicao({
      contratante: empresa.nome,
      competencia,
      de: periodo.de,
      ate: periodo.ate,
      dias: diasDoPeriodo,
      alvos,
    });
    const slug = empresa.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
    return { buffer, nomeArquivo: `medicao-${slug}-${competencia}.xlsx` };
  }

  /**
   * Lê a planilha que voltou e devolve o que ela diz. NÃO salva.
   *
   * Separar leitura de gravação não é cerimônia: importador que grava direto
   * esconde a linha que ele não reconheceu, e o número fecha na tela com
   * gente faltando na conta. Aqui o escritório vê os três blocos — casou, veio
   * sem dono, e está alocado mas não veio — e só então lança.
   */
  async importarMedicao(empresaId: string, competencia: string, arquivo: Buffer, nome: string) {
    const { alvos, dias: diasDoPeriodo } = await this.alvosDaMedicao(empresaId, competencia);
    if (alvos.length === 0) {
      throw new BadRequestException("Nenhum motorista alocado nesse contratante na competência.");
    }

    let abas;
    try {
      abas = (await parseXlsx(arquivo, nome)).abas;
    } catch {
      throw new BadRequestException(
        "Não consegui abrir essa planilha. Envie o arquivo .xlsx do modelo, sem senha.",
      );
    }

    const leitura = lerMedicaoDaPlanilha(abas, alvos, diasDoPeriodo);
    if (leitura.linhas.length === 0 && leitura.semDono.length === 0) {
      throw new BadRequestException(
        "Não achei nenhuma medição nessa planilha. Confira se a coluna 'Total de dias' (ou os dias) está preenchida.",
      );
    }
    return leitura;
  }

  async conferirMedicao(empresaId: string, competencia: string) {
    const espelho = await this.espelho(competencia, { empresaId });

    const medicao = await this.prisma.medicaoContratante.findFirst({
      where: { empresaId, competencia },
    });
    const linhasDeles = (medicao?.linhas ?? []) as {
      alocacaoId: string;
      dias?: string[];
      totalDias?: number;
    }[];

    const nossos = espelho.linhas.map((l) => ({
      chave: l.alocacaoId,
      dias: l.espelho.registrados,
    }));
    const deles: LadoDeles[] = linhasDeles.map((l) => ({
      chave: l.alocacaoId,
      dias: l.dias,
      totalDias: l.totalDias,
    }));

    const divergencias = compararMedicao(nossos, deles);
    // O nome de cada linha vem do espelho: a comparação é regra pura e não
    // conhece motorista nem obra, e ninguém confere uma tabela de uuid.
    const rotulos = new Map(
      espelho.linhas.map((l) => [
        l.alocacaoId,
        { motorista: l.motorista, obra: l.obra, placa: l.placa, valor: l.valor },
      ]),
    );

    /**
     * Quanto vale a divergência da linha.
     *
     * É dias × preço, e não uma conta nova: o que se leva pra mesa é "faltam
     * 2 diárias, R$ 2.200". `null` quando não dá pra sustentar o número — sem
     * preço cadastrado, ou com reajuste no meio da competência (aí não existe
     * "o preço da diária, e um valor inventado é pior que nenhum).
     */
    const valorDaDiferenca = (chave: string, diferencaDias: number): string | null => {
      const u = rotulos.get(chave)?.valor.unitario;
      if (!u || diferencaDias === 0) return null;
      return new Prisma.Decimal(u).mul(diferencaDias).toFixed(2);
    };

    const comValor = divergencias.map((d) => ({
      ...d,
      ...rotulos.get(d.chave),
      valorDiferenca: valorDaDiferenca(d.chave, d.diferenca),
    }));

    const aContestar = comValor
      .filter((d) => d.diferenca > 0 && d.valorDiferenca)
      .reduce((acc, d) => acc.add(new Prisma.Decimal(d.valorDiferenca!)), new Prisma.Decimal(0))
      .toFixed(2);

    return {
      competencia,
      lancada: !!medicao,
      lancadaEm: medicao?.alteradoEm ?? null,
      espelho: espelho.linhas,
      /** O que a transportadora registrou, em R$, no período. */
      nosso: espelho.total,
      divergencias: comValor,
      resumo: {
        ...resumirDivergencias(divergencias),
        /** Soma do que está a menos na medição deles. É o pedido de ajuste. */
        valorAContestar: aContestar,
      },
    };
  }

  /** O combinado com um contratante: dia de corte e calendário da obra. */
  async configDoContratante(empresaId: string) {
    const cfg = await this.prisma.configMensalContratante.findFirst({ where: { empresaId } });
    return cfg ?? { empresaId, diaCorte: 20, diasEsperadosSemana: [1, 2, 3, 4, 5, 6] };
  }

  async salvarConfigDoContratante(
    empresaId: string,
    dados: { diaCorte: number; diasEsperadosSemana: number[] },
  ) {
    const empresa = await this.prisma.empresa.findFirst({ where: { id: empresaId } });
    if (!empresa) throw new NotFoundException("Contratante não encontrado.");
    return this.prisma.configMensalContratante.upsert({
      where: { empresaId },
      create: { empresaId, ...dados },
      update: dados,
    });
  }

  /**
   * O escritório lançando no lugar do motorista. Exige motivo escrito.
   *
   * Fica com `origem: PAINEL` porque o espelho precisa distinguir: a prova que
   * vale contra a medição do contratante é a que veio do aparelho dele.
   */
  async lancarPelaPainel(dados: LancarPresencaPainelInput, usuarioId: string) {
    const a = await this.buscarAlocacao(dados.alocacaoId);
    const d = dia(dados.data);
    if (d < a.inicio) throw new BadRequestException("Esse dia é anterior ao início na obra.");
    if (a.fim && d > a.fim) throw new BadRequestException("Esse dia é posterior ao fim na obra.");

    const existente = await this.prisma.registroPresenca.findFirst({
      where: { alocacaoId: a.id, data: d },
    });
    if (existente) throw new ConflictException("Esse dia já está registrado.");

    this.log.log(`Presença lançada pelo painel: alocação ${a.id}, dia ${dados.data}.`);
    return this.prisma.registroPresenca.create({
      data: {
        alocacaoId: a.id,
        data: d,
        origem: "PAINEL",
        motivoPainel: dados.motivo,
        criadoPorId: usuarioId,
      },
    });
  }

  /**
   * Remover um dia lançado errado. Só o que o PAINEL lançou.
   *
   * O registro do motorista não se apaga pelo escritório: ele é a prova dele, e
   * apagar prova de alguém sem que ele saiba é o tipo de poder que o sistema
   * não deve ter. Dia marcado errado pelo motorista vira discussão no espelho,
   * que é onde ele pode responder.
   */
  async removerPresenca(id: string, motivo: string) {
    const r = await this.prisma.registroPresenca.findFirst({ where: { id } });
    if (!r) throw new NotFoundException("Dia não encontrado.");
    if (r.origem === "APP") {
      throw new ForbiddenException(
        "Este dia foi marcado pelo motorista e não se apaga pelo painel. Trate a divergência no espelho.",
      );
    }
    this.log.log(`Presença ${id} removida pelo painel: ${motivo}`);
    await this.prisma.registroPresenca.delete({ where: { id } });
    return { removido: true };
  }
}
