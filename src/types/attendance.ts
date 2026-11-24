export interface AttendanceRole {
  name: string;
  emoji: string;
  maxCount: number;
}

export type PlayerCategory = "tank" | "melee" | "mage" | "range" | "healer";
export type DefDuty = "hwacha" | "ft" | "cannon";

export interface AttendanceSetup {
  messageId: string;
  channelId: string;
  guildId: string;
  creatorId: string;
  totalSlots: number;
  title: string;
  roles: AttendanceRole[];
  pingRoleId: string | null;
  setupPhase: number; // index of the next role-count modal part (5 roles per part)
}

export interface RoleSignup {
  userId: string;
  displayName: string;
  // Optional so sessions saved before these fields existed still load
  category?: PlayerCategory;
  className?: string;
  duty?: DefDuty; // only set for Def Team signups
}

export interface AttendanceSession {
  messageId: string;
  channelId: string;
  guildId: string;
  creatorId: string;
  totalSlots: number;
  title: string;
  roles: AttendanceRole[];
  pingRoleId: string | null;
  roleQueues: RoleSignup[][]; // roleQueues[roleIndex] = ordered array of signups
  userRoles: Map<string, number>; // userId -> roleIndex (reverse lookup)
}

/** A confirmed signup flattened for platoon building. */
export interface PlatoonPlayer {
  signup: RoleSignup;
  roleName: string;
}

export interface PlatoonResult {
  sessionMessageId: string;
  title: string;
  main: PlatoonPlayer[][]; // balanced fighting platoons
  support: PlatoonPlayer[]; // Def Team + Flex, listed unbalanced
  warnings: string[];
  ping: boolean;
}

/** Remembered per guild member so returning players sign up in one click. */
export interface PlayerProfile {
  category: PlayerCategory | null;
  className: string | null;
  defDuty: DefDuty | null;
}

export interface AttendanceTemplate {
  name: string;
  title: string;
  roles: AttendanceRole[];
  pingRoleId: string | null;
  builtIn: boolean;
}
