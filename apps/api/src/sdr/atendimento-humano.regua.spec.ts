import { describe, expect, it } from "vitest";
import {
  deveEscalonar,
  dentroDoHorario,
  mensagemDeRepasse,
  proximaAbertura,
  type HorarioAtendimento,
} from "./atendimento-humano.regua";

const H: HorarioAtendimento = { inicio: 8, fim: 18, dias: [1, 2, 3, 4, 5, 6] };
// Instantes em SP (-03:00). 28/09/2026 é segunda; 27/09/2026 é domingo.
const sp = (iso: string) => new Date(`${iso}-03:00`);

describe("horário de atendimento", () => {
  it("segunda 10h aberto, 19h fechado, domingo fechado", () => {
    expect(dentroDoHorario(H, sp("2026-09-28T10:00:00"))).toBe(true);
    expect(dentroDoHorario(H, sp("2026-09-28T19:00:00"))).toBe(false);
    expect(dentroDoHorario(H, sp("2026-09-27T10:00:00"))).toBe(false);
  });

  it("diz quando abre", () => {
    expect(proximaAbertura(H, sp("2026-09-28T06:00:00"))).toBe("hoje a partir das 8h");
    expect(proximaAbertura(H, sp("2026-09-28T20:00:00"))).toBe("amanhã a partir das 8h");
    // sábado à noite → domingo fechado → segunda
    expect(proximaAbertura(H, sp("2026-09-26T20:00:00"))).toBe("segunda a partir das 8h");
  });
});

describe("mensagemDeRepasse", () => {
  it("tem nome e prazo", () => {
    expect(mensagemDeRepasse("Fernando", H, sp("2026-09-28T10:00:00"))).toBe(
      "Certo! O Fernando vai falar com você por aqui em instantes.",
    );
    expect(mensagemDeRepasse("Fernando", H, sp("2026-09-28T22:00:00"))).toBe(
      "Certo! O Fernando te responde por aqui amanhã a partir das 8h.",
    );
    expect(mensagemDeRepasse(null, H, sp("2026-09-28T10:00:00"))).toContain("Alguém da Movatruck");
  });
});

describe("deveEscalonar", () => {
  it("15 min dentro do horário escalona; 10 não", () => {
    const alerta = sp("2026-09-28T10:00:00");
    expect(deveEscalonar(alerta, 15, H, sp("2026-09-28T10:10:00"))).toBe(false);
    expect(deveEscalonar(alerta, 15, H, sp("2026-09-28T10:16:00"))).toBe(true);
  });

  it("alerta da noite conta a partir da abertura", () => {
    const alerta = sp("2026-09-28T22:00:00");
    expect(deveEscalonar(alerta, 15, H, sp("2026-09-29T08:05:00"))).toBe(false);
    expect(deveEscalonar(alerta, 15, H, sp("2026-09-29T08:16:00"))).toBe(true);
  });

  it("fora do horário nunca escalona", () => {
    expect(deveEscalonar(sp("2026-09-28T10:00:00"), 15, H, sp("2026-09-28T20:00:00"))).toBe(false);
  });
});
