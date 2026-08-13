import { adotarChavesLegadas, descartarChavesLegadas } from "./storage";
import {
  carregarSessoes,
  donoLegado,
  limparDonoLegado,
  migrarSessaoLegada,
  motoristaAtivoId,
} from "./sessoes";

/**
 * Prepara as sessões no boot, ANTES de qualquer tela ou drain.
 *
 * Duas coisas acontecem aqui, nesta ordem, e as duas existem por causa da mesma
 * regra: quem já estava logado não pode ser deslogado nem perder lançamento
 * pendente por causa desta atualização.
 *
 * 1. A sessão única antiga vira a sessão da empresa ativa (`migrarSessaoLegada`).
 * 2. TUDO que estava no prefixo global — cache, outbox, viagem em andamento,
 *    fila de posições, geofence — é ADOTADO pelo cadastro que o passo 1
 *    identificou pelo próprio token.
 *
 * Se o passo 1 não conseguir (Keychain travado, token ilegível), nada é movido e
 * o app segue no caminho antigo: continua logado, continua achando os dados.
 */
export async function prepararSessoes(): Promise<void> {
  await carregarSessoes();
  await migrarSessaoLegada();

  const ativo = await motoristaAtivoId();
  const dono = await donoLegado();
  if (!dono) return;

  if (ativo && dono === ativo) {
    await adotarChavesLegadas(ativo);
  } else {
    // Dado global de um cadastro que não é o que está logado agora. Não dá pra
    // adotar (seria o pendente de um indo embora com o token do outro) e não dá
    // pra deixar (o próximo login adotaria por engano).
    await descartarChavesLegadas();
  }
  await limparDonoLegado();
}

/**
 * Depois de um login: resolve o que fazer com dado global que tenha sobrado.
 * Adota se for do mesmo cadastro que acabou de entrar; senão, descarta.
 */
export async function resolverLegadoAposLogin(motoristaId: string): Promise<void> {
  const dono = await donoLegado();
  if (!dono) return;
  if (dono === motoristaId) await adotarChavesLegadas(motoristaId);
  else await descartarChavesLegadas();
  await limparDonoLegado();
}
