import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import PDFDocument from "pdfkit";
import { ITEM_ACERTO_LABEL, type TipoItemAcertoTipo } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { totalizarAcerto } from "../../common/acerto-motorista";
import { assinarLink, lerLinkAssinado } from "../../common/link-assinado";

const VALIDADE_LINK_DIAS = 30;
const TIPO_LINK = "acerto";

/**
 * As fontes padrão do PDF (Helvetica) só desenham o conjunto WinAnsi: seta,
 * sinal de menos tipográfico e emoji saem como lixo ("!'"). Descrição de item é
 * texto livre, então tudo passa por aqui antes de ir pro papel.
 */
const EXTRAS_WINANSI = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function textoPdf(t: string): string {
  return t
    .replace(/[→⇒➔➜]/g, "->")
    .replace(/[←⇐]/g, "<-")
    .replace(/[−‒]/g, "-")
    .replace(/[^\u0020-\u007e\u00a0-\u00ff\n]/g, (c) => (EXTRAS_WINANSI.includes(c) ? c : ""))
    .replace(/ {2,}/g, " ");
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

/**
 * O extrato do acerto em PDF — o que a empresa deve ao parceiro no período,
 * item por item. Sai pelo painel (baixar / mandar no WhatsApp) e pelo app
 * (Meus acertos), por um link ASSINADO que expira em 30 dias: o parceiro abre
 * no navegador do celular, sem login e sem módulo nativo.
 */
@Injectable()
export class AcertoPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private segredo(): string {
    return this.config.getOrThrow<string>("JWT_SECRET");
  }

  /** Link público do PDF (pela página do painel, que repassa o arquivo). */
  link(acertoId: string, contaId: string): string {
    const token = assinarLink(
      {
        tipo: TIPO_LINK,
        id: acertoId,
        contaId,
        expiraEm: new Date(Date.now() + VALIDADE_LINK_DIAS * 86_400_000),
      },
      this.segredo(),
    );
    const base = (this.config.get<string>("PUBLIC_APP_URL") ?? "http://localhost:3001").replace(/\/+$/, "");
    return `${base}/acerto/${token}`;
  }

  lerToken(token: string) {
    return lerLinkAssinado(token, TIPO_LINK, this.segredo());
  }

  async gerar(acertoId: string): Promise<{ buffer: Buffer; nome: string }> {
    const a = await this.prisma.acertoMotorista.findUnique({
      where: { id: acertoId },
      include: {
        conta: { select: { nome: true } },
        motorista: { select: { nome: true, cpf: true, chavePix: true } },
        itens: { orderBy: { criadoEm: "asc" } },
      },
    });
    if (!a) throw new NotFoundException("Acerto não encontrado.");
    const tot = totalizarAcerto(a.itens);

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const pronto = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });
    const largura = doc.page.width - 80;

    doc.font("Helvetica-Bold").fontSize(16).text("Extrato do acerto");
    doc.font("Helvetica").fontSize(10).fillColor("#444").text(textoPdf(a.conta.nome));
    doc.moveDown(0.6).fillColor("#000").fontSize(11);
    doc.font("Helvetica-Bold").text(textoPdf(a.motorista.nome), { continued: true }).font("Helvetica").text(`  ·  CPF ${a.motorista.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")}`);
    doc.text(`Período: ${dia(a.periodoInicio)} a ${dia(a.periodoFim)}`);
    const situacao =
      a.status === "PAGO"
        ? `Pago${a.pagoEm ? ` em ${dia(a.pagoEm)}` : ""}${a.pagoMeio ? ` · ${a.pagoMeio}` : ""}`
        : a.status === "FECHADO"
          ? "Fechado, aguardando pagamento"
          : "Em aberto (ainda pode mudar)";
    doc.text(`Situação: ${situacao}`);
    if (a.motorista.chavePix) doc.text(textoPdf(`Chave Pix: ${a.motorista.chavePix}`));
    doc.moveDown(0.8);

    // Tabela: descrição | valor. Débito em vermelho com sinal de menos.
    const colValor = 110;
    const linha = (y: number) => doc.moveTo(40, y).lineTo(40 + largura, y).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#555");
    doc.text("O QUE", 40, doc.y, { width: largura - colValor });
    doc.moveUp().text("VALOR", 40 + largura - colValor, doc.y, { width: colValor, align: "right" });
    linha(doc.y + 2);
    doc.moveDown(0.4).font("Helvetica").fontSize(10);
    for (const it of a.itens) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      const v = Number(it.valor);
      const y = doc.y;
      const rotulo = ITEM_ACERTO_LABEL[it.tipo as TipoItemAcertoTipo] ?? it.tipo;
      doc.fillColor("#000").text(textoPdf(it.descricao), 40, y, { width: largura - colValor - 10 });
      doc.fillColor("#666").fontSize(8).text(textoPdf(rotulo + (it.motivo ? ` — ${it.motivo}` : "")), { width: largura - colValor - 10 });
      const fim = doc.y;
      doc
        .fontSize(10)
        .fillColor(v < 0 ? "#b91c1c" : "#000")
        .text(v < 0 ? `- ${brl(-v)}` : brl(v), 40 + largura - colValor, y, { width: colValor, align: "right" });
      doc.y = Math.max(fim, doc.y) + 4;
      linha(doc.y - 2);
    }
    doc.moveDown(0.6).fillColor("#000").fontSize(11);
    const total = (rotulo: string, valor: string, negrito = false) => {
      const y = doc.y;
      doc.font(negrito ? "Helvetica-Bold" : "Helvetica").text(rotulo, 40, y, { width: largura - colValor });
      doc.text(valor, 40 + largura - colValor, y, { width: colValor, align: "right" });
    };
    total("Créditos", brl(Number(tot.creditos)));
    total("Descontos", `- ${brl(Number(tot.debitos))}`);
    total("A receber", brl(Number(tot.liquido)), true);
    if (a.observacao) {
      doc.moveDown(0.8).font("Helvetica").fontSize(9).fillColor("#444").text(textoPdf(`Observação: ${a.observacao}`), 40, doc.y, { width: largura });
    }
    doc.moveDown(1.2).fontSize(8).fillColor("#888").text(`Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · Movatruck`, 40, doc.y, { width: largura });

    doc.end();
    const nomeArquivo = `acerto-${a.motorista.nome.split(" ")[0]?.toLowerCase() ?? "motorista"}-${a.periodoInicio.toISOString().slice(0, 10)}.pdf`;
    return { buffer: await pronto, nome: nomeArquivo };
  }
}
