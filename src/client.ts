import { EventEmitter } from "node:events"
import { createAdapter, type AdapterName } from "./adapters/index.js"
import type { BaseAdapter, ConnectOptions } from "./adapters/base-adapter.js"
import type { LoginOptions, LoginResult, QueueUpdate, ServerInfo, TokenLoginOptions } from "./types/adapter-types.js"
import type { ServerMessages } from "./types/message-types.js"
import type { PlayerData, RoomUser } from "./types/player-types.js"

type ServerMessageHandler<K extends keyof ServerMessages> = (args: ServerMessages[K]) => void

export type LogFn = (message: string, ...args: unknown[]) => void

export type ClientOptions = {
  debug?: boolean | LogFn
}

type MessagePayload = {
  action: string
  args: Record<string, unknown>
}

function isMessagePayload(msg: unknown): msg is MessagePayload {
  return typeof msg === "object" && msg !== null && "action" in msg && "args" in msg
}

export class Client extends EventEmitter {
  player: PlayerData | null = null
  room: number | null = null
  users: Map<number, RoomUser> = new Map()
  connected = false

  private adapter: BaseAdapter
  private loginResult: LoginResult | null = null
  private log: LogFn | null = null

  constructor(server: AdapterName, options?: ClientOptions) {
    super()
    this.adapter = createAdapter(server)

    if (options?.debug) {
      this.log = typeof options.debug === "function"
        ? options.debug
        : console.log.bind(console)
    }
  }

  async login(options: LoginOptions | TokenLoginOptions): Promise<ServerInfo[]> {
    this.log?.("[login] logging in as", options.username)
    this.loginResult = await this.adapter.login(options)
    this.log?.("[login] success —", this.loginResult.servers.length, "servers")
    return this.loginResult.servers
  }

  async connect(serverName: string, options?: ConnectOptions): Promise<void> {
    if (!this.loginResult) throw new Error("Must call login() first")

    this.log?.("[connect] joining", serverName)

    const connectOptions: ConnectOptions = {
      ...options,
      onQueueUpdate: (update: QueueUpdate) => {
        this.log?.("[queue]", `#${update.position}/${update.queueLength}`)
        this.emit("wait_queue_update", update)
        options?.onQueueUpdate?.(update)
      },
    }

    const socket = await this.adapter.connect(serverName, this.loginResult, connectOptions)

    socket.on("message", (msg: unknown) => {
      if (!isMessagePayload(msg)) return
      this.handleMessage(msg)
    })

    socket.on("disconnect", () => {
      this.log?.("[disconnect] connection lost")
      this.cleanup()
      this.emit("disconnect")
    })

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Waiting for load_player timed out"))
      }, 10_000)

      let playerLoaded = false
      let roomJoined = false

      const checkReady = (): void => {
        if (playerLoaded && roomJoined) {
          clearTimeout(timeout)
          this.connected = true
          resolve()
        }
      }

      const onMessage = (msg: unknown): void => {
        if (!isMessagePayload(msg)) return
        switch (msg.action) {
          case "load_player":
            playerLoaded = true
            checkReady()
            break
          case "join_room":
            roomJoined = true
            checkReady()
            break
          case "kick":
            clearTimeout(timeout)
            socket.off("message", onMessage)
            reject(new Error(`Kicked: ${(msg.args as { reason?: string }).reason ?? "unknown"}`))
            break
          case "close_with_error":
            clearTimeout(timeout)
            socket.off("message", onMessage)
            reject(new Error(`Kicked: ${(msg.args as { error?: string }).error ?? "unknown"}`))
            break
        }
      }

      const onDisconnect = (): void => {
        if (!playerLoaded || !roomJoined) {
          clearTimeout(timeout)
          reject(new Error("Disconnected before fully loaded"))
        }
      }

      socket.on("message", onMessage)
      socket.once("disconnect", onDisconnect)
    })
  }

  on<K extends keyof ServerMessages>(event: K, listener: ServerMessageHandler<K>): this
  on(event: string, listener: (...args: unknown[]) => void): this
  on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener)
  }

  off<K extends keyof ServerMessages>(event: K, listener: ServerMessageHandler<K>): this
  off(event: string, listener: (...args: unknown[]) => void): this
  off(event: string, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener)
  }

  once<K extends keyof ServerMessages>(event: K, listener: ServerMessageHandler<K>): this
  once(event: string, listener: (...args: unknown[]) => void): this
  once(event: string, listener: (...args: unknown[]) => void): this {
    return super.once(event, listener)
  }

  emit<K extends keyof ServerMessages>(event: K, args: ServerMessages[K]): boolean
  emit(event: string, ...args: unknown[]): boolean
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args)
  }

  sendMessage(message: string): void { this.adapter.sendMessage(message) }
  sendEmote(emote: number): void { this.adapter.sendEmote(emote) }
  sendSafe(safe: number): void { this.adapter.sendSafe(safe) }
  walk(x: number, y: number): void { this.adapter.walk(x, y) }
  sendFrame(frame: number, set?: boolean): void { this.adapter.sendFrame(frame, set) }
  snowball(x: number, y: number): void { this.adapter.snowball(x, y) }
  joinRoom(room: number, x?: number, y?: number): void { this.adapter.joinRoom(room, x, y) }
  addItem(item: number): void { this.adapter.addItem(item) }
  equipColor(item: number): void { this.adapter.equipColor(item) }
  equipHead(item: number): void { this.adapter.equipHead(item) }
  equipFace(item: number): void { this.adapter.equipFace(item) }
  equipNeck(item: number): void { this.adapter.equipNeck(item) }
  equipBody(item: number): void { this.adapter.equipBody(item) }
  equipHand(item: number): void { this.adapter.equipHand(item) }
  equipFeet(item: number): void { this.adapter.equipFeet(item) }
  equipFlag(item: number): void { this.adapter.equipFlag(item) }
  equipPhoto(item: number): void { this.adapter.equipPhoto(item) }
  buddyRequest(id: number): void { this.adapter.buddyRequest(id) }
  buddyAccept(id: number): void { this.adapter.buddyAccept(id) }
  buddyReject(id: number): void { this.adapter.buddyReject(id) }
  buddyRequestSeen(id: number): void { this.adapter.buddyRequestSeen(id) }
  getBuddy(id: number, type: "buddies" | "buddyRequests"): void { this.adapter.getBuddy(id, type) }
  removeBuddy(id: number): void { this.adapter.removeBuddy(id) }
  addIgnore(id: number): void { this.adapter.addIgnore(id) }
  removeIgnore(id: number): void { this.adapter.removeIgnore(id) }
  getPlayer(id: number): void { this.adapter.getPlayer(id) }
  getAllSlots(): void { this.adapter.getAllSlots() }
  getMascots(): void { this.adapter.getMascots() }
  sendPostcard(userId: number, cardId: string): void { this.adapter.sendPostcard(userId, cardId) }
  getStamps(userId: number): void { this.adapter.getStamps(userId) }
  getPostcards(): void { this.adapter.getPostcards() }
  getIglooOpen(igloo: number): void { this.adapter.getIglooOpen(igloo) }
  joinIgloo(igloo: number, x?: number, y?: number): void { this.adapter.joinIgloo(igloo, x, y) }
  gameOver(coins: number): void { this.adapter.gameOver(coins) }
  collectStamp(stamp: number): void { this.adapter.collectStamp(stamp) }

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  disconnect(): void {
    this.log?.("[disconnect] closing connection")
    this.adapter.disconnect()
    this.cleanup()
  }

  private cleanup(): void {
    this.connected = false
    this.player = null
    this.room = null
    this.users.clear()
  }

  private handleMessage(msg: MessagePayload): void {
    const { action, args } = msg

    switch (action) {
      case "load_player": {
        const user = args.user as PlayerData
        user.coins = args.coins as number ?? 0
        user.inventory = args.inventory as number[] ?? []
        user.furniture = args.furniture as unknown[] ?? []
        user.flooring = args.flooring as unknown[] ?? []
        user.rank = args.rank as number ?? 0
        this.player = user
        this.log?.("[load_player]", user.username, `id=${user.id}`, `coins=${user.coins}`, `inventory=${user.inventory.length}`)
        break
      }
      case "join_room": {
        const room = args.room as number
        const users = args.users as RoomUser[]
        this.room = room
        this.users.clear()
        for (const user of users) {
          this.users.set(user.id, user)
        }
        this.log?.("[join_room]", `room=${room}`, `users=${users.length}`)
        break
      }
      case "add_player": {
        const user = args.user as RoomUser
        this.users.set(user.id, user)
        this.log?.("[add_player]", user.username, `id=${user.id}`)
        break
      }
      case "remove_player": {
        const id = args.user as number
        this.users.delete(id)
        this.log?.("[remove_player]", `id=${id}`)
        break
      }
      case "send_position": {
        const id = args.id as number
        const user = this.users.get(id)
        if (user) {
          user.x = args.x as number
          user.y = args.y as number
        }
        break
      }
      case "send_frame": {
        const id = args.id as number
        const user = this.users.get(id)
        if (user) {
          user.frame = args.frame as number
        }
        break
      }
      case "update_player": {
        const id = args.id as number
        const slot = args.slot as string
        const item = args.item as number
        const user = this.users.get(id)
        if (user && slot in user) {
          (user as Record<string, unknown>)[slot] = item
        }
        break
      }
      case "kick": {
        const reason = (args as { reason?: string }).reason ?? "unknown"
        this.log?.("[kick]", reason)
        this.cleanup()
        break
      }
      case "close_with_error": {
        const error = (args as { error?: string }).error ?? "unknown"
        this.log?.("[kick]", error)
        this.cleanup()
        break
      }
      default: {
        this.log?.(`[${action}]`, JSON.stringify(args))
        break
      }
    }

    this.emit(action, args)
  }
}
