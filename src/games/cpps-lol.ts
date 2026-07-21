import type { BaseAdapter } from "../adapters/base-adapter.js";
import { CppslolAdapter } from "../adapters/cpps-lol-adapter.js";
import { ClientOperationError } from "../errors.js";
import type { ClientOperationOptions } from "../lifecycle.js";
import type { ServerMessages } from "../types/message-types.js";

type RequestFn = <K extends keyof ServerMessages>(
  event: K,
  send: () => void,
  options?: ClientOperationOptions,
  matches?: (args: ServerMessages[K]) => boolean,
) => Promise<ServerMessages[K]>;

/** Operations implemented only by CPPS.lol's captured protocol. */
export class Cppslol {
  constructor(
    private readonly baseAdapter: BaseAdapter,
    private readonly request: RequestFn,
  ) {}

  private get adapter(): CppslolAdapter {
    if (this.baseAdapter instanceof CppslolAdapter) return this.baseAdapter;
    throw new ClientOperationError({
      category: "unsupported_operation",
      phase: "ready",
      retryable: false,
      message: `${this.baseAdapter.id} does not support CPPS.lol actions`,
    });
  }

  /** Send an emote from a CPPS.lol emote pack. */
  sendPackedEmote(pack: number, emote: number): void {
    this.adapter.sendPackedEmote(pack, emote);
  }

  /** Equip an item in CPPS.lol's additional appearance layer. */
  updateLayeredPlayer(item: number): void {
    this.adapter.updateLayeredPlayer(item);
  }

  /** Acknowledge the mature-server notice for the current session. */
  acceptMature(): void {
    this.adapter.acceptMature();
  }

  removeInventory(
    item: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["remove_inventory"]> {
    return this.request(
      "remove_inventory",
      () => this.adapter.removeInventory(item),
      options,
      (response) => Number(response.id) === item,
    );
  }

  getSnowflakeState(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["snowflake_state"]> {
    return this.request(
      "snowflake_state",
      () => this.adapter.getSnowflakeState(),
      options,
    );
  }

  getPets(
    userId: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["get_pets"]> {
    return this.request(
      "get_pets",
      () => this.adapter.getPets(userId),
      options,
      (response) => response.userId === undefined || response.userId === userId,
    );
  }

  getIglooContest(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["igloo_contest"]> {
    return this.request(
      "igloo_contest",
      () => this.adapter.getIglooContest(),
      options,
    );
  }

  getIglooLikes(
    iglooId: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["igloo_likes"]> {
    return this.request(
      "igloo_likes",
      () => this.adapter.getIglooLikesFor(iglooId),
      options,
      (response) => response.iglooId === iglooId,
    );
  }

  likeIgloo(
    iglooId: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["igloo_likes"]> {
    return this.request(
      "igloo_likes",
      () => this.adapter.likeIglooById(iglooId),
      options,
      (response) => response.iglooId === iglooId,
    );
  }

  /** CPPS.lol does not acknowledge this action with a dedicated response. */
  openIgloo(): void {
    this.adapter.openIglooRaw();
  }

  sendMail(recipient: number, postcardId: number): void {
    this.adapter.sendMail(recipient, postcardId);
  }

  marryRequest(id: number): void {
    this.adapter.marryRequest(id);
  }

  leaveWaddle(): void {
    this.adapter.leaveWaddle();
  }
}
