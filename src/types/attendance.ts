export interface AttendanceRole {
  name: string;
  emoji: string;
  maxCount: number;
}

export interface AttendanceSetup {
  messageId: string;
  channelId: string;
  guildId: string;
  creatorId: string;
  totalSlots: number;
  title: string;
  roles: AttendanceRole[];
  pingRoleId: string | null;
  setupPhase: number; // 0 = first modal (roles 0-4), 1 = second modal (roles 5-6)
}

export interface RoleSignup {
  userId: string;
  displayName: string;
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
