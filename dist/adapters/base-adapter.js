export class BaseAdapter {
    socket = null;
    sendMessage(message) {
        this.send("send_message", { message });
    }
    sendEmote(emote) {
        this.send("send_emote", { emote });
    }
    sendSafe(safe) {
        this.send("send_safe", { safe });
    }
    walk(x, y) {
        this.send("send_position", { x, y });
    }
    sendFrame(frame, set) {
        this.send("send_frame", { frame, set });
    }
    snowball(x, y) {
        this.send("snowball", { x, y });
    }
    joinRoom(room, x, y) {
        this.send("join_room", { room, x: x ?? 0, y: y ?? 0 });
    }
    addItem(item) {
        this.send("add_item", { item });
    }
    equipColor(item) {
        this.send("update_color", { item });
    }
    equipHead(item) {
        this.send("update_head", { item });
    }
    equipFace(item) {
        this.send("update_face", { item });
    }
    equipNeck(item) {
        this.send("update_neck", { item });
    }
    equipBody(item) {
        this.send("update_body", { item });
    }
    equipHand(item) {
        this.send("update_hand", { item });
    }
    equipFeet(item) {
        this.send("update_feet", { item });
    }
    equipFlag(item) {
        this.send("update_flag", { item });
    }
    equipPhoto(item) {
        this.send("update_photo", { item });
    }
    buddyRequest(id) {
        this.send("buddy_request", { id });
    }
    buddyAccept(id) {
        this.send("buddy_accept", { id });
    }
    removeBuddy(id) {
        this.send("remove_buddy", { id });
    }
    addIgnore(id) {
        this.send("add_ignore", { id });
    }
    removeIgnore(id) {
        this.send("remove_ignore", { id });
    }
    getPlayer(id) {
        this.send("get_player", { id });
    }
    getAllSlots() {
        this.send("get_all_slots", {});
    }
    getMascots() {
        this.send("get_mascots", {});
    }
}
//# sourceMappingURL=base-adapter.js.map