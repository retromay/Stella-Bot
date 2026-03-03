import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  Message,
  MessageReaction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  User,
  TextChannel,
} from "discord.js";
import { LFP_MAX_PARTY_SIZE, LFP_JOIN_EMOJI, LFP_LEAVE_EMOJI } from "@/constants/lfp";
import { LfpParty } from "@/types/lfp";
import { saveLfpParty, deleteLfpParty, loadAllLfpParties } from "@/services/database";

// Key: messageId
const activeParties = new Map<string, LfpParty>();

export function loadLfpPartiesFromDb(): void {
  const parties = loadAllLfpParties();
  for (const party of parties) {
    activeParties.set(party.messageId, party);
  }
  console.log(`Loaded ${parties.length} LFP parties from database.`);
}

// ─── Slash Command Definition ────────────────────────────────────────────────

export const lfpCommand = new SlashCommandBuilder()
  .setName("lfp")
  .setDescription("Create a Looking For Party embed")
  .addIntegerOption((option) =>
    option
      .setName("count")
      .setDescription("Number of extra members needed")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(LFP_MAX_PARTY_SIZE - 1),
  )
  .addStringOption((option) =>
    option
      .setName("title")
      .setDescription("Party title (e.g. Grinding Stars End)")
      .setRequired(false),
  );

// ─── Embed Builders ─────────────────────────────────────────────────────────

function buildPartyTitle(party: LfpParty): string {
  const base = `${party.creatorName}'s Party`;
  const label = party.title ? `${base} — ${party.title}` : base;
  return `${label} (${party.members.length}/${party.maxSize})`;
}

function buildPartyEmbed(party: LfpParty): EmbedBuilder {
  const isFull = party.members.length >= party.maxSize;

  const slots = Array.from({ length: party.maxSize }, (_, i) => {
    const memberId = party.members[i];
    return `${i + 1}. ${memberId ? `<@${memberId}>` : "Waiting..."}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(buildPartyTitle(party))
    .setDescription(slots.join("\n"))
    .setColor(isFull ? 0x00ff00 : 0x5865f2);

  if (isFull) {
    embed.setFooter({ text: "Party is full!" });
  } else {
    embed.setFooter({ text: `${LFP_JOIN_EMOJI} Join  |  ${LFP_LEAVE_EMOJI} Leave` });
  }

  return embed;
}

function buildClosedEmbed(party: LfpParty): EmbedBuilder {
  const slots = party.members.map((id, i) => `${i + 1}. <@${id}>`);
  const base = `${party.creatorName}'s Party`;
  const label = party.title ? `${base} — ${party.title}` : base;

  return new EmbedBuilder()
    .setTitle(`${label} (Closed)`)
    .setDescription(slots.join("\n"))
    .setColor(0xed4245)
    .setFooter({ text: "This party has been closed." });
}

// ─── Shared Party Creation ──────────────────────────────────────────────────

async function createParty(
  channel: TextChannel,
  party: LfpParty,
): Promise<void> {
  const embed = buildPartyEmbed(party);
  const reply = await channel.send({ embeds: [embed] });

  party.messageId = reply.id;
  activeParties.set(reply.id, party);
  saveLfpParty(party);

  await reply.react(LFP_JOIN_EMOJI);
  await reply.react(LFP_LEAVE_EMOJI);
}

// ─── Slash Command Handler ──────────────────────────────────────────────────

export async function handleLfpSlashCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;

  const count = interaction.options.getInteger("count", true);
  const title = interaction.options.getString("title") ?? undefined;
  const member = interaction.member;

  const party: LfpParty = {
    messageId: "",
    channelId: interaction.channelId,
    guildId: interaction.guild.id,
    creatorId: interaction.user.id,
    creatorName:
      member && "displayName" in member ? member.displayName : interaction.user.username,
    members: [interaction.user.id],
    maxSize: count + 1,
    title,
  };

  await interaction.reply({ content: "Party created!", ephemeral: true });
  await createParty(interaction.channel as TextChannel, party);
}

// ─── Message Command Handler ────────────────────────────────────────────────

async function closeParty(party: LfpParty, message: Message): Promise<void> {
  activeParties.delete(party.messageId);
  deleteLfpParty(party.messageId);

  const channel = message.channel as TextChannel;
  try {
    const original = await channel.messages.fetch(party.messageId);
    const embed = buildClosedEmbed(party);
    await original.edit({ embeds: [embed] });
  } catch {
    // Original message may have been deleted
  }

  const mentions = party.members.map((id) => `<@${id}>`).join(" ");
  await channel.send(`Party closed early! ${mentions}`);
}

export async function handleLfpCommand(message: Message): Promise<boolean> {
  const content = message.content.toLowerCase();

  if (!content.startsWith("!lfp")) return false;
  if (!message.guild) return true;

  // Check if bot has permission to send messages in this channel
  const botPermissions =
    message.channel.isTextBased() && "permissionsFor" in message.channel
      ? message.channel.permissionsFor(message.guild.members.me!)
      : null;
  if (botPermissions && !botPermissions.has(PermissionFlagsBits.SendMessages)) {
    return true;
  }

  const args = message.content.split(/\s+/);

  // Handle !lfp close
  if (args[1]?.toLowerCase() === "close") {
    const party = [...activeParties.values()].find(
      (p) => p.creatorId === message.author.id && p.guildId === message.guild!.id,
    );
    if (!party) {
      await message.reply("You don't have an active party to close.");
      return true;
    }
    await closeParty(party, message);
    return true;
  }

  const count = Number.parseInt(args[1], 10);

  if (Number.isNaN(count) || count < 1 || count > LFP_MAX_PARTY_SIZE - 1) {
    await message.reply(
      `Usage: \`!LFP <1-${LFP_MAX_PARTY_SIZE - 1}> [title]\` — number of extra members needed.\nUse \`!LFP close\` to close your party early.`,
    );
    return true;
  }

  // Everything after the number is the title
  const title = args.slice(2).join(" ") || undefined;

  const party: LfpParty = {
    messageId: "",
    channelId: message.channel.id,
    guildId: message.guild.id,
    creatorId: message.author.id,
    creatorName: message.member?.displayName ?? message.author.username,
    members: [message.author.id],
    maxSize: count + 1,
    title,
  };

  await createParty(message.channel as TextChannel, party);
  return true;
}

// ─── Reaction Handlers ──────────────────────────────────────────────────────

export async function handleLfpReaction(
  reaction: MessageReaction,
  user: User,
): Promise<void> {
  const party = activeParties.get(reaction.message.id);
  if (!party) return;

  const emoji = reaction.emoji.name;

  if (emoji === LFP_JOIN_EMOJI) {
    await handleJoin(reaction, user, party);
  } else if (emoji === LFP_LEAVE_EMOJI) {
    await handleLeave(reaction, user, party);
  }
}

async function handleJoin(
  reaction: MessageReaction,
  user: User,
  party: LfpParty,
): Promise<void> {
  await reaction.users.remove(user.id);

  if (user.id === party.creatorId) return;
  if (party.members.includes(user.id)) return;
  if (party.members.length >= party.maxSize) return;

  party.members.push(user.id);
  saveLfpParty(party);

  const embed = buildPartyEmbed(party);
  await reaction.message.edit({ embeds: [embed] });

  if (party.members.length >= party.maxSize) {
    const mentions = party.members.map((id) => `<@${id}>`).join(" ");
    const channel = reaction.message.channel as TextChannel;
    await channel.send(`Party is ready! ${mentions}`);
    activeParties.delete(party.messageId);
    deleteLfpParty(party.messageId);
  }
}

async function handleLeave(
  reaction: MessageReaction,
  user: User,
  party: LfpParty,
): Promise<void> {
  await reaction.users.remove(user.id);

  if (user.id === party.creatorId) return;

  const index = party.members.indexOf(user.id);
  if (index === -1) return;

  if (party.members.length >= party.maxSize) return;

  party.members.splice(index, 1);
  saveLfpParty(party);

  const embed = buildPartyEmbed(party);
  await reaction.message.edit({ embeds: [embed] });
}
