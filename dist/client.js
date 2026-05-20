import { EventEmitter } from "node:events";
import { createAdapter } from "./adapters/index.js";
function isMessagePayload(msg) {
    return typeof msg === "object" && msg !== null && "action" in msg && "args" in msg;
}
export class Client extends EventEmitter {
    player = null;
    room = null;
    users = new Map();
    adapter;
    loginResult = null;
    log = null;
    constructor(server, options) {
        super();
        this.adapter = createAdapter(server);
        if (options?.debug) {
            this.log = typeof options.debug === "function"
                ? options.debug
                : console.log.bind(console);
        }
    }
    async login(options) {
        this.log?.("[login] logging in as", options.username);
        this.loginResult = await this.adapter.login(options);
        this.log?.("[login] success —", this.loginResult.servers.length, "servers");
        return this.loginResult.servers;
    }
    async connect(serverName, options) {
        if (!this.loginResult)
            throw new Error("Must call login() first");
        this.log?.("[connect] joining", serverName);
        const connectOptions = {
            ...options,
            onQueueUpdate: (update) => {
                this.log?.("[queue]", `#${update.position}/${update.queueLength}`);
                this.emit("wait_queue_update", update);
                options?.onQueueUpdate?.(update);
            },
        };
        const socket = await this.adapter.connect(serverName, this.loginResult, connectOptions);
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Waiting for load_player timed out"));
            }, 10_000);
            let playerLoaded = false;
            let roomJoined = false;
            const checkReady = () => {
                if (playerLoaded && roomJoined) {
                    clearTimeout(timeout);
                    resolve();
                }
            };
            socket.on("message", (msg) => {
                if (!isMessagePayload(msg))
                    return;
                this.handleMessage(msg);
                switch (msg.action) {
                    case "load_player":
                        playerLoaded = true;
                        checkReady();
                        break;
                    case "join_room":
                        roomJoined = true;
                        checkReady();
                        break;
                }
            });
            socket.on("disconnect", () => {
                clearTimeout(timeout);
                if (!playerLoaded || !roomJoined) {
                    reject(new Error("Disconnected before fully loaded"));
                }
                this.emit("disconnect");
            });
        });
    }
    on(event, listener) {
        return super.on(event, listener);
    }
    off(event, listener) {
        return super.off(event, listener);
    }
    once(event, listener) {
        return super.once(event, listener);
    }
    emit(event, ...args) {
        return super.emit(event, ...args);
    }
    sendMessage(message) { this.adapter.sendMessage(message); }
    sendEmote(emote) { this.adapter.sendEmote(emote); }
    sendSafe(safe) { this.adapter.sendSafe(safe); }
    walk(x, y) { this.adapter.walk(x, y); }
    sendFrame(frame, set) { this.adapter.sendFrame(frame, set); }
    snowball(x, y) { this.adapter.snowball(x, y); }
    joinRoom(room, x, y) { this.adapter.joinRoom(room, x, y); }
    addItem(item) { this.adapter.addItem(item); }
    equipColor(item) { this.adapter.equipColor(item); }
    equipHead(item) { this.adapter.equipHead(item); }
    equipFace(item) { this.adapter.equipFace(item); }
    equipNeck(item) { this.adapter.equipNeck(item); }
    equipBody(item) { this.adapter.equipBody(item); }
    equipHand(item) { this.adapter.equipHand(item); }
    equipFeet(item) { this.adapter.equipFeet(item); }
    equipFlag(item) { this.adapter.equipFlag(item); }
    equipPhoto(item) { this.adapter.equipPhoto(item); }
    buddyRequest(id) { this.adapter.buddyRequest(id); }
    buddyAccept(id) { this.adapter.buddyAccept(id); }
    removeBuddy(id) { this.adapter.removeBuddy(id); }
    addIgnore(id) { this.adapter.addIgnore(id); }
    removeIgnore(id) { this.adapter.removeIgnore(id); }
    getPlayer(id) { this.adapter.getPlayer(id); }
    getAllSlots() { this.adapter.getAllSlots(); }
    getMascots() { this.adapter.getMascots(); }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    disconnect() {
        this.log?.("[disconnect] closing connection");
        this.adapter.disconnect();
        this.player = null;
        this.room = null;
        this.users.clear();
    }
    handleMessage(msg) {
        const { action, args } = msg;
        switch (action) {
            case "load_player": {
                const user = args.user;
                this.player = user;
                this.log?.("[load_player]", user.username, `id=${user.id}`);
                break;
            }
            case "join_room": {
                const room = args.room;
                const users = args.users;
                this.room = room;
                this.users.clear();
                for (const user of users) {
                    this.users.set(user.id, user);
                }
                this.log?.("[join_room]", `room=${room}`, `users=${users.length}`);
                break;
            }
            case "add_player": {
                const user = args.user;
                this.users.set(user.id, user);
                this.log?.("[add_player]", user.username, `id=${user.id}`);
                break;
            }
            case "remove_player": {
                const id = args.user;
                this.users.delete(id);
                this.log?.("[remove_player]", `id=${id}`);
                break;
            }
            case "send_position": {
                const id = args.id;
                const user = this.users.get(id);
                if (user) {
                    user.x = args.x;
                    user.y = args.y;
                }
                break;
            }
            case "send_frame": {
                const id = args.id;
                const user = this.users.get(id);
                if (user) {
                    user.frame = args.frame;
                }
                break;
            }
            case "update_player": {
                const id = args.id;
                const slot = args.slot;
                const item = args.item;
                const user = this.users.get(id);
                if (user && slot in user) {
                    user[slot] = item;
                }
                break;
            }
            default: {
                this.log?.(`[${action}]`, JSON.stringify(args));
                break;
            }
        }
        this.emit(action, args);
    }
}
//# sourceMappingURL=client.js.map