import { describe, expect, it } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import { RunnerTokenGuard, segredoConfere } from "./runner-token.guard";
import type { RunnerConfig } from "./runner.config";

function contexto(req: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

function configFake(over: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    token: "segredo-certo",
    segredoPath: "",
    habilitado: true,
    ...over,
  } as RunnerConfig;
}

describe("segredoConfere", () => {
  it("aceita o valor exato", () => {
    expect(segredoConfere("abc", "abc")).toBe(true);
  });

  it("recusa valor errado, vazio ou ausente", () => {
    expect(segredoConfere("abcd", "abc")).toBe(false);
    expect(segredoConfere("", "abc")).toBe(false);
    expect(segredoConfere(undefined, "abc")).toBe(false);
  });

  it("recusa quando não há segredo configurado (não vira 'passa tudo')", () => {
    expect(segredoConfere("qualquer", "")).toBe(false);
    expect(segredoConfere(undefined, "")).toBe(false);
  });
});

describe("RunnerTokenGuard", () => {
  it("aceita com o header certo", () => {
    const guard = new RunnerTokenGuard(configFake());
    const ctx = contexto({ headers: { "x-runner-token": "segredo-certo" }, params: {} });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("recusa sem header (critério: 401 e nada enfileirado)", () => {
    const guard = new RunnerTokenGuard(configFake());
    const ctx = contexto({ headers: {}, params: {} });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("recusa com header errado", () => {
    const guard = new RunnerTokenGuard(configFake());
    const ctx = contexto({ headers: { "x-runner-token": "chute" }, params: {} });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("recusa tudo quando o runner está desligado", () => {
    const guard = new RunnerTokenGuard(configFake({ habilitado: false }));
    const ctx = contexto({ headers: { "x-runner-token": "segredo-certo" }, params: {} });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("exige o segmento secreto do path quando configurado", () => {
    const guard = new RunnerTokenGuard(configFake({ segredoPath: "s3cr3t" }));
    const semSegmento = contexto({ headers: { "x-runner-token": "segredo-certo" }, params: {} });
    expect(() => guard.canActivate(semSegmento)).toThrow(UnauthorizedException);

    const comSegmento = contexto({
      headers: { "x-runner-token": "segredo-certo" },
      params: { segredo: "s3cr3t" },
    });
    expect(guard.canActivate(comSegmento)).toBe(true);
  });

  it("recusa rota com segmento quando nenhum segredo de path foi configurado", () => {
    const guard = new RunnerTokenGuard(configFake());
    const ctx = contexto({
      headers: { "x-runner-token": "segredo-certo" },
      params: { segredo: "inventado" },
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
