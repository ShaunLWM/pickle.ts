import type { BaseAdapter } from "../adapters/base-adapter.js";

export class CardJitsu {
  constructor(private adapter: BaseAdapter) {}

  /** Fetch ninja rank, progress, and card deck. Listen for `get_ninja` event. */
  getNinja(): void {
    this.adapter.getNinja();
  }

  /** Fetch state of all Dojo mats. Listen for `get_waddles` event. */
  getMats(): void {
    this.adapter.getMats();
  }

  /** Sit on a Dojo mat to wait for an opponent. Listen for `update_waddle` events. */
  joinMat(waddle: number): void {
    this.adapter.joinMat(waddle);
  }

  /** Join Sensei matchmaking queue. Listen for `tick_matchmaking` events. */
  joinMatchmaking(): void {
    this.adapter.joinMatchmaking();
  }

  /** Leave Sensei matchmaking queue. */
  leaveMatchmaking(): void {
    this.adapter.leaveMatchmaking();
  }

  /** Start a Card-Jitsu match after entering a game room. Listen for `start_game` event. */
  startGame(): void {
    this.adapter.startGame();
  }

  /** Play a card from your hand by slot index. Listen for `move_my_card` event. */
  selectCard(slot: number): void {
    this.adapter.selectCard(slot);
  }

  /** Preload a power card animation asset. */
  loadAnimation(animation: string): void {
    this.adapter.loadAnimation(animation);
  }
}
