import { describe, expect, it } from "vitest";
import { resolverContaEfetiva, type UsuarioParaConta } from "./conta-efetiva";

const CASA = { id: "conta-casa", nome: "Movatruck" };
const CLIENTE = { id: "conta-cliente", nome: "Transportes Contab", ativa: true };

function usuario(over: Partial<UsuarioParaConta> = {}): UsuarioParaConta {
  return { contaId: CASA.id, conta: CASA, plataforma: true, contaAtiva: null, ...over };
}

describe("resolverContaEfetiva", () => {
  it("sem visita, manda a empresa dele", () => {
    expect(resolverContaEfetiva(usuario())).toEqual({ conta: CASA, assumida: false });
  });

  it("operador da plataforma visitando um cliente manda a empresa visitada", () => {
    const r = resolverContaEfetiva(usuario({ contaAtiva: CLIENTE }));
    expect(r.conta.id).toBe(CLIENTE.id);
    expect(r.assumida).toBe(true);
  });

  it("sem o flag de plataforma, a visita não vale — nem se já estava gravada", () => {
    // O caso de quem foi despromovido DEPOIS de entrar numa empresa: a linha
    // continua no banco e não pode continuar valendo.
    const r = resolverContaEfetiva(usuario({ plataforma: false, contaAtiva: CLIENTE }));
    expect(r).toEqual({ conta: CASA, assumida: false });
  });

  it("empresa visitada desativada devolve pra casa, sem erro", () => {
    const r = resolverContaEfetiva(usuario({ contaAtiva: { ...CLIENTE, ativa: false } }));
    expect(r).toEqual({ conta: CASA, assumida: false });
  });

  it("visitar a própria empresa não conta como visita", () => {
    // O painel pode mandar o id que está na tela sem tratar o caso especial —
    // e `assumida: false` mantém a faixa de aviso fora do ar.
    const r = resolverContaEfetiva(usuario({ contaAtiva: { ...CASA, ativa: true } }));
    expect(r).toEqual({ conta: CASA, assumida: false });
  });

  it("nunca inventa conta: a efetiva é sempre a de origem ou a visitada", () => {
    for (const u of [
      usuario(),
      usuario({ contaAtiva: CLIENTE }),
      usuario({ plataforma: false, contaAtiva: CLIENTE }),
      usuario({ contaAtiva: { ...CLIENTE, ativa: false } }),
    ]) {
      const { conta } = resolverContaEfetiva(u);
      expect([u.contaId, u.contaAtiva?.id]).toContain(conta.id);
    }
  });
});
