/**
 * Contador de hits por chave numa janela deslizante de 1 minuto, em memória.
 *
 * Em memória de propósito: rate limit aqui é defesa contra flood/scraping, não
 * regra de negócio — se o processo reiniciar e o contador zerar, ninguém se
 * machuca. Vale a mesma ressalva de sempre: com duas réplicas, o limite efetivo
 * é o dobro. Se um dia isso virar regra de negócio, precisa sair pro Redis.
 */
export class ContadorJanela {
  private readonly janelaMs = 60_000;
  private readonly hits = new Map<string, number[]>();

  /** Registra um hit e devolve quantos houve na janela (incluindo este). */
  registrar(chave: string, agora = Date.now()): number {
    const corte = agora - this.janelaMs;

    const recentes = (this.hits.get(chave) ?? []).filter((t) => t > corte);
    recentes.push(agora);
    this.hits.set(chave, recentes);

    // Poda preguiçosa: sem isso o Map cresce pra sempre com chave que sumiu.
    if (this.hits.size > 5_000) {
      for (const [k, marcas] of this.hits) {
        if (marcas.every((t) => t <= corte)) this.hits.delete(k);
      }
    }

    return recentes.length;
  }
}
