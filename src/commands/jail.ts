import { AttachmentBuilder, Message, PermissionFlagsBits } from "discord.js";
import { assets } from "@/asset";
import { JAIL_LIMIT, JAIL_WARN_INTERVAL, JAIL_EXPIRY_MS } from "@/constants/jail";
import { JailEntry } from "@/types/jail";

// Key: `guildId:userId`
const jailedUsers = new Map<string, JailEntry>();

function jailKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [key, entry] of jailedUsers) {
    if (now >= entry.expiresAt) {
      jailedUsers.delete(key);
    }
  }
}

export async function handleJailCommand(message: Message): Promise<boolean> {
  if (!message.content.toLowerCase().startsWith("!jail ")) return false;

  if (!message.guild) return true;

  const member = message.member;
  if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
    await message.reply("You need Administrator permission to use this.");
    return true;
  }

  const target = message.mentions.users.first();
  if (!target) {
    await message.reply("Usage: `!jail @user`");
    return true;
  }

  cleanupExpired();

  const key = jailKey(message.guild.id, target.id);
  if (jailedUsers.has(key)) {
    await message.reply(`${target} is already under the eyes of judgement.`);
    return true;
  }

  jailedUsers.set(key, {
    remaining: JAIL_LIMIT,
    guildId: message.guild.id,
    expiresAt: Date.now() + JAIL_EXPIRY_MS,
  });
  await message.reply(
    `${target} has been jailed! ${JAIL_LIMIT} characters remaining. Choose your words wisely.`,
  );
  return true;
}

export async function handleJailTracking(message: Message): Promise<void> {
  if (!message.guild) return;

  const key = jailKey(message.guild.id, message.author.id);
  const entry = jailedUsers.get(key);
  if (!entry) return;

  if (Date.now() >= entry.expiresAt) {
    jailedUsers.delete(key);
    return;
  }

  const previousBucket = Math.floor(entry.remaining / JAIL_WARN_INTERVAL);
  const newRemaining = entry.remaining - message.content.length;

  if (newRemaining <= 0) {
    jailedUsers.delete(key);
    const attachment = new AttachmentBuilder(assets.spongebobJail);
    await message.reply({
      content: "You are jailed now!",
      files: [attachment],
    });
    return;
  }

  entry.remaining = newRemaining;

  const currentBucket = Math.floor(newRemaining / JAIL_WARN_INTERVAL);
  if (currentBucket < previousBucket) {
    const rounded = currentBucket * JAIL_WARN_INTERVAL;
    await message.reply(`${rounded} characters remaining, be careful!`);
  }
}
