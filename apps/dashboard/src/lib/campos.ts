/**
 * TECLADO CERTO POR CAMPO (Leva 1, fatia 6). Só atributos HTML: não mexem em máscara, validação nem valor.
 * Espalhe no <Input>: `<Input {...CAMPO.cpf} ... />` (as props explícitas escritas depois vencem).
 * Guia e regras: tests/ux/README.md ("Teclado certo por campo").
 *
 * - `inputMode` escolhe o teclado do celular (numérico, decimal, telefone, e-mail, busca).
 * - `autoComplete` deixa o iOS/Android/gerenciador de senhas preencher; `autoCapitalize`/`autoCorrect`/`spellCheck`
 *   impedem o teclado de "corrigir" placa, e-mail ou CPF.
 * - `enterKeyHint` troca a tecla de ação ("Ir", "Buscar", "Próximo").
 */
import type { InputHTMLAttributes } from "react";

type Atributos = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "inputMode" | "autoComplete" | "autoCapitalize" | "autoCorrect" | "spellCheck" | "enterKeyHint"
>;

const SEM_CORRECAO = { autoCapitalize: "none", autoCorrect: "off", spellCheck: false } as const;

export const CAMPO = {
  /** CPF, CNPJ, CPF-ou-CNPJ, CEP, odômetro, número de documento: só dígitos. */
  numerico: { inputMode: "numeric", autoComplete: "off", ...SEM_CORRECAO } satisfies Atributos,
  cpf: { inputMode: "numeric", autoComplete: "off", ...SEM_CORRECAO } satisfies Atributos,
  cnpj: { inputMode: "numeric", autoComplete: "off", ...SEM_CORRECAO } satisfies Atributos,
  cep: { inputMode: "numeric", autoComplete: "off", ...SEM_CORRECAO } satisfies Atributos,
  /** Litros, R$, km com vírgula: teclado numérico com separador decimal. */
  decimal: { inputMode: "decimal", autoComplete: "off", ...SEM_CORRECAO } satisfies Atributos,
  /**
   * Telefone/e-mail da PRÓPRIA pessoa (login, cadastro da conta): o navegador pode sugerir o dele.
   * Dos TERCEIROS (motorista, usuário, cliente que o escritório cadastra) usa `*Terceiro`: `autoComplete="off"`,
   * senão o iOS/Chrome oferece o telefone/e-mail de quem está logado no campo do motorista.
   */
  telefone: { type: "tel", inputMode: "tel", autoComplete: "tel", ...SEM_CORRECAO } satisfies Atributos,
  telefoneTerceiro: { type: "tel", inputMode: "tel", autoComplete: "off", ...SEM_CORRECAO } satisfies Atributos,
  email: { type: "email", inputMode: "email", autoComplete: "email", ...SEM_CORRECAO } satisfies Atributos,
  emailTerceiro: { type: "email", inputMode: "email", autoComplete: "off", ...SEM_CORRECAO } satisfies Atributos,
  /** Placa: caixa alta e sem corretor ("ABC1D23" não é palavra). */
  placa: { autoCapitalize: "characters", autoCorrect: "off", spellCheck: false, autoComplete: "off" } satisfies Atributos,
  /**
   * Nome da PRÓPRIA pessoa (cadastro da conta): `autoComplete="name"`.
   * Nome de motorista, usuário, empresa, local ou contato é de OUTRO: `nomeLivre` (sem sugestão do navegador,
   * que ofereceria o nome de quem está logado).
   */
  nome: { autoComplete: "name", autoCapitalize: "words" } satisfies Atributos,
  nomeLivre: { autoComplete: "off", autoCapitalize: "words" } satisfies Atributos,
  /** Texto livre sem corretor (chave Pix, código). */
  semCorretor: { autoComplete: "off", ...SEM_CORRECAO } satisfies Atributos,
  /** Código de 6 dígitos por SMS/WhatsApp. */
  codigoUnico: { inputMode: "numeric", autoComplete: "one-time-code", ...SEM_CORRECAO } satisfies Atributos,
  organizacao: { autoComplete: "organization", autoCapitalize: "words" } satisfies Atributos,
  /**
   * Endereço de LOCAL (pedreira, obra, posto): não é o endereço de quem digita, então `autoComplete="off"`
   * (o `street-address`/`address-level*` ofereceria a casa da pessoa). Só deixa a caixa certa.
   */
  logradouro: { autoComplete: "off", autoCapitalize: "words" } satisfies Atributos,
  cidade: { autoComplete: "off", autoCapitalize: "words" } satisfies Atributos,
  uf: { autoComplete: "off", autoCapitalize: "characters", autoCorrect: "off", spellCheck: false } satisfies Atributos,
  busca: { inputMode: "search", enterKeyHint: "search", autoComplete: "off", ...SEM_CORRECAO } satisfies Atributos,
  /** Login: senha que já existe. */
  senhaAtual: { type: "password", autoComplete: "current-password" } satisfies Atributos,
  /** Cadastro / troca: senha NOVA (o gerenciador de senhas oferece uma forte). */
  senhaNova: { type: "password", autoComplete: "new-password" } satisfies Atributos,
} as const;
