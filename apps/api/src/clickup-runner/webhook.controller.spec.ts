import { describe, expect, it, vi } from "vitest";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { ClickupWebhookController, extrairTaskId } from "./webhook.controller";
import type { FilaExecucoesService } from "./fila.service";

const req = { headers: {}, ip: "1.2.3.4", socket: {} } as never;

describe("extrairTaskId", () => {
  it("prefere a query (contrato ?task_id=)", () => {
    expect(extrairTaskId({ task_id: "abc" }, { id: "xyz" })).toBe("abc");
  });

  it("cai pro payload da Automation quando a query não traz", () => {
    expect(extrairTaskId({}, { task_id: "abc" })).toBe("abc");
    expect(extrairTaskId({}, { id: "abc" })).toBe("abc");
    expect(extrairTaskId({}, { payload: { id: "abc" } })).toBe("abc");
  });

  it("devolve undefined quando não há id em lugar nenhum", () => {
    expect(extrairTaskId({}, {})).toBeUndefined();
    expect(extrairTaskId({ task_id: "   " }, undefined)).toBeUndefined();
  });
});

describe("ClickupWebhookController.taskReady", () => {
  it("enfileira e responde 200 com o id da execução", async () => {
    const fila = {
      enfileirar: vi.fn().mockResolvedValue({ aceito: true, job: { id: "job-1" } }),
    } as unknown as FilaExecucoesService;
    const controller = new ClickupWebhookController(fila);

    const r = await controller.taskReady({ task_id: "abc" }, { evento: "x" }, req);

    expect(r).toEqual({ status: "enfileirado", jobId: "job-1", taskId: "abc" });
  });

  it("responde 409 quando já há execução ativa", async () => {
    const fila = {
      enfileirar: vi.fn().mockResolvedValue({
        aceito: false,
        motivo: "execucao-ativa",
        jobExistente: { id: "job-0" },
      }),
    } as unknown as FilaExecucoesService;
    const controller = new ClickupWebhookController(fila);

    await expect(controller.taskReady({ task_id: "abc" }, {}, req)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("responde 409 no reenvio dentro da janela de dedupe", async () => {
    const fila = {
      enfileirar: vi.fn().mockResolvedValue({
        aceito: false,
        motivo: "janela-dedupe",
        jobExistente: { id: "job-0" },
      }),
    } as unknown as FilaExecucoesService;
    const controller = new ClickupWebhookController(fila);

    await expect(controller.taskReady({ task_id: "abc" }, {}, req)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("recusa sem task_id, sem enfileirar nada", async () => {
    const fila = { enfileirar: vi.fn() } as unknown as FilaExecucoesService;
    const controller = new ClickupWebhookController(fila);

    await expect(controller.taskReady({}, {}, req)).rejects.toBeInstanceOf(BadRequestException);
    expect(fila.enfileirar).not.toHaveBeenCalled();
  });
});
