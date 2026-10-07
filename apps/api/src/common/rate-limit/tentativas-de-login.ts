/**
 * Freio contra adivinhar senha: N erros na janela bloqueiam AQUELA conta por
 * um tempo. Em memória, como o resto do rate limit (ver contador-janela.ts):
 * reiniciar o processo zera — aceitável pra freio de força bruta, não pra
 * regra de negócio.
 *
 * Por CONTA (e-mail), e não só por IP: quem testa senha de um administrador
 * troca de IP à vontade; o e-mail é o alvo, e é ele que trava.
 */
export class TentativasDeLogin {
  private readonly falhas = new Map<string, number[]>();
  private readonly bloqueios = new Map<string, number>();

  constructor(
    private readonly opcoes: { maxFalhas: number; janelaMs: number; bloqueioMs: number },
  ) {}

  /** Minutos que faltam, se a conta está bloqueada; null se pode tentar. */
  bloqueada(chave: string, agora = Date.now()): number | null {
    const ate = this.bloqueios.get(chave);
    if (!ate) return null;
    if (ate <= agora) {
      this.bloqueios.delete(chave);
      return null;
    }
    return Math.ceil((ate - agora) / 60_000);
  }

  /** Conta uma senha errada; devolve true se essa falha acabou de bloquear a conta. */
  falhou(chave: string, agora = Date.now()): boolean {
    const corte = agora - this.opcoes.janelaMs;
    const recentes = (this.falhas.get(chave) ?? []).filter((t) => t > corte);
    recentes.push(agora);
    this.falhas.set(chave, recentes);
    if (this.falhas.size > 10_000) {
      for (const [k, v] of this.falhas) if (v.every((t) => t <= corte)) this.falhas.delete(k);
    }
    if (recentes.length >= this.opcoes.maxFalhas) {
      this.bloqueios.set(chave, agora + this.opcoes.bloqueioMs);
      this.falhas.delete(chave);
      return true;
    }
    return false;
  }

  /** Login certo zera a contagem. */
  acertou(chave: string): void {
    this.falhas.delete(chave);
    this.bloqueios.delete(chave);
  }
}
