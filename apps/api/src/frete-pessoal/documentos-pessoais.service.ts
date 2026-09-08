import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CadastroPessoalPublico,
  DocumentoPessoal,
  SalvarDocumentoPessoalInput,
  StatusDocumento,
  TipoDocumentoPessoal,
} from "@ronan/shared-types";
import { DIAS_AVISO_DOCUMENTO, DIAS_AVISO_PADRAO } from "@ronan/shared-types";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";

/**
 * A carteira do motorista: CNH, toxicológico, RNTRC, CRLV, cronotacógrafo.
 *
 * É o que a transportadora e a gerenciadora de risco pedem antes de liberar
 * carga — e o autônomo refaz esse cadastro A CADA VIAGEM. Ter tudo junto e
 * saber o que está vencendo é a diferença entre pegar e perder o frete.
 *
 * Da PESSOA, não da empresa: acompanha ele de transportadora em transportadora.
 * Não confundir com `MotoristaDocumento`, que é o que UMA empresa guarda do
 * motorista dela. A trava não protege esta tabela (é global) — o isolamento é o
 * `identidadeId` em toda consulta.
 */
@Injectable()
export class DocumentosPessoaisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  async listar(identidadeId: string): Promise<DocumentoPessoal[]> {
    const docs = await comoSistema(() =>
      this.prisma.documentoPessoal.findMany({
        where: { identidadeId },
        orderBy: [{ validade: "asc" }, { tipo: "asc" }],
      }),
    );
    return docs.map(saida);
  }

  /**
   * Cria ou atualiza. A chave natural é (tipo + placa): CNH é uma só, mas CRLV
   * é um por veículo — sem a placa no meio, cadastrar a carreta apagaria o
   * cavalo.
   */
  async salvar(
    identidadeId: string,
    input: SalvarDocumentoPessoalInput,
    id?: string,
  ): Promise<DocumentoPessoal> {
    const dados = {
      tipo: input.tipo,
      numero: input.numero ?? null,
      validade: input.validade ? new Date(`${input.validade}T00:00:00.000Z`) : null,
      placa: input.placa ?? null,
      observacao: input.observacao ?? null,
      // Validade nova reabre o ciclo de aviso: ele renovou, então o alerta do
      // vencimento anterior não pode continuar valendo.
      avisadoEm: null,
    };

    if (id) {
      const r = await comoSistema(() =>
        this.prisma.documentoPessoal.updateMany({ where: { id, identidadeId }, data: dados }),
      );
      if (r.count === 0) throw new NotFoundException("Documento não encontrado.");
      return saida(await this.buscar(identidadeId, id));
    }

    const existente = await comoSistema(() =>
      this.prisma.documentoPessoal.findFirst({
        where: { identidadeId, tipo: input.tipo, placa: input.placa ?? null },
        select: { id: true },
      }),
    );
    if (existente) {
      await comoSistema(() =>
        this.prisma.documentoPessoal.update({ where: { id: existente.id }, data: dados }),
      );
      return saida(await this.buscar(identidadeId, existente.id));
    }

    const criado = await comoSistema(() =>
      this.prisma.documentoPessoal.create({ data: { identidadeId, ...dados } }),
    );
    return saida(criado);
  }

  async apagar(identidadeId: string, id: string): Promise<{ ok: true }> {
    const doc = await this.buscar(identidadeId, id);
    const r = await comoSistema(() =>
      this.prisma.documentoPessoal.deleteMany({ where: { id, identidadeId } }),
    );
    if (r.count === 0) throw new NotFoundException("Documento não encontrado.");
    // O arquivo sai junto: guardar foto de documento de quem apagou o cadastro
    // não serve a ninguém. Best-effort — a linha já foi.
    if (doc.arquivoKey) await this.uploads.removerObjeto(doc.arquivoKey).catch(() => {});
    return { ok: true };
  }

  /**
   * Guarda a foto do documento.
   *
   * Chave sob `pessoal/<identidadeId>/` — fora do prefixo de conta, porque isto
   * não é de empresa nenhuma (o `locais/img/` já abria esse precedente). O
   * arquivo antigo é apagado: documento renovado substitui, não acumula.
   */
  async anexarArquivo(
    identidadeId: string,
    id: string,
    arquivo: { buffer: Buffer; mimetype: string; originalname: string },
  ): Promise<DocumentoPessoal> {
    const doc = await this.buscar(identidadeId, id);
    const key = await this.uploads.putDocumentoPessoal(
      arquivo.buffer,
      arquivo.mimetype,
      identidadeId,
      doc.tipo,
      arquivo.originalname,
    );
    if (doc.arquivoKey && doc.arquivoKey !== key) {
      await this.uploads.removerObjeto(doc.arquivoKey).catch(() => {});
    }
    const atualizado = await comoSistema(() =>
      this.prisma.documentoPessoal.update({
        where: { id },
        data: { arquivoKey: key, arquivoMime: arquivo.mimetype, arquivoNome: arquivo.originalname },
      }),
    );
    return saida(atualizado);
  }

  /** O arquivo em si — só pra ele. Nunca sai pelo link público. */
  async arquivo(identidadeId: string, id: string) {
    const doc = await this.buscar(identidadeId, id);
    if (!doc.arquivoKey) throw new NotFoundException("Esse documento não tem arquivo.");
    return {
      stream: await this.uploads.getObjectStream(doc.arquivoKey),
      mime: doc.arquivoMime ?? "application/octet-stream",
      nome: doc.arquivoNome ?? "documento",
    };
  }

  /**
   * O que a transportadora vê no link do cadastro: documento, número, validade
   * e situação. **Sem a imagem** — ver o comentário em `CadastroPessoalPublico`.
   */
  async cadastroPublico(
    identidadeId: string,
    nome: string,
    destinatario: string | null,
  ): Promise<CadastroPessoalPublico> {
    const docs = (await this.listar(identidadeId)).filter((d) => d.status !== "SEM_VALIDADE" || d.numero);
    return {
      motorista: nome,
      destinatario,
      documentos: docs.map((d) => ({
        tipo: d.tipo,
        numero: d.numero,
        validade: d.validade,
        placa: d.placa,
        status: d.status,
      })),
      // Honesto com quem vai liberar a carga: um vencido derruba o "tudo em dia".
      tudoEmDia: docs.length > 0 && docs.every((d) => d.status !== "VENCIDO"),
    };
  }

  private async buscar(identidadeId: string, id: string) {
    const doc = await comoSistema(() =>
      this.prisma.documentoPessoal.findFirst({ where: { id, identidadeId } }),
    );
    // Mesma resposta pra "não existe" e "é de outro": quem chutar id não
    // descobre nem que ele existe.
    if (!doc) throw new NotFoundException("Documento não encontrado.");
    return doc;
  }
}

type Linha = {
  id: string;
  tipo: TipoDocumentoPessoal;
  numero: string | null;
  validade: Date | null;
  placa: string | null;
  observacao: string | null;
  arquivoKey: string | null;
};

function saida(d: Linha): DocumentoPessoal {
  const { status, dias } = situacao(d.tipo, d.validade);
  return {
    id: d.id,
    tipo: d.tipo,
    numero: d.numero,
    validade: d.validade ? d.validade.toISOString().slice(0, 10) : null,
    placa: d.placa,
    observacao: d.observacao,
    // `temArquivo`, não a chave: a chave do MinIO não tem por que sair da API.
    temArquivo: d.arquivoKey != null,
    status,
    diasAteVencer: dias,
  };
}

/**
 * Em dia, vencendo ou vencido.
 *
 * O corte é por tipo: o toxicológico avisa com 60 dias porque o exame demora
 * pra sair e a multa é automática 30 dias DEPOIS do vencimento — avisar em cima
 * da hora seria avisar tarde. O resto usa 30.
 *
 * A conta é em dia civil de São Paulo, não em `Date.now()` cru: o container roda
 * em UTC e, às 21h do dia 30, "hoje" já seria dia 1º pro servidor — um documento
 * venceria um dia antes na tela do motorista.
 */
export function situacao(
  tipo: TipoDocumentoPessoal,
  validade: Date | null,
): { status: StatusDocumento; dias: number | null } {
  if (!validade) return { status: "SEM_VALIDADE", dias: null };
  const hoje = new Date(`${diaCivilSP()}T00:00:00.000Z`);
  const dias = Math.round((validade.getTime() - hoje.getTime()) / 86_400_000);
  const janela = DIAS_AVISO_DOCUMENTO[tipo] ?? DIAS_AVISO_PADRAO;
  if (dias < 0) return { status: "VENCIDO", dias };
  if (dias <= janela) return { status: "VENCENDO", dias };
  return { status: "EM_DIA", dias };
}

function diaCivilSP(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
