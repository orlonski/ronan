import { describe, it, expect } from "vitest";
import { MetaClient } from "./meta-client";
import type { InstagramConfig } from "./instagram.config";

/**
 * As três chamadas que montam um carrossel, e o que cada uma precisa levar.
 *
 * A Meta aceita quase tudo aqui sem reclamar e o estrago aparece no feed: um
 * `caption` no slide é silenciosamente ignorado (o post sai sem legenda), e a
 * ordem de `children` é a ordem em que o leitor desliza — não há reordenação
 * pelo id nem pela hora de criação.
 */
const config = {
  igUserId: "1784",
  token: "segredo",
  baseUrl: "https://graph.facebook.com/v21.0",
} as InstagramConfig;

/** Guarda o que foi enviado e devolve ids previsíveis. */
function espiao(respostas: Record<string, unknown>[]) {
  const chamadas: { url: string; campos: URLSearchParams }[] = [];
  let i = 0;
  const buscar = (async (url: string, init?: RequestInit) => {
    chamadas.push({
      url: String(url),
      campos: new URLSearchParams(String(init?.body ?? "")),
    });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(respostas[i++] ?? {}),
    } as Response;
  }) as unknown as typeof fetch;
  return { chamadas, buscar };
}

describe("MetaClient — carrossel", () => {
  it("marca o slide como item de carrossel e NÃO manda legenda nele", async () => {
    const { chamadas, buscar } = espiao([{ id: "filho-1" }]);
    const cliente = new MetaClient(config, buscar);

    const id = await cliente.criarContainerSlide("https://api/publico/artes/abc");

    expect(id).toBe("filho-1");
    const { campos } = chamadas[0]!;
    expect(campos.get("is_carousel_item")).toBe("true");
    expect(campos.get("image_url")).toBe("https://api/publico/artes/abc");
    // A legenda do carrossel mora no pai. Aqui ela some sem erro nenhum.
    expect(campos.get("caption")).toBeNull();
  });

  it("o pai leva os filhos NA ORDEM e carrega a legenda", async () => {
    const { chamadas, buscar } = espiao([{ id: "pai" }]);
    const cliente = new MetaClient(config, buscar);

    await cliente.criarContainerCarrossel(["f1", "f2", "f3"], "a legenda");

    const { campos } = chamadas[0]!;
    expect(campos.get("media_type")).toBe("CAROUSEL");
    expect(campos.get("children")).toBe("f1,f2,f3");
    expect(campos.get("caption")).toBe("a legenda");
  });

  it("imagem única continua indo com legenda e sem is_carousel_item", async () => {
    const { chamadas, buscar } = espiao([{ id: "unico" }]);
    const cliente = new MetaClient(config, buscar);

    await cliente.criarContainer("https://api/publico/artes/xyz", "legenda solta");

    const { campos } = chamadas[0]!;
    expect(campos.get("caption")).toBe("legenda solta");
    expect(campos.get("is_carousel_item")).toBeNull();
    expect(campos.get("media_type")).toBeNull();
  });

  it("o token vai no corpo, nunca na URL de um POST", async () => {
    const { chamadas, buscar } = espiao([{ id: "x" }]);
    const cliente = new MetaClient(config, buscar);

    await cliente.criarContainerSlide("https://api/publico/artes/abc");

    expect(chamadas[0]!.url).not.toContain("segredo");
    expect(chamadas[0]!.campos.get("access_token")).toBe("segredo");
  });
});
