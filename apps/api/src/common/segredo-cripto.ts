import type { ConfigService } from "@nestjs/config";

/**
 * O segredo que cifra as chaves de IA guardadas no banco.
 *
 * `CRIPTO_SECRET` quando existir; senão o `JWT_SECRET`, que é `getOrThrow` e
 * portanto sempre está lá. Reusar não é ideal — segredo por finalidade é o
 * certo — mas a alternativa era uma env obrigatória nova, que numa subida
 * esquecida derruba a API inteira em vez de degradar. A derivação por scrypt
 * com sal próprio (`common/cripto.ts`) garante que a chave de cifra não é o
 * JWT_SECRET, mesmo quando nasce dele.
 */
export function segredoDeCripto(config: ConfigService): string {
  return (
    config.get<string>("CRIPTO_SECRET")?.trim() || config.getOrThrow<string>("JWT_SECRET")
  );
}
