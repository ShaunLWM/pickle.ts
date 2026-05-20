export type PlayerAppearance = {
  color: number
  hat: number
  head: number
  face: number
  face_mask: number
  neck: number
  neck_scarf: number
  body: number
  body_shirt: number
  hand: number
  hand_glove: number
  feet: number
  flag: number
  photo: number
  transform: number
}

export type PlayerSettings = {
  music_volume: number
  sfx_volume: number
  hide_penguins: boolean
  hide_chats: boolean
  hide_emotes: boolean
  hide_ui: boolean
  hide_usernames: boolean
  quality: number
  silence_notifications: boolean
  opt_out_postcards: boolean
  opt_out_buddy_requests: boolean
}

export type Buddy = {
  id: number
  username: string
  online: boolean
  favorite: boolean
  items: number[]
  onlineServer: string
}

export type RoomUser = PlayerAppearance & {
  id: number
  username: string
  displayName: string
  joinTime: string
  x: number
  y: number
  frame: number
  walking: number
  walkingPuffleType: number
  openSprite?: string
  mascotGiveaway?: unknown
  iglooOpen: number
  iglooBounds: number
  igloo_slot: number
  currentLayer: number
  fireRank: number
}

export type PlayerData = RoomUser & {
  coins: number
  partyCoins: number
  gems: number
  rank: number
  streamer: boolean
  username_verified: boolean
  email_verified: boolean
  settings: PlayerSettings
  buddies: Buddy[]
  buddyRequests: number[]
  ignores: number[]
  inventory: number[]
  puffleInventory: unknown[]
  igloos: unknown[]
  furniture: unknown[]
  flooring: unknown[]
  inf_skill_points: number
  highest_floor_reached: number
  towerMeters: number
  towerExperience: number
}

export type Mascot = {
  id: number
  name: string
  giveaway: number
  stamp: number
}
