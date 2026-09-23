export type ServerInfo = {
  name: string;
  population: number;
  /** CPPS.lol only: exact number of penguins online. */
  users?: number;
};

export type LoginOptions = {
  username: string;
  password: string;
  secret?: string;
};

export type TokenLoginOptions = {
  username: string;
  token: string;
  secret?: string;
};

export type LoginResult = {
  servers: ServerInfo[];
  key: string;
  username: string;
  moderator: boolean;
  buddyWorlds: string[];
  /** CPJourney: worlds where AFK kick is enforced. */
  afkServers?: string[];
};

export type QueueUpdate = {
  userId: number;
  position: number;
  queueLength: number;
};
