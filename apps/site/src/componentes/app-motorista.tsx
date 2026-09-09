import {
  Camera,
  CloudOff,
  Images,
  ListChecks,
  Navigation,
  Route,
} from "lucide-react";
import { Bloco, Celular, TituloSecao } from "./ui";
import { APPSTORE_URL, PLAY_URL } from "../lib/config";

const BLOCOS = [
  {
    icone: <CloudOff size={20} aria-hidden />,
    titulo: "Lança sem sinal",
    texto:
      "Viagem, pedágio, abastecimento e foto entram no aparelho na hora — a internet é problema do app, não dele.",
  },
  {
    icone: <ListChecks size={20} aria-hidden />,
    titulo: "Nada fica preso",
    texto:
      "A tela de Pendentes mostra tudo que ainda não subiu, com caminho pra corrigir o que deu errado. Nenhum lançamento evapora em silêncio.",
  },
  {
    icone: <Camera size={20} aria-hidden />,
    titulo: "Foto vira dado",
    texto:
      "Onde a empresa libera o OCR, ele fotografa o ticket e os campos aparecem preenchidos. Sem digitar número de balança no acostamento.",
  },
  {
    icone: <Route size={20} aria-hidden />,
    titulo: "Viagem guiada",
    texto:
      "Onde a empresa libera: Iniciar → carga, parada, descarga → Finalizar. Cada evento com hora e lugar, sem ninguém precisar lembrar depois.",
  },
  {
    icone: <Navigation size={20} aria-hidden />,
    titulo: "Voz na estrada",
    texto:
      "Onde a empresa libera: navegação ao vivo, curva a curva, falada. O celular na base e a mão no volante.",
  },
  {
    icone: <Images size={20} aria-hidden />,
    titulo: "O trecho vira story",
    texto:
      "Foto do trecho que dura 24 horas, com reação da galera. E chat por texto entre motoristas — a conversa privada é deles, o painel não lê.",
  },
];

export function AppMotorista() {
  return (
    <section id="app" className="secao border-t border-borda">
      <div className="caixa">
        <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end lg:gap-16">
          <TituloSecao
            etiqueta="App do motorista"
            titulo="O app é do motorista. Ele lança, ele comprova, ele leva o histórico dele."
            apoio="Android e iPhone. Tela grande, botão grande, e a certeza de que nada se perde quando o sinal cai."
          />
          <div className="revelar flex flex-wrap gap-3 lg:pb-2">
            <a
              href={PLAY_URL}
              target="_blank"
              rel="noreferrer"
              className="btn-secundario"
            >
              Baixar na Google Play
            </a>
            {APPSTORE_URL ? (
              <a
                href={APPSTORE_URL}
                target="_blank"
                rel="noreferrer"
                className="btn-secundario"
              >
                Baixar na App Store
              </a>
            ) : null}
          </div>
        </div>

        <div className="mt-12 grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)] lg:gap-14">
          <div className="revelar mx-auto flex w-full max-w-[460px] items-center justify-center gap-4 self-center lg:max-w-none lg:gap-5">
            <Celular
              src="/telas/21-app-nova-viagem.webp"
              alt="Tela de nova viagem no app: foto do ticket, placa, cliente, material e peso, com campos grandes."
              className="w-1/2 -translate-y-4"
            />
            <Celular
              src="/telas/22-app-historico.webp"
              alt="Histórico de viagens no app do motorista, cada uma com o estado do envio."
              className="w-1/2 translate-y-4"
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {BLOCOS.map((b, i) => (
              <Bloco key={b.titulo} icone={b.icone} titulo={b.titulo} atraso={i * 60}>
                {b.texto}
              </Bloco>
            ))}
          </div>
        </div>

        <p className="revelar mt-10 rounded-xl2 border border-borda bg-azul-lavado px-6 py-5 text-[0.98rem] leading-relaxed text-tinta-media">
          <strong className="font-semibold text-tinta">
            Também no app nativo:
          </strong>{" "}
          diária, meus documentos, meus gastos e calculadora de frete pra quem roda
          por conta própria. No iPhone existe ainda a versão web, que abre no Safari
          sem passar pela loja — ela cobre o lançamento do dia a dia, mas fica atrás
          do app nativo.
        </p>
      </div>
    </section>
  );
}
