import { describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { BadGatewayException, BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { IaService } from "../../ia/ia.service";
import type { UsoIaService } from "../../ia/uso-ia.service";
import type { PrismaService } from "../../prisma/prisma.service";
import { PedidoDocumentoService } from "./pedido-documento.service";

/**
 * O caminho inteiro sem rede: o cliente da Anthropic é trocado por um fake que
 * devolve o JSON que a IA mandaria, e o Prisma por um catálogo em memória.
 * O que se confere aqui é o que só aparece em produção: o bloco que vai pra
 * Anthropic (PDF como `document`, foto como `image`, e-mail como documento de
 * texto), o registro de uso e a tradução de falha em resposta HTTP.
 */

const PDF = Buffer.from("%PDF-1.4\n1 0 obj <</Type /Page>>\n%%EOF\n");

const prismaFake = {
  configuracaoIa: { upsert: async () => ({ modelo: "claude-haiku-4-5-20251001" }) },
  empresa: { findMany: async () => [{ id: "e1", nome: "Construtora Alvorada", razaoSocial: null, cnpj: null }] },
  cliente: {
    findMany: async () => [{ id: "o1", nome: "Jardim das Flores", apelidos: [], empresaId: "e1" }],
  },
  material: { findMany: async () => [{ id: "m1", nome: "Brita 1", apelidos: [] }] },
  local: { findMany: async () => [] },
} as unknown as PrismaService;

function montar(resposta: string | Error) {
  const uso = { registrar: vi.fn() };
  const ia = new IaService(
    { get: () => undefined } as unknown as ConfigService,
    prismaFake,
    uso as unknown as UsoIaService,
  );
  const create = vi.fn(async () => {
    if (resposta instanceof Error) throw resposta;
    return { content: [{ type: "text", text: resposta }], usage: { input_tokens: 1500, output_tokens: 120 } };
  });
  // Sem chave o client não existe; o teste põe um fake no lugar.
  (ia as unknown as { client: unknown }).client = { messages: { create } };
  return { service: new PedidoDocumentoService(prismaFake, ia), create, uso };
}

const RESPOSTA = JSON.stringify({
  ehPedido: true,
  cliente: "Construtora Alvorada",
  obra: "Jardim das Flores",
  material: "Brita 1",
  quantidade: 20,
  unidade: "cargas",
  inicio: "2026-10-05",
  confidence: 0.9,
});

describe("PedidoDocumentoService.extrair", () => {
  it("PDF vai como documento base64 e volta casado com o cadastro", async () => {
    const { service, create, uso } = montar("```json\n" + RESPOSTA + "\n```");
    const r = await service.extrair({ arquivo: { buffer: PDF, size: PDF.length } });

    const chamada = (create.mock.calls[0] as unknown as [{ messages: { content: unknown[] }[] }])[0];
    expect(chamada.messages[0]!.content[0]).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: PDF.toString("base64") },
    });
    expect(uso.registrar).toHaveBeenCalledWith(expect.objectContaining({ escopo: "pedido-documento" }));

    expect(r.origem).toBe("PDF");
    expect(r.empresa.valor).toBe("e1");
    expect(r.obra.valor).toBe("o1");
    expect(r.material.valor).toBe("m1");
    expect(r.quantidade.valor).toBe(20);
    expect(r.unidade.valor).toBe("VIAGENS");
  });

  it("e-mail colado vai como documento de texto, separado da instrução", async () => {
    const { service, create } = montar(RESPOSTA);
    await service.extrair({ texto: "Bom dia, precisamos de 20 cargas de brita 1 na Jardim das Flores." });
    const chamada = (create.mock.calls[0] as unknown as [{ messages: { content: { type: string; source?: { type: string } }[] }[] }])[0];
    expect(chamada.messages[0]!.content[0]).toMatchObject({ type: "document", source: { type: "text" } });
    expect(chamada.messages[0]!.content[1]).toMatchObject({ type: "text" });
  });

  it("falha da IA vira 502 com código estável, e o uso registra a falha", async () => {
    const { service, uso } = montar(new Error("overloaded"));
    await expect(service.extrair({ texto: "Preciso de 20 cargas de areia amanhã." })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(uso.registrar).toHaveBeenCalledWith(expect.objectContaining({ sucesso: false }));
  });

  it("resposta sem JSON não quebra: sugestão vazia com aviso", async () => {
    const { service } = montar("Desculpe, não consegui ler.");
    const r = await service.extrair({ texto: "Preciso de 20 cargas de areia amanhã." });
    expect(r.empresa.valor).toBeUndefined();
    expect(r.avisos[0]).toMatch(/nada aproveitável/);
  });

  it("sem chave de IA: 503; arquivo que não é PDF/imagem: 400 antes de tudo", async () => {
    const semIa = new PedidoDocumentoService(
      prismaFake,
      new IaService({ get: () => undefined } as unknown as ConfigService, prismaFake, {
        registrar: vi.fn(),
      } as unknown as UsoIaService),
    );
    await expect(semIa.extrair({ texto: "Preciso de 20 cargas de areia amanhã." })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const zip = Buffer.from("PK\x03\x04aaaaaaaaaaaaaaaa");
    await expect(semIa.extrair({ arquivo: { buffer: zip, size: zip.length } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
