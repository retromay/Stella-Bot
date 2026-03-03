import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { LfpParty } from "@/types/lfp";
import type { AttendanceSession, AttendanceRole, RoleSignup } from "@/types/attendance";

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
