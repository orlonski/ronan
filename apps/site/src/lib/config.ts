// Valores públicos do site (número de contato, domínios, lojas). Moram aqui, no
// código, e são a ÚNICA fonte: este arquivo não lê `import.meta.env` de
// propósito.
//
// O motivo é uma armadilha que já custou três deploys. As "Variáveis de
// Ambiente" do serviço no Easypanel *chegam* no build — ao contrário do que
// estava escrito aqui antes. O bundle que estava no ar trazia embutido
// `{VITE_APP_URL:"...",VITE_EMAIL:"",VITE_WHATSAPP:"5542984223261"}`: valores
// velhos, cadastrados no painel meses atrás, vencendo silenciosamente o `??`
// deste arquivo. Trocar o número no código e implantar não adiantava, e o painel
// dizia "implantado" nas duas vezes.
//
// Pior: `VITE_EMAIL` estava cadastrada vazia, e `"" ?? "contato@..."` devolve
// `""` — o e-mail de contato sumiu do site sem ninguém notar.
//
// Enquanto o site não lê env, o painel não tem como estragar a página. Pra
// buildar apontando pra outro ambiente, edite este arquivo na sua branch.
//
// Mudar qualquer coisa aqui = commit + deploy. Nada disso é segredo: tudo
// aparece na página pra quem abrir o site.

export const SITE_URL = "https://www.movatruck.com.br";
export const PAINEL_URL = "https://app.movatruck.com.br";
export const PWA_URL = "https://motorista.schaba.com.br";
export const PRIVACIDADE_URL = `${PAINEL_URL}/politica-de-privacidade`;

/**
 * Onde a pessoa cria a conta dela.
 *
 * Mora no painel, e não aqui no site, porque o último passo do cadastro é
 * entrar logado — e a sessão vive lá. Se o formulário fosse daqui, ela
 * terminaria de se cadastrar e teria que digitar e-mail e senha de novo.
 */
export const CADASTRO_URL = `${PAINEL_URL}/cadastro`;

/** Número comercial: quem chega pelo site é lead e cai no inbox de vendas. */
const zap = "5542991563750".replace(/\D/g, "");
const recado = encodeURIComponent(
  "Oi! Vi o site do Movatruck e quero agendar uma demonstração.",
);

export const WHATSAPP_URL = `https://wa.me/${zap}?text=${recado}`;
export const EMAIL = "contato@movatruck.com.br";

export const PLAY_URL =
  "https://play.google.com/store/apps/details?id=br.com.schaba.motorista";
export const APPSTORE_URL = "";
