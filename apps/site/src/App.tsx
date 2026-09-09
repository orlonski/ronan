import { Cabecalho } from "./componentes/cabecalho";
import { Hero } from "./componentes/hero";
import { Prova } from "./componentes/prova";
import { Problema } from "./componentes/problema";
import { ComoFunciona } from "./componentes/como-funciona";
import { AppMotorista } from "./componentes/app-motorista";
import { Painel } from "./componentes/painel";
import { PorDentro } from "./componentes/por-dentro";
import { MultiEmpresa } from "./componentes/multi-empresa";
import { ParaQuem } from "./componentes/para-quem";
import { Faq } from "./componentes/faq";
import { CtaFinal } from "./componentes/cta-final";
import { Rodape } from "./componentes/rodape";
import { useRevelar } from "./lib/revelar";

export default function App() {
  useRevelar();

  return (
    <>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-azul focus:px-4 focus:py-3 focus:text-white"
      >
        Pular para o conteúdo
      </a>

      <Cabecalho />

      <main id="conteudo">
        <Hero />
        <Prova />
        <Problema />
        <ComoFunciona />
        <AppMotorista />
        <Painel />
        <PorDentro />
        <MultiEmpresa />
        <ParaQuem />
        <Faq />
        <CtaFinal />
      </main>

      <Rodape />
    </>
  );
}
