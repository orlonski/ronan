/**
 * Escolher um ARQUIVO do celular (PDF, print salvo, o que veio por e-mail).
 *
 * ⚠️ POR QUE ISTO É BLINDADO, e por que não pode virar import estático.
 *
 * `expo-document-picker` é MÓDULO NATIVO. O código JS chega na frota por OTA,
 * mas o módulo nativo só entra num build novo de loja — e import estático de
 * módulo que não está no binário **derruba o app no boot**, para todo mundo,
 * não só pra quem toca no botão. Já aconteceu nesta casa (ver CLAUDE.md), e o
 * `expo-speech` em `lib/navegacao.ts` usa exatamente este molde.
 *
 * Então: `disponivel()` responde se o build atual tem o módulo, e a tela só
 * mostra o botão quando a resposta é sim. Nos aparelhos que ainda não
 * atualizaram, o botão simplesmente não existe — e o caminho continua sendo o
 * link que o escritório manda.
 *
 * O motivo de existir: metade da papelada de obra NÃO é foto. eSocial,
 * certificado de NR e contrato chegam em PDF, por e-mail ou WhatsApp, e a
 * galeria do celular não mostra PDF. Sem isto, "manda pelo app" é uma promessa
 * que quebra na metade da lista.
 */

export type ArquivoEscolhido = {
  uri: string;
  mime: string;
  nome: string;
  tamanho: number;
};

type PickerMod = typeof import("expo-document-picker");

let mod: PickerMod | null | undefined = undefined;

async function carregar(): Promise<PickerMod | null> {
  if (mod !== undefined) return mod;
  try {
    // ⚠️ O `import()` sozinho NÃO responde a pergunta certa. O JS do picker
    // está no bundle (veio por OTA, como todo o resto), então ele importa
    // limpo mesmo num aparelho cujo binário não tem o módulo nativo — e aí o
    // botão apareceria e não faria nada, que é pior do que não ter botão.
    //
    // `requireOptionalNativeModule` pergunta pelo NATIVO e devolve null quando
    // ele não está lá. É a única checagem honesta.
    const core = await import("expo-modules-core");
    if (!core.requireOptionalNativeModule("ExpoDocumentPicker")) {
      mod = null;
      return mod;
    }
    mod = await import("expo-document-picker");
  } catch {
    mod = null;
  }
  return mod;
}

/** O build atual consegue abrir os arquivos do celular? */
export async function podeEscolherArquivo(): Promise<boolean> {
  return (await carregar()) !== null;
}

/**
 * Abre os arquivos do celular. Devolve `null` quando ele desiste — desistir não
 * é erro e não pode virar mensagem vermelha.
 */
export async function escolherArquivo(): Promise<ArquivoEscolhido | null> {
  const dp = await carregar();
  if (!dp) return null;
  try {
    const r = await dp.getDocumentAsync({
      // Os mesmos que o servidor aceita. Deixar aberto faria ele escolher um
      // .docx e só descobrir que não serve depois de subir 8 MB.
      type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
      // Copia pro diretório do app: sem isto, no Android a uri é um
      // `content://` que pode expirar antes de o outbox drenar — e o item
      // morreria dias depois, sem ninguém entender.
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (r.canceled) return null;
    const a = r.assets?.[0];
    if (!a) return null;
    return {
      uri: a.uri,
      mime: a.mimeType ?? "application/pdf",
      nome: a.name ?? "documento.pdf",
      tamanho: a.size ?? 0,
    };
  } catch {
    return null;
  }
}
