// Store síncrono + persistência pro tutorial de coachmarks (spotlight + balão).
// Segue o mesmo padrão do auth-state/alert: um singleton de módulo com
// listeners; o <TutorialHost /> escuta e renderiza o overlay.
//
// - Telas marcam botões com <CoachTarget id="..."> que registram aqui uma
//   função pra medir a posição do elemento na janela (measureInWindow).
// - startTutorial() coloca uma sequência de passos no ar; o host mede o alvo
//   do passo atual e desenha o furo + balão.
// - "Já viu" fica em AsyncStorage por chave (ex: "home.v1") pra só aparecer
//   no primeiro uso. Perfil pode forçar replay.

import AsyncStorage from "@react-native-async-storage/async-storage";

export type CoachRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TutorialStep = {
  /** id único do passo dentro da sequência */
  id: string;
  /** id do CoachTarget a destacar; ausente = balão centralizado (sem furo) */
  targetId?: string;
  title: string;
  body: string;
  /** formato do furo ao redor do alvo */
  shape?: "rect" | "circle";
};

export type TutorialRun = {
  key: string;
  steps: TutorialStep[];
  index: number;
};

type Listener = () => void;
type Measurer = () => Promise<CoachRect | null>;

const listeners = new Set<Listener>();
const targets = new Map<string, Measurer>();

let _run: TutorialRun | null = null;

const SEEN_PREFIX = "tutorial.seen.";

function emit() {
  for (const l of listeners) l();
}

// --- alvos (CoachTarget) ---------------------------------------------------

/** Registra a função de medição de um alvo. Retorna unregister. */
export function registerCoachTarget(id: string, measurer: Measurer): () => void {
  targets.set(id, measurer);
  return () => {
    // só remove se ainda for o mesmo (evita corrida de remount)
    if (targets.get(id) === measurer) targets.delete(id);
  };
}

export function getCoachMeasurer(id: string): Measurer | undefined {
  return targets.get(id);
}

// --- run / passos ----------------------------------------------------------

export function getTutorialRun(): TutorialRun | null {
  return _run;
}

export function subscribeTutorial(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Inicia (ou reinicia) a sequência. Não checa "já viu" — use o helper. */
export function startTutorial(key: string, steps: TutorialStep[]): void {
  if (steps.length === 0) return;
  _run = { key, steps, index: 0 };
  emit();
}

/** Avança um passo; finaliza (marca como visto) se for o último. */
export function advanceTutorial(): void {
  if (!_run) return;
  if (_run.index >= _run.steps.length - 1) {
    finishTutorial();
    return;
  }
  _run = { ..._run, index: _run.index + 1 };
  emit();
}

export function backTutorial(): void {
  if (!_run || _run.index === 0) return;
  _run = { ..._run, index: _run.index - 1 };
  emit();
}

/** Encerra o tutorial e marca a chave como vista (não aparece de novo). */
export function finishTutorial(): void {
  if (!_run) return;
  const key = _run.key;
  _run = null;
  emit();
  void markTutorialSeen(key);
}

// --- persistência "já viu" -------------------------------------------------

export async function hasSeenTutorial(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SEEN_PREFIX + key)) === "1";
  } catch {
    // Se o storage falhar, prefere NÃO mostrar repetidamente: assume visto.
    return true;
  }
}

export async function markTutorialSeen(key: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SEEN_PREFIX + key, "1");
  } catch {
    /* sem storage — ok, no máximo mostra de novo no próximo boot */
  }
}

export async function resetTutorialSeen(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(SEEN_PREFIX + key);
  } catch {
    /* ignora */
  }
}

/** Inicia só se a chave ainda não foi vista. */
export async function startTutorialIfUnseen(
  key: string,
  steps: TutorialStep[],
): Promise<void> {
  if (await hasSeenTutorial(key)) return;
  startTutorial(key, steps);
}
