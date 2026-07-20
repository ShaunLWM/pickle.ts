import type { BaseAdapter } from "../adapters/base-adapter.js";
import type { ClientOperationOptions } from "../lifecycle.js";
import type { ServerMessages } from "../types/message-types.js";

type RequestFn = <K extends keyof ServerMessages>(
  event: K,
  send: () => void,
  options?: ClientOperationOptions,
  matches?: (args: ServerMessages[K]) => boolean,
) => Promise<ServerMessages[K]>;

export class CardJitsu {
  constructor(
    private adapter: BaseAdapter,
    private request: RequestFn,
  ) {}

  /** Fetch ninja rank, progress, and card deck. Resolves with ninja data. */
  getNinja(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["get_ninja"]> {
    return this.request("get_ninja", () => this.adapter.getNinja(), options);
  }

  /** Fetch state of all Dojo mats. Resolves with mat state. */
  getMats(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["get_waddles"]> {
    return this.request("get_waddles", () => this.adapter.getMats(), options);
  }

  /** Sit on a Dojo mat to wait for an opponent. Listen for `update_waddle` events. */
  joinMat(waddle: number): void {
    this.adapter.joinMat(waddle);
  }

  /** Join Sensei matchmaking queue. Resolves when server acknowledges. */
  joinMatchmaking(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["join_matchmaking"]> {
    return this.request(
      "join_matchmaking",
      () => this.adapter.joinMatchmaking(),
      options,
    );
  }

  /** Leave Sensei matchmaking queue. */
  leaveMatchmaking(): void {
    this.adapter.leaveMatchmaking();
  }

  /** Start a Card-Jitsu match after entering a game room. Resolves with player info. */
  startGame(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["start_game"]> {
    return this.request("start_game", () => this.adapter.startGame(), options);
  }

  /** Play a card from your hand by slot index. Resolves when server acknowledges. */
  selectCard(
    slot: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["move_my_card"]> {
    return this.request(
      "move_my_card",
      () => this.adapter.selectCard(slot),
      options,
      (response) => response.slot === slot,
    );
  }

  /** Preload a power card animation asset. */
  loadAnimation(animation: string): void {
    this.adapter.loadAnimation(animation);
  }
}
