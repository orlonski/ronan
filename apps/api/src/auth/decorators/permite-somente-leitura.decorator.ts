import { SetMetadata } from "@nestjs/common";

export const PERMITE_SOMENTE_LEITURA = "permiteSomenteLeitura";

/**
 * Deixa esta escrita passar mesmo com a empresa em modo somente leitura.
 *
 * Reservado para o que é de SESSÃO, não de operação: sair, trocar a própria
 * senha, marcar um aviso como lido. A régua para saber se cabe aqui: "isso
 * muda o dado da empresa?" — se muda, não cabe, por mais inofensivo que pareça.
 */
export const PermiteSomenteLeitura = () => SetMetadata(PERMITE_SOMENTE_LEITURA, true);
