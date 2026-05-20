import { io, type Socket } from "socket.io-client"
import msgpackParser from "socket.io-msgpack-parser"
import type { LoginOptions, LoginResult, QueueUpdate, ServerInfo, TokenLoginOptions } from "../types/adapter-types.js"
import { BaseAdapter, type ConnectOptions } from "./base-adapter.js"

const BASE_URL = "wss://play.cpjourney.net"
const DEFAULT_SECRET = "skip"

type LoginResponse = {
  success: boolean
  username: string
  key: string
  populations: Record<string, number>
  moderator: boolean
  buddyWorlds: string[]
}

type GameAuthResponse = {
  success: boolean
  token?: string
}

type ServerMessage = {
  action: string
  args: Record<string, unknown>
}

export class CpjourneyAdapter extends BaseAdapter {
  readonly id = "CPJourney"

  async login(options: LoginOptions | TokenLoginOptions): Promise<LoginResult> {
    const loginSocket = this.createSocket("/world/login/")

    const result = await new Promise<LoginResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        loginSocket.disconnect()
        reject(new Error("Login timed out"))
      }, 10_000)

      loginSocket.on("connect", () => {
        const secret = options.secret ?? DEFAULT_SECRET
        const args = "token" in options
          ? { username: options.username, token: options.token, secret }
          : { username: options.username, password: options.password, secret }

        loginSocket.emit("message", { action: "login", args })
      })

      loginSocket.on("message", (msg: ServerMessage) => {
        if (msg.action !== "login") return

        clearTimeout(timeout)
        loginSocket.disconnect()

        const response = msg.args as LoginResponse

        if (!response.success) {
          reject(new Error("Login failed"))
          return
        }

        const servers: ServerInfo[] = Object.entries(response.populations).map(
          ([name, population]) => ({ name, population })
        )

        resolve({
          servers,
          key: response.key,
          username: response.username,
          moderator: response.moderator,
          buddyWorlds: response.buddyWorlds ?? [],
        })
      })

      loginSocket.on("connect_error", (err: Error) => {
        clearTimeout(timeout)
        loginSocket.disconnect()
        reject(new Error(`Login connection failed: ${err.message}`))
      })
    })

    return result
  }

  async connect(serverName: string, loginResult: LoginResult, options?: ConnectOptions): Promise<Socket> {
    const gameSocket = this.createSocket(`/world/${serverName.toLowerCase()}/`)
    this.socket = gameSocket

    await new Promise<void>((resolve, reject) => {
      let authSent = false

      gameSocket.on("connect", () => {
        gameSocket.emit("message", {
          action: "game_auth",
          args: {
            username: loginResult.username,
            key: loginResult.key,
            createToken: false,
            joinInvis: false,
            takeoverMascot: false,
            token: "",
          },
        })
      })

      gameSocket.on("message", (msg: ServerMessage) => {
        switch (msg.action) {
          case "wait_queue_update": {
            options?.onQueueUpdate?.(msg.args as QueueUpdate)
            break
          }
          case "game_auth": {
            if (authSent) break
            authSent = true

            const response = msg.args as GameAuthResponse
            if (!response.success) {
              gameSocket.disconnect()
              reject(new Error("Game auth failed"))
              return
            }

            gameSocket.emit("message", { action: "join_server", args: {} })
            resolve()
            break
          }
        }
      })

      gameSocket.on("connect_error", (err: Error) => {
        gameSocket.disconnect()
        reject(new Error(`Game connection failed: ${err.message}`))
      })
    })

    return gameSocket
  }

  send(action: string, args: Record<string, unknown>): void {
    if (!this.socket) throw new Error("Not connected")
    this.socket.emit("message", { action, args })
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
  }

  private createSocket(path: string): Socket {
    return io(BASE_URL, {
      path,
      parser: msgpackParser,
      transports: ["polling", "websocket"],
      reconnection: false,
    })
  }
}
