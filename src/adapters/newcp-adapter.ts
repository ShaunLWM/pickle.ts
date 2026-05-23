import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { io, type Socket } from "socket.io-client"
import nacl from "tweetnacl"
import type { LoginOptions, LoginResult, QueueUpdate, ServerInfo, TokenLoginOptions } from "../types/adapter-types.js"
import { BaseAdapter, type ConnectOptions } from "./base-adapter.js"

const CRUMBS_URL = "https://media8.newcp.net/assets/media/crumbs/en/crumbs.json"

type WorldConfig = {
  id?: number
  host: string
  path: string
  login?: boolean
}

type CrumbsWorlds = Record<string, WorldConfig>

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

class Encryptor {
  private aesKey: Buffer | null = null
  private keypair = nacl.box.keyPair()

  get publicKey(): string {
    return Buffer.from(this.keypair.publicKey).toString("base64")
  }

  get encrypted(): boolean {
    return this.aesKey !== null
  }

  acquireKey(encryptedB64: string, serverPubKeyB64: string): string | null {
    const data = Buffer.from(encryptedB64, "base64")
    const serverPubKey = Buffer.from(serverPubKeyB64, "base64")
    const nonce = data.subarray(0, nacl.box.nonceLength)
    const ciphertext = data.subarray(nacl.box.nonceLength)
    const plaintext = nacl.box.open(
      new Uint8Array(ciphertext),
      new Uint8Array(nonce),
      new Uint8Array(serverPubKey),
      this.keypair.secretKey,
    )
    return plaintext ? new TextDecoder().decode(plaintext) : null
  }

  setKey(keyString: string): void {
    this.aesKey = Buffer.from(keyString, "utf-8")
  }

  encrypt(plaintext: string): string {
    if (!this.aesKey) throw new Error("Encryption key not set")
    const iv = randomBytes(16)
    const cipher = createCipheriv("aes-256-cbc", this.aesKey, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()])
    const result = Buffer.concat([iv, encrypted])
    return result.toString("base64")
  }

  decrypt(data: string): string {
    if (!this.aesKey) throw new Error("Encryption key not set")
    const buf = Buffer.from(data, "base64")
    const iv = buf.subarray(0, 16)
    const ciphertext = buf.subarray(16)
    const decipher = createDecipheriv("aes-256-cbc", this.aesKey, iv)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8")
  }

  encode(data: Record<string, unknown>): string {
    return this.encrypted ? this.encrypt(JSON.stringify(data)) : JSON.stringify(data)
  }

  decode(data: unknown): Record<string, unknown> {
    if (this.encrypted && typeof data === "string") {
      return JSON.parse(this.decrypt(data)) as Record<string, unknown>
    }
    return typeof data === "string" ? JSON.parse(data) as Record<string, unknown> : data as Record<string, unknown>
  }
}

function performHandshake(socket: Socket, encryptor: Encryptor): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Handshake timed out"))
    }, 10_000)

    socket.once("handshake", (encryptedKey: string, serverPubKeyB64: string) => {
      clearTimeout(timeout)
      const raw = encryptor.acquireKey(encryptedKey, serverPubKeyB64)
      if (!raw) {
        reject(new Error("Failed to decrypt handshake key"))
        return
      }

      const parsed = JSON.parse(raw) as { key: string; time?: number }
      if (parsed.time && typeof parsed.time === "number" && Math.abs(Date.now() - parsed.time) > 300_000) {
        reject(new Error("Server time desync"))
        return
      }

      encryptor.setKey(parsed.key)
      resolve()
    })

    socket.emit("handshake", encryptor.publicKey)
  })
}

/**
 * Wraps a NewCP socket to decrypt incoming messages into the
 * `{ action, args }` envelope that the Client class expects.
 */
function wrapSocket(raw: Socket, encryptor: Encryptor): Socket {
  const original = raw.on.bind(raw)

  raw.on = function (event: string, listener: (...args: unknown[]) => void) {
    if (event === "message") {
      return original(event, (msg: unknown) => {
        try {
          const decoded = encryptor.decode(msg)
          listener({ action: decoded.action, args: decoded.args ?? {} })
        } catch {
          // Skip malformed messages
        }
      })
    }
    return original(event, listener)
  } as typeof raw.on

  return raw
}

export class NewcpAdapter extends BaseAdapter {
  readonly id = "NewCP"
  private encryptor = new Encryptor()
  private worlds: CrumbsWorlds | null = null

  async login(options: LoginOptions | TokenLoginOptions): Promise<LoginResult> {
    if (!this.worlds) {
      await this.loadWorlds()
    }

    const loginWorld = Object.values(this.worlds!).find(w => w.login)
    if (!loginWorld) throw new Error("Login world not found in crumbs")

    const loginSocket = this.createSocket(loginWorld.host, loginWorld.path)
    this.encryptor = new Encryptor()

    const result = await new Promise<LoginResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        loginSocket.disconnect()
        reject(new Error("Login timed out"))
      }, 15_000)

      loginSocket.on("connect", async () => {
        try {
          await performHandshake(loginSocket, this.encryptor)

          const args = "token" in options
            ? { username: options.username, token: options.token }
            : { username: options.username, password: options.password }

          const encrypted = this.encryptor.encode({ action: "login", args })
          loginSocket.emit("message", encrypted)
        } catch (err) {
          clearTimeout(timeout)
          loginSocket.disconnect()
          reject(err)
        }
      })

      loginSocket.on("message", (msg: unknown) => {
        try {
          const decoded = this.encryptor.decode(msg)
          if (decoded.action !== "login") return

          clearTimeout(timeout)
          loginSocket.disconnect()

          const response = decoded.args as unknown as LoginResponse

          if (!response.success) {
            reject(new Error("Login failed"))
            return
          }

          const servers: ServerInfo[] = Object.entries(response.populations ?? {}).map(
            ([name, population]) => ({ name, population }),
          )

          resolve({
            servers,
            key: response.key,
            username: response.username,
            moderator: response.moderator ?? false,
            buddyWorlds: response.buddyWorlds ?? [],
          })
        } catch (err) {
          clearTimeout(timeout)
          loginSocket.disconnect()
          reject(err)
        }
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
    if (!this.worlds) {
      await this.loadWorlds()
    }

    const worldConfig = this.worlds![serverName]
    if (!worldConfig) throw new Error(`World config not found for: ${serverName}`)

    this.encryptor = new Encryptor()
    const gameSocket = this.createSocket(worldConfig.host, worldConfig.path)
    this.socket = gameSocket

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        gameSocket.disconnect()
        reject(new Error("Game connection timed out"))
      }, 15_000)

      gameSocket.on("connect", async () => {
        try {
          await performHandshake(gameSocket, this.encryptor)

          const encrypted = this.encryptor.encode({
            action: "game_auth",
            args: {
              username: loginResult.username,
              key: loginResult.key,
              createToken: false,
            },
          })
          gameSocket.emit("message", encrypted)
        } catch (err) {
          clearTimeout(timeout)
          gameSocket.disconnect()
          reject(err)
        }
      })

      gameSocket.on("message", (msg: unknown) => {
        try {
          const decoded = this.encryptor.decode(msg)

          switch (decoded.action) {
            case "wait_queue_update": {
              options?.onQueueUpdate?.(decoded.args as unknown as QueueUpdate)
              break
            }
            case "game_auth": {
              const response = decoded.args as unknown as GameAuthResponse
              if (!response.success) {
                clearTimeout(timeout)
                gameSocket.disconnect()
                reject(new Error("Game auth failed"))
                return
              }

              const joinEncrypted = this.encryptor.encode({ action: "join_server", args: {} })
              gameSocket.emit("message", joinEncrypted)
              clearTimeout(timeout)
              resolve()
              break
            }
          }
        } catch {
          // Ignore decode errors during auth phase
        }
      })

      gameSocket.on("connect_error", (err: Error) => {
        clearTimeout(timeout)
        gameSocket.disconnect()
        reject(new Error(`Game connection failed: ${err.message}`))
      })
    })

    return wrapSocket(gameSocket, this.encryptor)
  }

  send(action: string, args: Record<string, unknown>): void {
    if (!this.socket) throw new Error("Not connected")
    const encrypted = this.encryptor.encode({ action, args })
    this.socket.emit("message", encrypted)
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
  }

  private createSocket(host: string, path: string): Socket {
    return io(host, {
      path,
      transports: ["polling", "websocket"],
      reconnection: false,
    })
  }

  private async loadWorlds(): Promise<void> {
    const resp = await fetch(CRUMBS_URL)
    if (!resp.ok) throw new Error(`Failed to fetch crumbs: ${resp.status}`)
    const crumbs = await resp.json() as { worlds: CrumbsWorlds }
    this.worlds = crumbs.worlds
  }
}
