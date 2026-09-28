import { describe, expect, it } from "vitest";
import { prometeContatoDeGente } from "./sdr.service";

describe("prometeContatoDeGente", () => {
  it("pega a promessa que a bateria pegou sem ferramenta", () => {
    for (const t of [
      "Combinado: Fernando te liga amanhã às 09:00 neste número.",
      "Fernando fala com você por aqui em instantes.",
      "Alguém da Movatruck vai te chamar.",
      "Ele vai te ligar hoje à tarde.",
    ]) {
      expect(prometeContatoDeGente(t)).toBe(true);
    }
  });

  it("oferta não é promessa", () => {
    for (const t of [
      "Prefere que Fernando te ligue 10 min pra mostrar, ou testar sozinho?",
      "Sai por R$ 1.890,00 por mês.",
      "Quer que Fernando fale com você?",
    ]) {
      expect(prometeContatoDeGente(t)).toBe(false);
    }
  });
});
