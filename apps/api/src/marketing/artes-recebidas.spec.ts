import { describe, it, expect } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { validarArtes } from "./artes-recebidas";

/**
 * A ordem dos slides é a coisa mais silenciosa que pode dar errado aqui.
 *
 * Arte fora do padrão o render barra; JPEG errado a Meta recusa com erro claro.
 * Mas carrossel com os slides embaralhados publica normalmente — só sai errado
 * no feed, e só alguém olhando percebe. Por isso a ordem tem teste, e o teste
 * usa nomes que quebram ordenação alfabética de propósito.
 */
const arquivo = (nome: string, extras: Partial<Express.Multer.File> = {}) =>
  ({
    fieldname: "artes",
    originalname: nome,
    mimetype: "image/jpeg",
    size: 1024,
    buffer: Buffer.from("x"),
    ...extras,
  }) as Express.Multer.File;

describe("validarArtes", () => {
  it("preserva a ordem de chegada, não a alfabética", () => {
    // "-10" antes de "-2" é exatamente o que uma ordenação por nome faria.
    const entrada = [arquivo("p-1.jpg"), arquivo("p-2.jpg"), arquivo("p-10.jpg")];
    expect(validarArtes(entrada).map((a) => a.originalname)).toEqual([
      "p-1.jpg",
      "p-2.jpg",
      "p-10.jpg",
    ]);
  });

  it("aceita `arte` no singular, que é o que o painel manda", () => {
    const entrada = [arquivo("capa.jpg", { fieldname: "arte" })];
    expect(validarArtes(entrada)).toHaveLength(1);
  });

  it("ignora arquivo em campo que não é arte", () => {
    const entrada = [arquivo("capa.jpg"), arquivo("outra-coisa.jpg", { fieldname: "anexo" })];
    expect(validarArtes(entrada).map((a) => a.originalname)).toEqual(["capa.jpg"]);
  });

  it("recusa quando não veio arte nenhuma", () => {
    expect(() => validarArtes([])).toThrow(BadRequestException);
    expect(() => validarArtes(undefined)).toThrow(BadRequestException);
  });

  it("recusa PNG, porque a Meta recusa", () => {
    const entrada = [arquivo("capa.png", { mimetype: "image/png" })];
    expect(() => validarArtes(entrada)).toThrow(/JPEG/);
  });

  it("diz QUAL slide está errado quando é carrossel", () => {
    const entrada = [arquivo("1.jpg"), arquivo("2.png", { mimetype: "image/png" })];
    expect(() => validarArtes(entrada)).toThrow(/slide 2/);
  });

  it("não fala em slide quando é imagem única", () => {
    const entrada = [arquivo("capa.png", { mimetype: "image/png" })];
    expect(() => validarArtes(entrada)).toThrow(/^(?!.*slide).*$/);
  });

  it("recusa imagem acima de 8 MB", () => {
    const entrada = [arquivo("grande.jpg", { size: 8 * 1024 * 1024 + 1 })];
    expect(() => validarArtes(entrada)).toThrow(/8 MB/);
  });

  it("aceita exatamente 8 MB", () => {
    const entrada = [arquivo("no-limite.jpg", { size: 8 * 1024 * 1024 })];
    expect(validarArtes(entrada)).toHaveLength(1);
  });

  it("aceita 10 slides e recusa 11", () => {
    const dez = Array.from({ length: 10 }, (_, i) => arquivo(`${i}.jpg`));
    expect(validarArtes(dez)).toHaveLength(10);
    expect(() => validarArtes([...dez, arquivo("11.jpg")])).toThrow(/no máximo 10/);
  });
});
