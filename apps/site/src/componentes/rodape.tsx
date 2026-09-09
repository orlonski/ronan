import {
  APPSTORE_URL,
  EMAIL,
  PAINEL_URL,
  PLAY_URL,
  PRIVACIDADE_URL,
  PWA_URL,
  WHATSAPP_URL,
} from "../lib/config";

const PRODUTO = [
  { href: "#como-funciona", texto: "Como funciona" },
  { href: "#app", texto: "App do motorista" },
  { href: "#painel", texto: "Painel" },
  { href: "#por-dentro", texto: "Por dentro" },
  { href: "#perguntas", texto: "Perguntas" },
];

export function Rodape() {
  const entrar = [
    { href: PAINEL_URL, texto: "Entrar no painel", externo: true },
    { href: PLAY_URL, texto: "Baixar na Google Play", externo: true },
    APPSTORE_URL
      ? { href: APPSTORE_URL, texto: "Baixar na App Store", externo: true }
      : null,
    { href: PWA_URL, texto: "Abrir a versão web (iPhone)", externo: true },
  ].filter(Boolean) as { href: string; texto: string; externo: boolean }[];

  return (
    <footer className="border-t border-borda bg-fundo">
      <div className="caixa py-14 lg:py-16">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <img
              src="/marca/movatruck-logo.svg"
              alt="Movatruck"
              width={1795}
              height={390}
              className="h-8 w-auto"
            />
            <p className="mt-4 max-w-xs text-[0.95rem] leading-relaxed text-tinta-media">
              Gestão de viagens pra transportadora de carga a granel.
            </p>
          </div>

          <Coluna titulo="Produto">
            {PRODUTO.map((l) => (
              <a key={l.href} href={l.href} className="link-rodape">
                {l.texto}
              </a>
            ))}
          </Coluna>

          <Coluna titulo="Entrar">
            {entrar.map((l) => (
              <a
                key={l.texto}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="link-rodape"
              >
                {l.texto}
              </a>
            ))}
          </Coluna>

          <Coluna titulo="Falar com a gente">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="link-rodape"
            >
              WhatsApp
            </a>
            <a href={`mailto:${EMAIL}`} className="link-rodape">
              {EMAIL}
            </a>
            <a
              href={PRIVACIDADE_URL}
              target="_blank"
              rel="noreferrer"
              className="link-rodape"
            >
              Política de privacidade
            </a>
          </Coluna>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-borda pt-7 text-[0.88rem] text-tinta-fraca sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Movatruck. Feito no Brasil, pra quem roda no Brasil.</p>
          <p>Areia, brita, concreto — e o mês fechando no dia certo.</p>
        </div>
      </div>
    </footer>
  );
}

function Coluna({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-tinta-media">
        {titulo}
      </p>
      <nav className="mt-3 flex flex-col" aria-label={titulo}>
        {children}
      </nav>
    </div>
  );
}
