import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { LfpParty } from "@/types/lfp";
import type {
  AttendanceSession,
  AttendanceRole,
  AttendanceTemplate,
  DefDuty,
  PlayerCategory,
  PlayerProfile,
  RoleSignup,
} from "@/types/attendance";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "stella.db");

let db: Database.Database;

// ─── Initialization ──────────────────────────────────────────────────────────

export function initDatabase(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS lfp_parties (
      message_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      creator_name TEXT NOT NULL,
      members TEXT NOT NULL,
      max_size INTEGER NOT NULL,
      title TEXT
    );

    CREATE TABLE IF NOT EXISTS attendance_sessions (
      message_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      total_slots INTEGER NOT NULL,
      title TEXT NOT NULL,
      roles TEXT NOT NULL,
      ping_role_id TEXT,
      role_queues TEXT NOT NULL,
      user_roles TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS player_profiles (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      category TEXT,
      class_name TEXT,
      def_duty TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS attendance_templates (
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE,
      title TEXT NOT NULL,
      roles TEXT NOT NULL,
      ping_role_id TEXT,
      created_by TEXT NOT NULL,
      PRIMARY KEY (guild_id, name)
    );

    CREATE TABLE IF NOT EXISTS attendance_history (
      message_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      title TEXT NOT NULL,
      closed_at INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role_name TEXT NOT NULL,
      category TEXT,
      class_name TEXT,
      def_duty TEXT,
      confirmed INTEGER NOT NULL
    );
  `);

  console.log("Database initialized.");
}

// ─── LFP Parties ─────────────────────────────────────────────────────────────

const lfpInsert = () =>
  db.prepare(`
    INSERT OR REPLACE INTO lfp_parties
      (message_id, channel_id, guild_id, creator_id, creator_name, members, max_size, title)
    VALUES
      (@message_id, @channel_id, @guild_id, @creator_id, @creator_name, @members, @max_size, @title)
  `);

const lfpDelete = () =>
  db.prepare("DELETE FROM lfp_parties WHERE message_id = ?");

const lfpSelectAll = () =>
  db.prepare("SELECT * FROM lfp_parties");

export function saveLfpParty(party: LfpParty): void {
  lfpInsert().run({
    message_id: party.messageId,
    channel_id: party.channelId,
    guild_id: party.guildId,
    creator_id: party.creatorId,
    creator_name: party.creatorName,
    members: JSON.stringify(party.members),
    max_size: party.maxSize,
    title: party.title ?? null,
  });
}

export function deleteLfpParty(messageId: string): void {
  lfpDelete().run(messageId);
}

export function loadAllLfpParties(): LfpParty[] {
  const rows = lfpSelectAll().all() as {
    message_id: string;
    channel_id: string;
    guild_id: string;
    creator_id: string;
    creator_name: string;
    members: string;
    max_size: number;
    title: string | null;
  }[];

  return rows.map((row) => ({
    messageId: row.message_id,
    channelId: row.channel_id,
    guildId: row.guild_id,
    creatorId: row.creator_id,
    creatorName: row.creator_name,
    members: JSON.parse(row.members),
    maxSize: row.max_size,
    title: row.title ?? undefined,
  }));
}

// ─── Attendance Sessions ─────────────────────────────────────────────────────

const attInsert = () =>
  db.prepare(`
    INSERT OR REPLACE INTO attendance_sessions
      (message_id, channel_id, guild_id, creator_id, total_slots, title, roles, ping_role_id, role_queues, user_roles)
    VALUES
      (@message_id, @channel_id, @guild_id, @creator_id, @total_slots, @title, @roles, @ping_role_id, @role_queues, @user_roles)
  `);

const attDelete = () =>
  db.prepare("DELETE FROM attendance_sessions WHERE message_id = ?");

const attSelectAll = () =>
  db.prepare("SELECT * FROM attendance_sessions");

function serializeUserRoles(userRoles: Map<string, number>): string {
  return JSON.stringify(Object.fromEntries(userRoles));
}

function deserializeUserRoles(json: string): Map<string, number> {
  const obj = JSON.parse(json) as Record<string, number>;
  return new Map(Object.entries(obj));
}

export function saveAttendanceSession(session: AttendanceSession): void {
  attInsert().run({
    message_id: session.messageId,
    channel_id: session.channelId,
    guild_id: session.guildId,
    creator_id: session.creatorId,
    total_slots: session.totalSlots,
    title: session.title,
    roles: JSON.stringify(session.roles),
    ping_role_id: session.pingRoleId ?? null,
    role_queues: JSON.stringify(session.roleQueues),
    user_roles: serializeUserRoles(session.userRoles),
  });
}

export function deleteAttendanceSession(messageId: string): void {
  attDelete().run(messageId);
}

export function loadAllAttendanceSessions(): AttendanceSession[] {
  const rows = attSelectAll().all() as {
    message_id: string;
    channel_id: string;
    guild_id: string;
    creator_id: string;
    total_slots: number;
    title: string;
    roles: string;
    ping_role_id: string | null;
    role_queues: string;
    user_roles: string;
  }[];

  return rows.map((row) => ({
    messageId: row.message_id,
    channelId: row.channel_id,
    guildId: row.guild_id,
    creatorId: row.creator_id,
    totalSlots: row.total_slots,
    title: row.title,
    roles: JSON.parse(row.roles) as AttendanceRole[],
    pingRoleId: row.ping_role_id,
    roleQueues: JSON.parse(row.role_queues) as RoleSignup[][],
    userRoles: deserializeUserRoles(row.user_roles),
  }));
}

// ─── Player Profiles ─────────────────────────────────────────────────────────

export function getPlayerProfile(guildId: string, userId: string): PlayerProfile | null {
  const row = db
    .prepare("SELECT category, class_name, def_duty FROM player_profiles WHERE guild_id = ? AND user_id = ?")
    .get(guildId, userId) as
    | { category: string | null; class_name: string | null; def_duty: string | null }
    | undefined;

  if (!row) return null;
  return {
    category: row.category as PlayerCategory | null,
    className: row.class_name,
    defDuty: row.def_duty as DefDuty | null,
  };
}

export function savePlayerProfile(guildId: string, userId: string, profile: PlayerProfile): void {
  db.prepare(`
    INSERT OR REPLACE INTO player_profiles
      (guild_id, user_id, category, class_name, def_duty, updated_at)
    VALUES
      (@guild_id, @user_id, @category, @class_name, @def_duty, @updated_at)
  `).run({
    guild_id: guildId,
    user_id: userId,
    category: profile.category,
    class_name: profile.className,
    def_duty: profile.defDuty,
    updated_at: Date.now(),
  });
}

// ─── Attendance Templates ────────────────────────────────────────────────────

export function loadAttendanceTemplates(guildId: string): AttendanceTemplate[] {
  const rows = db
    .prepare("SELECT name, title, roles, ping_role_id FROM attendance_templates WHERE guild_id = ?")
    .all(guildId) as { name: string; title: string; roles: string; ping_role_id: string | null }[];

  return rows.map((row) => ({
    name: row.name,
    title: row.title,
    roles: JSON.parse(row.roles) as AttendanceRole[],
    pingRoleId: row.ping_role_id,
    builtIn: false,
  }));
}

export function saveAttendanceTemplate(
  guildId: string,
  createdBy: string,
  template: AttendanceTemplate
): void {
  db.prepare(`
    INSERT OR REPLACE INTO attendance_templates
      (guild_id, name, title, roles, ping_role_id, created_by)
    VALUES
      (@guild_id, @name, @title, @roles, @ping_role_id, @created_by)
  `).run({
    guild_id: guildId,
    name: template.name,
    title: template.title,
    roles: JSON.stringify(template.roles),
    ping_role_id: template.pingRoleId,
    created_by: createdBy,
  });
}

/** Returns true if a template was deleted. */
export function deleteAttendanceTemplate(guildId: string, name: string): boolean {
  const result = db
    .prepare("DELETE FROM attendance_templates WHERE guild_id = ? AND name = ?")
    .run(guildId, name);
  return result.changes > 0;
}

// ─── Attendance History ──────────────────────────────────────────────────────

export function writeAttendanceHistory(session: AttendanceSession, closedAt: number): void {
  const insert = db.prepare(`
    INSERT INTO attendance_history
      (message_id, guild_id, title, closed_at, user_id, display_name, role_name, category, class_name, def_duty, confirmed)
    VALUES
      (@message_id, @guild_id, @title, @closed_at, @user_id, @display_name, @role_name, @category, @class_name, @def_duty, @confirmed)
  `);

  const writeAll = db.transaction(() => {
    session.roleQueues.forEach((queue, roleIndex) => {
      const role = session.roles[roleIndex];
      queue.forEach((signup, i) => {
        insert.run({
          message_id: session.messageId,
          guild_id: session.guildId,
          title: session.title,
          closed_at: closedAt,
          user_id: signup.userId,
          display_name: signup.displayName,
          role_name: role.name,
          category: signup.category ?? null,
          class_name: signup.className ?? null,
          def_duty: signup.duty ?? null,
          confirmed: i < role.maxCount ? 1 : 0,
        });
      });
    });
  });

  writeAll();
}
