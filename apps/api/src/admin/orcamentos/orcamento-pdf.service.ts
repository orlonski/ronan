import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import PDFDocument from "pdfkit";
import { BASE_PRECO_LABEL, UNIDADE_PEDIDO_LABEL } from "@ronan/shared-types";
import { assinarLink, lerLinkAssinado } from "../../common/link-assinado";
import { UploadsService } from "../../uploads/uploads.service";
import { textoPdf } from "../acertos/acerto-pdf.service";
import { OrcamentosService } from "./orcamentos.service";

const VALIDADE_LINK_DIAS = 30;
const TIPO_LINK = "orcamento";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v: number, casas = 3) => v.toLocaleString("pt-BR", { maximumFractionDigits: casas });
const dataBR = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

/**
 * A proposta em PDF, com a cara da transportadora (nome e logo da conta) — é o
 * papel que o cliente dela recebe, não um documento da Movatruck. Sai pelo
 * painel (baixar) e por link ASSINADO que vence em 30 dias, aberto no
 * navegador do cliente sem login.
 */
@Injectable()
export class OrcamentoPdfService {
  private readonly log = new Logger(OrcamentoPdfService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly orcamentos: OrcamentosService,
    private readonly uploads: UploadsService,
  ) {}

  private segredo(): string {
    return this.config.getOrThrow<string>("JWT_SECRET");
  }

  /** Link público do PDF, pelo domínio do painel (que repassa o arquivo). */
  link(orcamentoId: string, contaId: string): string {
    const token = assinarLink(
      {
        tipo: TIPO_LINK,
        id: orcamentoId,
        contaId,
        expiraEm: new Date(Date.now() + VALIDADE_LINK_DIAS * 86_400_000),
      },
      this.segredo(),
    );
    const base = (this.config.get<string>("PUBLIC_APP_URL") ?? "http://localhost:3001").replace(/\/+$/, "");
    return `${base}/orcamento/${token}`;
  }

  lerToken(token: string) {
    return lerLinkAssinado(token, TIPO_LINK, this.segredo());
  }

  /** Logo da conta, se for formato que o pdfkit desenha (PNG/JPEG). Falha = sem logo. */
  private async logo(key: string | null): Promise<Buffer | null> {
    if (!key || !/\.(png|jpe?g)$/i.test(key)) return null;
    try {
      return await this.uploads.getObjectBuffer(key);
    } catch (e) {
      this.log.warn(`logo da conta indisponível pro PDF: ${(e as Error).message}`);
      return null;
    }
  }

  async gerar(orcamentoId: string): Promise<{ buffer: Buffer; nome: string }> {
    const o = await this.orcamentos.paraDocumento(orcamentoId);
    const logo = await this.logo(o.conta.logoKey);

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const pronto = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });
    const esq = 40;
    const largura = doc.page.width - 80;

    // Cabeçalho: logo + nome da transportadora à esquerda, número à direita.
    const topo = doc.y;
    let xNome = esq;
    if (logo) {
      try {
        doc.image(logo, esq, topo, { fit: [110, 48] });
        xNome = esq + 122;
      } catch {
        // Imagem corrompida não derruba a proposta.
      }
    }
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#111").text(textoPdf(o.conta.nome), xNome, topo + 4, {
      width: largura - (xNome - esq) - 150,
    });
    if (o.conta.cnpj) {
      doc.font("Helvetica").fontSize(9).fillColor("#555").text(`CNPJ ${o.conta.cnpj}`, xNome, doc.y + 1);
    }
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor("#111")
      .text(`Orçamento nº ${o.numero}`, esq + largura - 150, topo + 4, { width: 150, align: "right" });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#555")
      .text(`Emitido em ${dataBR(o.criadoEm)}`, esq + largura - 150, doc.y + 1, { width: 150, align: "right" });
    doc.y = Math.max(doc.y, topo + 56);
    doc.moveTo(esq, doc.y).lineTo(esq + largura, doc.y).strokeColor("#d1d5db").lineWidth(1).stroke();
    doc.moveDown(0.8);

    // Para quem.
    doc.x = esq;
    doc.font("Helvetica").fontSize(9).fillColor("#666").text("PROPOSTA PARA", esq, doc.y);
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#111").text(textoPdf(o.destinatario));
    const sub = [o.cliente?.nome && o.cliente.nome !== o.destinatario ? `Obra: ${o.cliente.nome}` : null, o.prospectContato ?? o.empresa?.contato ?? null]
      .filter(Boolean)
      .join("  ·  ");
    if (sub) doc.font("Helvetica").fontSize(10).fillColor("#444").text(textoPdf(sub));
    doc.moveDown(0.8);

    // Itens.
    const col = { item: 230, qtd: 85, preco: 95, valor: largura - 230 - 85 - 95 };
    const linha = (y: number) =>
      doc.moveTo(esq, y).lineTo(esq + largura, y).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
    const cab = doc.y;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#555");
    doc.text("SERVIÇO", esq, cab, { width: col.item });
    doc.text("QUANTIDADE", esq + col.item, cab, { width: col.qtd, align: "right" });
    doc.text("PREÇO", esq + col.item + col.qtd, cab, { width: col.preco, align: "right" });
    doc.text("VALOR", esq + col.item + col.qtd + col.preco, cab, { width: col.valor, align: "right" });
    linha(doc.y + 3);
    doc.y += 8;

    for (const it of o.itens) {
      if (doc.y > doc.page.height - 160) doc.addPage();
      const y = doc.y;
      const titulo = it.material?.nome ?? it.descricao ?? "Transporte";
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#111").text(textoPdf(titulo), esq, y, { width: col.item - 8 });
      const rota = [it.localCarga?.nome, it.localDescarga?.nome].filter(Boolean).join(" -> ");
      const detalhes = [
        it.material && it.descricao ? it.descricao : null,
        it.tipoServico?.nome ?? null,
        rota ? `${rota}${it.kmEstimado ? ` (${num(Number(it.kmEstimado), 1)} km)` : ""}` : null,
      ].filter(Boolean) as string[];
      if (detalhes.length) {
        doc.font("Helvetica").fontSize(8.5).fillColor("#555").text(textoPdf(detalhes.join(" · ")), { width: col.item - 8 });
      }
      const fim = doc.y;
      doc.font("Helvetica").fontSize(10).fillColor("#111");
      doc.text(`${num(Number(it.quantidade))} ${UNIDADE_PEDIDO_LABEL[it.unidade]}`, esq + col.item, y, {
        width: col.qtd,
        align: "right",
      });
      doc.text(
        `${brl(Number(it.precoUnitario))}`,
        esq + col.item + col.qtd,
        y,
        { width: col.preco, align: "right" },
      );
      doc
        .fontSize(7.5)
        .fillColor("#666")
        .text(textoPdf(BASE_PRECO_LABEL[it.base].unidade), esq + col.item + col.qtd, doc.y, {
          width: col.preco,
          align: "right",
        });
      // A unidade do preço é a linha mais baixa da coluna: a separação tem
      // que vir depois dela, senão o risco corta o "R$/t".
      const fimPreco = doc.y;
      doc
        .fontSize(10)
        .fillColor(it.valor ? "#111" : "#92400e")
        .text(it.valor ? brl(Number(it.valor)) : "a calcular", esq + col.item + col.qtd + col.preco, y, {
          width: col.valor,
          align: "right",
        });
      doc.y = Math.max(fim, fimPreco, doc.y) + 6;
      linha(doc.y - 3);
    }

    // Total.
    doc.moveDown(0.5);
    const yt = doc.y;
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#111");
    doc.text("Total estimado", esq, yt, { width: largura - 160 });
    doc.text(brl(Number(o.total)), esq + largura - 160, yt, { width: 160, align: "right" });
    if (o.itensSemValor > 0) {
      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor("#92400e")
        .text(
          `${o.itensSemValor === 1 ? "1 item fica" : `${o.itensSemValor} itens ficam`} fora do total: o valor depende da medição (peso, volume ou distância) de cada viagem.`,
          esq,
          doc.y + 2,
          { width: largura },
        );
    }
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor("#555")
      .text(
        "Valor estimado pelas quantidades acima. O faturamento segue o que for de fato transportado.",
        esq,
        doc.y + 2,
        { width: largura },
      );

    // Prazos e validade.
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#111").text(`Proposta válida até ${dataBR(o.validadeEm)}`, esq, doc.y);
    const prazo = [
      o.inicioPrevistoEm ? `início previsto em ${dataBR(o.inicioPrevistoEm)}` : null,
      o.prazoEm ? `conclusão até ${dataBR(o.prazoEm)}` : null,
    ].filter(Boolean);
    if (prazo.length) {
      doc.font("Helvetica").fontSize(10).fillColor("#333").text(textoPdf(`Prazo: ${prazo.join(", ")}.`));
    }
    if (o.condicoes) {
      doc.moveDown(0.8);
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#111").text("Condições");
      doc.font("Helvetica").fontSize(9.5).fillColor("#333").text(textoPdf(o.condicoes), { width: largura });
    }
    if (o.criadoPor?.nome) {
      doc.moveDown(1);
      doc.font("Helvetica").fontSize(9.5).fillColor("#333").text(textoPdf(`Atenciosamente, ${o.criadoPor.nome} — ${o.conta.nome}`));
    }

    doc
      .moveDown(1.5)
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#999")
      .text(
        `Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · Movatruck`,
        esq,
        doc.y,
        { width: largura },
      );

    doc.end();
    const slug = (o.destinatario || "cliente")
      .normalize("NFD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase();
    return { buffer: await pronto, nome: `orcamento-${o.numero}-${slug || "cliente"}.pdf` };
  }
}
