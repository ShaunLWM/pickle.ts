import type { ManagerOptions, Socket, SocketOptions } from "socket.io-client";
import {
  buildConnectionHeaders,
  type HeaderBag,
  type NormalizedConnectionProfile,
  resolveConnectionOrigin,
  resolveConnectionProfile,
} from "../connection-profile.js";
import { ClientOperationError } from "../errors.js";
import {
  type ClientConnectionTimeouts,
  type ClientLifecyclePhase,
  type ClientLifecycleUpdate,
  type ClientOperationOptions,
  DEFAULT_CLIENT_CONNECTION_TIMEOUTS,
} from "../lifecycle.js";
import type {
  LoginOptions,
  LoginResult,
  QueueUpdate,
  TokenLoginOptions,
} from "../types/adapter-types.js";
import type {
  PlayerAppearance,
  PlayerData,
  RoomUser,
} from "../types/player-types.js";

type SocketIoConnectionOptions = Partial<ManagerOptions & SocketOptions> & {
  extraHeaders?: Record<string, string>;
  origin?: string;
};

export type AdapterMessage = {
  action: string;
  args: Record<string, unknown>;
};

export type ConnectOptions = {
  signal?: AbortSignal;
  timeouts?: Partial<ClientConnectionTimeouts>;
  onQueueUpdate?: (update: QueueUpdate) => void;
  onLifecycleUpdate?: (update: ClientLifecycleUpdate) => void;
  /** @internal Normalized message delivery installed before session join. */
  onMessage?: (message: AdapterMessage) => void;
  /** @internal Transport disconnect delivery installed before session join. */
  onDisconnect?: (reason: string | null) => void;
};

export abstract class BaseAdapter {
  abstract readonly id: string;
  readonly rejectRequestsOnServerError: boolean = false;
  protected socket: Socket | null = null;
  loginMessage: string | null = null;
  loginStatus: "active" | "banned" = "active";

  constructor(
    protected readonly connectionProfile: NormalizedConnectionProfile = resolveConnectionProfile(),
  ) {}

  abstract login(
    options: LoginOptions | TokenLoginOptions,
    operationOptions?: ClientOperationOptions,
  ): Promise<LoginResult>;
  abstract connect(
    serverName: string,
    loginResult: LoginResult,
    options?: ConnectOptions,
  ): Promise<Socket>;
  abstract disconnect(): void;
  abstract send(action: string, args: Record<string, unknown>): void;

  protected connectionTimeouts(
    options?: ConnectOptions,
  ): ClientConnectionTimeouts {
    return {
      ...DEFAULT_CLIENT_CONNECTION_TIMEOUTS,
      ...options?.timeouts,
    };
  }

  protected reportLifecycle(
    options: ConnectOptions | undefined,
    phase: ClientLifecyclePhase,
    queue?: QueueUpdate,
  ): void {
    options?.onLifecycleUpdate?.({
      phase,
      occurredAt: Date.now(),
      ...(queue ? { queue } : {}),
    });
  }

  protected resetLoginState(): void {
    this.loginMessage = null;
    this.loginStatus = "active";
  }

  protected unsupportedOperation(operation: string): ClientOperationError {
    return new ClientOperationError({
      category: "unsupported_operation",
      phase: "ready",
      retryable: false,
      message: `${this.id} does not support ${operation}`,
    });
  }

  protected socketIoOptions(
    defaultUrlOrOrigin: string,
  ): SocketIoConnectionOptions {
    const headers = this.connectionHeaders(defaultUrlOrOrigin);
    const origin = this.connectionOrigin(defaultUrlOrOrigin);
    const options: SocketIoConnectionOptions = {};

    if (Object.keys(headers).length > 0) options.extraHeaders = headers;
    if (origin) options.origin = origin;
    if (this.connectionProfile.preset !== "node" || origin) {
      options.withCredentials = true;
    }

    return options;
  }

  protected webSocketOptions(defaultUrlOrOrigin: string): {
    headers?: Record<string, string>;
    origin?: string;
  } {
    const headers = this.connectionHeaders(defaultUrlOrOrigin);
    const origin = this.connectionOrigin(defaultUrlOrOrigin);
    return {
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(origin ? { origin } : {}),
    };
  }

  protected connectionHeaders(
    defaultUrlOrOrigin: string,
    headers?: HeaderBag,
  ): Record<string, string> {
    return buildConnectionHeaders(this.connectionProfile, {
      defaultOrigin: defaultUrlOrOrigin,
      headers,
    });
  }

  protected connectionOrigin(defaultUrlOrOrigin: string): string | undefined {
    return resolveConnectionOrigin(this.connectionProfile, defaultUrlOrOrigin);
  }

  normalizeUser(_raw: Record<string, unknown>): RoomUser {
    throw this.unsupportedOperation("normalizeUser");
  }

  normalizePlayer(_raw: Record<string, unknown>): PlayerData {
    throw this.unsupportedOperation("normalizePlayer");
  }

  protected extractAppearance(raw: Record<string, unknown>): PlayerAppearance {
    return {
      color: (raw.color as number) ?? 0,
      head: (raw.head as number) ?? 0,
      face: (raw.face as number) ?? 0,
      neck: (raw.neck as number) ?? 0,
      body: (raw.body as number) ?? 0,
      hand: (raw.hand as number) ?? 0,
      feet: (raw.feet as number) ?? 0,
      flag: (raw.flag as number) ?? 0,
      photo: (raw.photo as number) ?? 0,
    };
  }

  sendMessage(_message: string): void {
    throw this.unsupportedOperation("sendMessage");
  }

  sendEmote(_emote: number): void {
    throw this.unsupportedOperation("sendEmote");
  }

  sendSafe(_safe: number): void {
    throw this.unsupportedOperation("sendSafe");
  }

  walk(_x: number, _y: number): void {
    throw this.unsupportedOperation("walk");
  }

  sendFrame(_frame: number, _set?: boolean): void {
    throw this.unsupportedOperation("sendFrame");
  }

  snowball(_x: number, _y: number): void {
    throw this.unsupportedOperation("snowball");
  }

  joinRoom(_room: number, _x?: number, _y?: number): void {
    throw this.unsupportedOperation("joinRoom");
  }

  addItem(_item: number): void {
    throw this.unsupportedOperation("addItem");
  }

  equipColor(_item: number): void {
    throw this.unsupportedOperation("equipColor");
  }

  equipHead(_item: number): void {
    throw this.unsupportedOperation("equipHead");
  }

  equipFace(_item: number): void {
    throw this.unsupportedOperation("equipFace");
  }

  equipNeck(_item: number): void {
    throw this.unsupportedOperation("equipNeck");
  }

  equipBody(_item: number): void {
    throw this.unsupportedOperation("equipBody");
  }

  equipHand(_item: number): void {
    throw this.unsupportedOperation("equipHand");
  }

  equipFeet(_item: number): void {
    throw this.unsupportedOperation("equipFeet");
  }

  equipFlag(_item: number): void {
    throw this.unsupportedOperation("equipFlag");
  }

  equipPhoto(_item: number): void {
    throw this.unsupportedOperation("equipPhoto");
  }

  buddyRequest(_id: number): void {
    throw this.unsupportedOperation("buddyRequest");
  }

  buddyAccept(_id: number): void {
    throw this.unsupportedOperation("buddyAccept");
  }

  buddyReject(_id: number): void {
    throw this.unsupportedOperation("buddyReject");
  }

  buddyRequestSeen(_id: number): void {
    throw this.unsupportedOperation("buddyRequestSeen");
  }

  getBuddy(_id: number, _type: "buddies" | "buddyRequests"): void {
    throw this.unsupportedOperation("getBuddy");
  }

  findBuddy(_id: number): void {
    throw this.unsupportedOperation("findBuddy");
  }

  removeBuddy(_id: number): void {
    throw this.unsupportedOperation("removeBuddy");
  }

  addIgnore(_id: number): void {
    throw this.unsupportedOperation("addIgnore");
  }

  removeIgnore(_id: number): void {
    throw this.unsupportedOperation("removeIgnore");
  }

  getPlayer(_id: number): void {
    throw this.unsupportedOperation("getPlayer");
  }

  getAllSlots(): void {
    throw this.unsupportedOperation("getAllSlots");
  }

  getMascots(): void {
    throw this.unsupportedOperation("getMascots");
  }

  sendPostcard(_userId: number, _cardId: string): void {
    throw this.unsupportedOperation("sendPostcard");
  }

  getStamps(_userId: number): void {
    throw this.unsupportedOperation("getStamps");
  }

  getPostcards(): void {
    throw this.unsupportedOperation("getPostcards");
  }

  getIglooOpen(_igloo: number): void {
    throw this.unsupportedOperation("getIglooOpen");
  }

  getIgloos(): void {
    throw this.unsupportedOperation("getIgloos");
  }

  getPuffles(_userId: number, _isBackyard?: boolean): void {
    throw this.unsupportedOperation("getPuffles");
  }

  getAllPuffles(): void {
    throw this.unsupportedOperation("getAllPuffles");
  }

  getPuffleWellbeing(_puffle: number): void {
    throw this.unsupportedOperation("getPuffleWellbeing");
  }

  playPuffle(_puffle: number): void {
    throw this.unsupportedOperation("playPuffle");
  }

  restPuffle(_puffle: number): void {
    throw this.unsupportedOperation("restPuffle");
  }

  buyPuffleItem(_puffleId: number, _item: number): void {
    throw this.unsupportedOperation("buyPuffleItem");
  }

  walkPuffle(_puffle: number): void {
    throw this.unsupportedOperation("walkPuffle");
  }

  initializePuffleTower(): void {
    throw this.unsupportedOperation("initializePuffleTower");
  }

  getBackyardSupplies(): void {
    throw this.unsupportedOperation("getBackyardSupplies");
  }

  adoptPuffle(_type: number, _name: string): void {
    throw this.unsupportedOperation("adoptPuffle");
  }

  getIglooLikes(): void {
    throw this.unsupportedOperation("getIglooLikes");
  }

  checkPuffleSprite(_puffleSprite: boolean): void {
    throw this.unsupportedOperation("checkPuffleSprite");
  }

  openSprite(_sprite: string): void {
    throw this.unsupportedOperation("openSprite");
  }

  equipToy(_toy: number): void {
    throw this.unsupportedOperation("equipToy");
  }

  joinIgloo(_igloo: number, _x?: number, _y?: number): void {
    throw this.unsupportedOperation("joinIgloo");
  }

  getStoreMusic(): void {
    throw this.unsupportedOperation("getStoreMusic");
  }

  buyMusic(_music: string): void {
    throw this.unsupportedOperation("buyMusic");
  }

  getIglooStoreItems(): void {
    throw this.unsupportedOperation("getIglooStoreItems");
  }

  buyFurniture(_furniture: string, _amount: number): void {
    throw this.unsupportedOperation("buyFurniture");
  }

  updateIglooMusic(_music: string): void {
    throw this.unsupportedOperation("updateIglooMusic");
  }

  updateIglooFurniture(
    _furniture: Array<{
      furnitureId: number;
      x: number;
      y: number;
      rotation: number;
      frame: number;
      depth: number;
      slot?: number;
    }>,
  ): void {
    throw this.unsupportedOperation("updateIglooFurniture");
  }

  autoUpdateIglooFurniture(
    _furniture: Array<{
      furnitureId: number;
      x: number;
      y: number;
      rotation: number;
      frame: number;
      depth: number;
      slot?: number;
    }>,
  ): void {
    throw this.unsupportedOperation("autoUpdateIglooFurniture");
  }

  updateIglooType(_type: number): void {
    throw this.unsupportedOperation("updateIglooType");
  }

  openIgloo(): void {
    throw this.unsupportedOperation("openIgloo");
  }

  closeIglooBounds(): void {
    throw this.unsupportedOperation("closeIglooBounds");
  }

  likeIgloo(): void {
    throw this.unsupportedOperation("likeIgloo");
  }

  openIglooEditor(): void {
    throw this.unsupportedOperation("openIglooEditor");
  }

  closeIglooEditor(): void {
    throw this.unsupportedOperation("closeIglooEditor");
  }

  gameOver(_coins: number): void {
    throw this.unsupportedOperation("gameOver");
  }

  collectStamp(_stamp: number): void {
    throw this.unsupportedOperation("collectStamp");
  }

  /** Fetch ninja rank, progress, and card deck. Listen for `get_ninja` event. */
  getNinja(): void {
    throw this.unsupportedOperation("getNinja");
  }

  /** Fetch state of all Dojo mats. Listen for `get_waddles` event. */
  getMats(): void {
    throw this.unsupportedOperation("getMats");
  }

  /** Join Sensei matchmaking queue. Listen for `tick_matchmaking` events. */
  joinMatchmaking(): void {
    throw this.unsupportedOperation("joinMatchmaking");
  }

  /** Leave Sensei matchmaking queue. */
  leaveMatchmaking(): void {
    throw this.unsupportedOperation("leaveMatchmaking");
  }

  /** Start a Card-Jitsu match after entering a game room. Listen for `start_game` event. */
  startGame(): void {
    throw this.unsupportedOperation("startGame");
  }

  /** Play a card from your hand by slot index. Listen for `move_my_card` event. */
  selectCard(_slot: number): void {
    throw this.unsupportedOperation("selectCard");
  }

  /** Preload a power card animation asset. */
  loadAnimation(_animation: string): void {
    throw this.unsupportedOperation("loadAnimation");
  }

  /** Sit on a Dojo mat to wait for an opponent. Listen for `update_waddle` events. */
  joinMat(_waddle: number): void {
    throw this.unsupportedOperation("joinMat");
  }
}
