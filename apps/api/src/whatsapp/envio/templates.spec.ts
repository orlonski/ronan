import { describe, it, expect } from "vitest";
import {
  ROTAS_WHATSAPP,
  TEMPLATES_WHATSAPP,
  rotaWhatsapp,
  type TemplateWhatsappDef,
} from "@ronan/shared-types";

const entradas = Object.entries(TEMPLATES_WHATSAPP) as [string, TemplateWhatsappDef][];

/** Quantos {{n}} distintos o corpo declara. */
function placeholders(texto: string): number[] {
  const achados = [...texto.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return [...new Set(achados)].sort((a, b) => a - b);
}

describe("catálogo de templates", () => {
  it("tem pelo menos um template", () => {
    expect(entradas.length).toBeGreaterThan(0);
  });

  it.each(entradas)("%s: o corpo declara exatamente os {{n}} que o texto usa", (_rota, def) => {
    // O erro que isto pega: escrever um {{5}} no texto e esquecer o índice no
    // `corpo`. A Meta aceita o template no cadastro e recusa TODA mensagem no
    // envio, dizendo só que a contagem de parâmetros não bate. Aqui o teste
    // falha antes, dizendo qual template é.
    expect(placeholders(def.textoAprovacao)).toEqual(
      Array.from({ length: def.corpo.length }, (_, i) => i + 1),
    );
  });

  it.each(entradas)("%s: nome no formato que a Meta exige", (_rota, def) => {
    // Minúsculas, dígitos e underscore. Nome fora disso a Meta recusa no
    // cadastro — mas quem descobre é quem estiver submetendo, não quem escreveu.
    expect(def.nome).toMatch(/^[a-z0-9_]+$/);
    expect(def.idioma).toBe("pt_BR");
  });

  it.each(entradas)("%s: não lê o mesmo params[] duas vezes no corpo", (_rota, def) => {
    expect(new Set(def.corpo).size).toBe(def.corpo.length);
  });

  it.each(entradas)("%s: a rota existe no catálogo e aceita a Meta", (rota, _def) => {
    const r = rotaWhatsapp(rota);
    expect(r, `rota "${rota}" tem template mas sumiu do catálogo`).toBeDefined();
    expect(r!.provedores).toContain("meta");
  });

  it("rota de autenticação sempre tem botão de copiar código", () => {
    // Sem o botão, o motorista tem que digitar o código à mão olhando a
    // notificação — que é exatamente o atrito que o template de autenticação
    // da Meta existe pra remover.
    for (const r of ROTAS_WHATSAPP.filter((r) => r.categoria === "authentication")) {
      const def = TEMPLATES_WHATSAPP[r.chave];
      expect(def, `${r.chave} sem template`).toBeDefined();
      expect(def!.botao?.tipo, `${r.chave} sem botão de código`).toBe("COPIAR_CODIGO");
    }
  });

  it("toda rota da Meta sem template é texto livre de propósito", () => {
    // Rota `utility`/`authentication` sem template NÃO sai fora da janela de
    // 24h. Se uma aparecer aqui, ou ganhou template ou virou serviço — e
    // qualquer um dos dois é decisão, não esquecimento.
    const semTemplate = ROTAS_WHATSAPP.filter(
      (r) => r.provedores.includes("meta") && !TEMPLATES_WHATSAPP[r.chave],
    ).map((r) => r.chave);
    expect(semTemplate.sort()).toEqual(["MENSAGEM_AVULSA", "RESPOSTA_AGENTE", "RESUMO_GESTOR"]);
  });
});
