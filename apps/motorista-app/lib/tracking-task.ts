/**
 * Define a task GPS de tracking. defineTask **NÃO** pode rodar no
 * top-level junto com import nativo (quebra expo-router). Em vez disso,
 * `registerTrackingTask()` é chamado em useEffect do _layout boot, o
 * que é cedo o suficiente pro sistema achar a task quando precisar.
 */
import type { LocationObject } from "expo-location";
import { appendPontos } from "./tracking-storage";

export const TRACKING_TASK = "ronan-viagem-tracking";

let registered = false;

export async function registerTrackingTask(): Promise<void> {
  if (registered) return;
  registered = true;
  const TaskManager = await import("expo-task-manager");
  TaskManager.defineTask(TRACKING_TASK, async ({ data, error }) => {
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[tracking-task] erro:", error.message);
      return;
    }
    if (!data) return;
    const locations = (data as { locations?: LocationObject[] }).locations ?? [];
    if (locations.length === 0) return;

    // Filtra pontos ruins (precisao baixa, velocidade absurda).
    const filtrados = locations
      .filter((l) => {
        const acc = l.coords.accuracy;
        const speed = l.coords.speed;
        if (acc != null && acc > 100) return false;
        if (speed != null && speed > 56) return false; // 56 m/s ~ 200 km/h
        return true;
      })
      .map((l) => ({
        lat: l.coords.latitude,
        lng: l.coords.longitude,
        capturadoEm: new Date(l.timestamp).toISOString(),
        velocidade: l.coords.speed ?? undefined,
        precisao: l.coords.accuracy ?? undefined,
      }));

    if (filtrados.length === 0) return;
    try {
      await appendPontos(filtrados);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[tracking-task] falhou append:", (err as Error).message);
    }
  });
}
