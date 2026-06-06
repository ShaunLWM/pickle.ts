import type { BaseAdapter } from "../adapters/base-adapter.js";
import type { ServerMessages } from "../types/message-types.js";

type WaitForFn = <K extends keyof ServerMessages>(
  event: K,
  timeout?: number,
) => Promise<ServerMessages[K]>;

export class CardJitsu {
  constructor(
    private adapter: BaseAdapter,
    private waitFor: WaitForFn,
  ) {}

  /** Fetch ninja rank, progress, and card deck. Resolves with ninja data. */
  getNinja(): Promise<ServerMessages["get_ninja"]> {
    this.adapter.getNinja();
    return this.waitFor("get_ninja");
  }

  /** Fetch state of all Dojo mats. Resolves with mat state. */
  getMats(): Promise<ServerMessages["get_waddles"]> {
    this.adapter.getMats();
    return this.waitFor("get_waddles");
  }

  /** Sit on a Dojo mat to wait for an opponent. Listen for `update_waddle` events. */
  joinMat(waddle: number): void {
    this.adapter.joinMat(waddle);
  }

  /** Join Sensei matchmaking queue. Resolves when server acknowledges. */
  joinMatchmaking(): Promise<ServerMessages["join_matchmaking"]> {
    this.adapter.joinMatchmaking();
    return this.waitFor("join_matchmaking");
  }

  /** Leave Sensei matchmaking queue. */
  leaveMatchmaking(): void {
    this.adapter.leaveMatchmaking();
  }

  /** Start a Card-Jitsu match after entering a game room. Resolves with player info. */
  startGame(): Promise<ServerMessages["start_game"]> {
    this.adapter.startGame();
    return this.waitFor("start_game");
  }

  /** Play a card from your hand by slot index. Resolves when server acknowledges. */
  selectCard(slot: number): Promise<ServerMessages["move_my_card"]> {
    this.adapter.selectCard(slot);
    return this.waitFor("move_my_card");
  }

  /** Preload a power card animation asset. */
  loadAnimation(animation: string): void {
    this.adapter.loadAnimation(animation);
  }
}
