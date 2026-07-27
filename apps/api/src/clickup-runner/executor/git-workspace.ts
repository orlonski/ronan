import { Logger } from "@nestjs/common";
import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type ResultadoGit = { stdout: string; stderr: string };

/**
 * Workspace de trabalho do agente: um clone base persistido no volume e um
 * `git worktree` por task.
 *
 * Sempre via `execFile` com array de argumentos — nunca shell. O taskId vem de
 * fora (query do webhook) e vira nome de branch; com shell no meio, um id
 * hostil viraria execução de comando.
 */
export class WorkspaceGit {
  private readonly logger = new Logger("ClickupRunner");

  constructor(
    /** Onde mora o clone base e os worktrees (volume). */
    private readonly dirTrabalho: string,
    private readonly repoUrl: string,
    private readonly branchBase: string,
  ) {}

  private get dirRepo(): string {
    return join(this.dirTrabalho, "repo");
  }

  /**
   * Garante o clone base atualizado. Clona na primeira vez (o volume é vazio) e
   * depois só busca — sem volume isso se repete a cada deploy, o que é lento
   * mas não quebra.
   */
  async prepararBase(): Promise<void> {
    await mkdir(this.dirTrabalho, { recursive: true });

    if (!existsSync(join(this.dirRepo, ".git"))) {
      this.logger.log(JSON.stringify({ evento: "git-clone", destino: this.dirRepo }));
      // --filter=blob:none: histórico completo (o agente às vezes precisa de
      // git log/blame) sem baixar todo blob antigo.
      await this.git(this.dirTrabalho, [
        "clone",
        "--filter=blob:none",
        this.repoUrl,
        this.dirRepo,
      ]);
      return;
    }

    await this.git(this.dirRepo, ["fetch", "origin", this.branchBase, "--prune"]);
  }

  /**
   * Cria o worktree da task a partir da base ATUALIZADA (`origin/<base>`), nunca
   * do que estava no disco. Worktree/branch remanescentes de uma execução
   * anterior são descartados antes.
   */
  async criarWorktree(branch: string): Promise<string> {
    const dir = join(this.dirTrabalho, "wt", branch.replace(/\//g, "__"));

    await this.removerWorktree(dir, branch);
    await mkdir(join(this.dirTrabalho, "wt"), { recursive: true });
    await this.git(this.dirRepo, [
      "worktree",
      "add",
      "-B",
      branch,
      dir,
      `origin/${this.branchBase}`,
    ]);
    return dir;
  }

  /** Caminhos alterados (inclui não-rastreados). Vazio = agente não mexeu em nada. */
  async arquivosAlterados(dir: string): Promise<string[]> {
    const { stdout } = await this.git(dir, ["status", "--porcelain=v1", "--untracked-files=all"]);
    return stdout
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter(Boolean);
  }

  /** Resumo do diff pro relato (`git diff --stat` do que foi commitado). */
  async resumoDiff(dir: string): Promise<string> {
    const { stdout } = await this.git(dir, ["diff", "--stat", `origin/${this.branchBase}`, "HEAD"]);
    return stdout.trim();
  }

  async commitar(dir: string, mensagem: string): Promise<string | null> {
    await this.git(dir, ["add", "-A"]);
    const pendentes = await this.arquivosAlterados(dir);
    if (pendentes.length === 0) return null;

    await this.git(dir, ["commit", "-m", mensagem]);
    const { stdout } = await this.git(dir, ["rev-parse", "--short", "HEAD"]);
    return stdout.trim();
  }

  async publicar(dir: string, branch: string): Promise<void> {
    await this.git(dir, ["push", "--force-with-lease", "origin", `HEAD:refs/heads/${branch}`]);
  }

  /** Remove worktree e branch local de uma execução anterior da mesma task. */
  async removerWorktree(dir: string, branch: string): Promise<void> {
    if (existsSync(dir)) {
      await this.git(this.dirRepo, ["worktree", "remove", "--force", dir]).catch(() => undefined);
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    await this.git(this.dirRepo, ["worktree", "prune"]).catch(() => undefined);
    await this.git(this.dirRepo, ["branch", "-D", branch]).catch(() => undefined);
  }

  private git(cwd: string, args: string[]): Promise<ResultadoGit> {
    return exec("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        // Se faltar credencial, o git precisa FALHAR na hora em vez de ficar
        // esperando usuário/senha num terminal que não existe.
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "echo",
      },
    });
  }
}
