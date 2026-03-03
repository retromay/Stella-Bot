import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  Interaction,
  PermissionFlagsBits,
  ModalBuilder,
  ModalSubmitInteraction,
  RoleSelectMenuBuilder,
  RoleSelectMenuInteraction,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  ATTENDANCE_ROLES,
  ATTENDANCE_MIN_SLOTS,
  ATTENDANCE_MAX_SLOTS,
  ATTENDANCE_ROLE_REQUIREMENTS,
  ATT_ID,
} from "@/constants/attendance";
import type {
  AttendanceSetup,
  AttendanceSession,
  RoleSignup,
} from "@/types/attendance";
import { saveAttendanceSession, deleteAttendanceSession, loadAllAttendanceSessions } from "@/services/database";

// Discord modals support max 5 text inputs — split 7 roles into 5 + 2
const MODAL_PHASE_0_COUNT = 5;

// In-memory storage keyed by message ID
const activeSetups = new Map<string, AttendanceSetup>();
const activeSessions = new Map<string, AttendanceSession>();

export function loadAttendanceSessionsFromDb(): void {
  const sessions = loadAllAttendanceSessions();
  for (const session of sessions) {
    activeSessions.set(session.messageId, session);
  }
  console.log(`Loaded ${sessions.length} attendance sessions from database.`);
}

// ─── Slash Command Definition ────────────────────────────────────────────────

export const attendanceCommand = new SlashCommandBuilder()
  .setName("attendance")
  .setDescription("Create an attendance session")
  .addIntegerOption((option) =>
    option
      .setName("slots")
      .setDescription("Total number of attendance slots")
      .setRequired(true)
      .setMinValue(ATTENDANCE_MIN_SLOTS)
      .setMaxValue(ATTENDANCE_MAX_SLOTS)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// ─── Slash Command Handler ───────────────────────────────────────────────────

export async function handleAttendanceSlashCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guild) return;

  const count = interaction.options.getInteger("slots", true);

  const setup: AttendanceSetup = {
    messageId: "",
    channelId: interaction.channelId,
    guildId: interaction.guild.id,
    creatorId: interaction.user.id,
    totalSlots: count,
    title: "Attendance",
    roles: ATTENDANCE_ROLES.map((r) => ({
      name: r.name,
      emoji: r.emoji,
      maxCount: 0,
    })),
    pingRoleId: null,
    setupPhase: 0,
  };

  // Reply with the setup embed, then fetch the reply to get the message ID
  const embed = buildSetupEmbed(setup);
  await interaction.reply({ embeds: [embed] });
  const reply = await interaction.fetchReply();

  setup.messageId = reply.id;
  activeSetups.set(reply.id, setup);

  // Edit to add components with the correct message-scoped custom IDs
  const rows = buildSetupComponents(setup);
  await interaction.editReply({ embeds: [embed], components: rows });
}

// ─── Interaction Dispatcher ──────────────────────────────────────────────────

export async function handleAttendanceInteraction(
  interaction: Interaction
): Promise<boolean> {
  if (
    !interaction.isButton() &&
    !interaction.isStringSelectMenu() &&
    !interaction.isRoleSelectMenu() &&
    !interaction.isModalSubmit()
  ) {
    return false;
  }

  const id = interaction.customId;

  // Setup phase
  if (id.startsWith(ATT_ID.SETUP_ROLE + ":")) {
    await handleSetupRoleButton(interaction as ButtonInteraction);
    return true;
  }
  if (id.startsWith(ATT_ID.SETUP_TITLE + ":")) {
    await handleSetupTitleButton(interaction as ButtonInteraction);
    return true;
  }
  if (id.startsWith(ATT_ID.SETUP_PING + ":")) {
    await handleSetupPingSelect(interaction as RoleSelectMenuInteraction);
    return true;
  }
  if (id.startsWith(ATT_ID.SETUP_CONFIRM + ":")) {
    await handleSetupConfirm(interaction as ButtonInteraction);
    return true;
  }
  if (id.startsWith(ATT_ID.SETUP_CANCEL + ":")) {
    await handleSetupCancel(interaction as ButtonInteraction);
    return true;
  }

  // Modal submissions
  if (id.startsWith(ATT_ID.MODAL_ROLE + ":")) {
    await handleRoleModalSubmit(interaction as ModalSubmitInteraction);
    return true;
  }
  if (id.startsWith(ATT_ID.MODAL_TITLE + ":")) {
    await handleTitleModalSubmit(interaction as ModalSubmitInteraction);
    return true;
  }

  // Attendance phase
  if (id.startsWith(ATT_ID.SIGNUP + ":")) {
    await handleSignup(interaction as StringSelectMenuInteraction);
    return true;
  }
  if (id.startsWith(ATT_ID.LEAVE + ":")) {
    await handleLeave(interaction as ButtonInteraction);
    return true;
  }
  if (id.startsWith(ATT_ID.CLOSE + ":")) {
    await handleClose(interaction as ButtonInteraction);
    return true;
  }
  if (id.startsWith(ATT_ID.EDIT_ROSTER + ":")) {
    await handleEditRosterButton(interaction as ButtonInteraction);
    return true;
  }
  if (id.startsWith(ATT_ID.MODAL_EDIT_ROSTER + ":")) {
    await handleEditRosterModal(interaction as ModalSubmitInteraction);
    return true;
  }

  return false;
}

// ─── Setup: Role Counts Button → Phase-based Modal ──────────────────────────

async function handleSetupRoleButton(
  interaction: ButtonInteraction
): Promise<void> {
  const parts = interaction.customId.split(":");
  const setupMsgId = parts[1];

  const setup = activeSetups.get(setupMsgId);
  if (!setup) {
    await interaction.reply({
      content: "This setup session has expired.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== setup.creatorId) {
    await interaction.reply({
      content: "Only the creator can configure this.",
      ephemeral: true,
    });
    return;
  }

  const phase = setup.setupPhase;
  const startIdx = phase === 0 ? 0 : MODAL_PHASE_0_COUNT;
  const endIdx =
    phase === 0 ? MODAL_PHASE_0_COUNT : ATTENDANCE_ROLES.length;
  const phaseRoles = setup.roles.slice(startIdx, endIdx);

  const remaining =
    setup.totalSlots -
    setup.roles.reduce((sum, r) => sum + r.maxCount, 0);

  const modal = new ModalBuilder()
    .setCustomId(`${ATT_ID.MODAL_ROLE}:${setupMsgId}:${phase}`)
    .setTitle(
      phase === 0
        ? `Set Role Counts (Part 1/2)`
        : `Set Role Counts (Part 2/2)`
    );

  for (let i = 0; i < phaseRoles.length; i++) {
    const role = phaseRoles[i];
    const input = new TextInputBuilder()
      .setCustomId(`role_${startIdx + i}`)
      .setLabel(`${role.emoji} ${role.name} (${remaining} slots remaining)`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("0")
      .setValue(role.maxCount.toString())
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(3);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input)
    );
  }

  await interaction.showModal(modal);
}

// ─── Setup: Title Button → Modal ────────────────────────────────────────────

async function handleSetupTitleButton(
  interaction: ButtonInteraction
): Promise<void> {
  const parts = interaction.customId.split(":");
  const setupMsgId = parts[1];

  const setup = activeSetups.get(setupMsgId);
  if (!setup) {
    await interaction.reply({
      content: "This setup session has expired.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== setup.creatorId) {
    await interaction.reply({
      content: "Only the creator can configure this.",
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${ATT_ID.MODAL_TITLE}:${setupMsgId}`)
    .setTitle("Set Attendance Title");

  const input = new TextInputBuilder()
    .setCustomId("title_input")
    .setLabel("Enter a title for the attendance")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(setup.title)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(100);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input)
  );

  await interaction.showModal(modal);
}

// ─── Setup: Role Modal Submit ───────────────────────────────────────────────

async function handleRoleModalSubmit(
  interaction: ModalSubmitInteraction
): Promise<void> {
  const parts = interaction.customId.split(":");
  const setupMsgId = parts[1];
  const phase = parseInt(parts[2], 10);

  const setup = activeSetups.get(setupMsgId);
  if (!setup) {
    await interaction.reply({
      content: "This setup session has expired.",
      ephemeral: true,
    });
    return;
  }

  const startIdx = phase === 0 ? 0 : MODAL_PHASE_0_COUNT;
  const endIdx =
    phase === 0 ? MODAL_PHASE_0_COUNT : ATTENDANCE_ROLES.length;

  // Parse and validate all inputs from this modal
  const counts: number[] = [];
  const errors: string[] = [];

  for (let i = startIdx; i < endIdx; i++) {
    const raw = interaction.fields.getTextInputValue(`role_${i}`).trim();

    // Only allow pure digits (no letters, special chars, decimals, negatives)
    if (!/^\d+$/.test(raw)) {
      errors.push(`**${setup.roles[i].name}**: "${raw}" — only whole numbers are allowed.`);
      continue;
    }

    counts.push(Number.parseInt(raw, 10));
  }

  if (errors.length > 0) {
    await interaction.reply({
      content: `Invalid input:\n${errors.join("\n")}`,
      ephemeral: true,
    });
    return;
  }

  // Calculate total with the new values applied
  const otherPhasesTotal = setup.roles.reduce((sum, r, i) => {
    if (i >= startIdx && i < endIdx) return sum; // skip roles being edited
    return sum + r.maxCount;
  }, 0);
  const thisPhasesTotal = counts.reduce((sum, c) => sum + c, 0);

  if (otherPhasesTotal + thisPhasesTotal > setup.totalSlots) {
    const available = setup.totalSlots - otherPhasesTotal;
    await interaction.reply({
      content: `Total for these roles is **${thisPhasesTotal}**, but only **${available}** slots available. Please reduce the counts.`,
      ephemeral: true,
    });
    return;
  }

  // Apply the counts
  for (let i = startIdx; i < endIdx; i++) {
    setup.roles[i].maxCount = counts[i - startIdx];
  }

  // Advance to next phase (or wrap back to 0 for re-editing)
  if (phase === 0) {
    setup.setupPhase = 1;
  } else {
    setup.setupPhase = 0; // allow re-editing from the start
  }

  // Acknowledge and update the setup message
  await interaction.deferUpdate();

  const channel = interaction.channel;
  if (!channel) return;

  const setupMessage = await channel.messages.fetch(setupMsgId);
  const embed = buildSetupEmbed(setup);
  const components = buildSetupComponents(setup);
  await setupMessage.edit({ embeds: [embed], components });
}

// ─── Setup: Title Modal Submit ──────────────────────────────────────────────

async function handleTitleModalSubmit(
  interaction: ModalSubmitInteraction
): Promise<void> {
  const parts = interaction.customId.split(":");
  const setupMsgId = parts[1];

  const setup = activeSetups.get(setupMsgId);
  if (!setup) {
    await interaction.reply({
      content: "This setup session has expired.",
      ephemeral: true,
    });
    return;
  }

  setup.title = interaction.fields.getTextInputValue("title_input").trim();

  await interaction.deferUpdate();

  const channel = interaction.channel;
  if (!channel) return;

  const setupMessage = await channel.messages.fetch(setupMsgId);
  const embed = buildSetupEmbed(setup);
  await setupMessage.edit({ embeds: [embed] });
}

// ─── Setup: Ping Role Select ────────────────────────────────────────────────

async function handleSetupPingSelect(
  interaction: RoleSelectMenuInteraction
): Promise<void> {
  const parts = interaction.customId.split(":");
  const setupMsgId = parts[1];

  const setup = activeSetups.get(setupMsgId);
  if (!setup) {
    await interaction.reply({
      content: "This setup session has expired.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== setup.creatorId) {
    await interaction.reply({
      content: "Only the creator can configure this.",
      ephemeral: true,
    });
    return;
  }

  const selectedRole = interaction.roles.first();
  setup.pingRoleId = selectedRole?.id ?? null;

  const embed = buildSetupEmbed(setup);
  await interaction.update({ embeds: [embed] });
}

// ─── Setup: Confirm ─────────────────────────────────────────────────────────

async function handleSetupConfirm(
  interaction: ButtonInteraction
): Promise<void> {
  const parts = interaction.customId.split(":");
  const setupMsgId = parts[1];

  const setup = activeSetups.get(setupMsgId);
  if (!setup) {
    await interaction.reply({
      content: "This setup session has expired.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== setup.creatorId) {
    await interaction.reply({
      content: "Only the creator can confirm.",
      ephemeral: true,
    });
    return;
  }

  // Validate: slot counts must sum to totalSlots
  const assignedSlots = setup.roles.reduce((sum, r) => sum + r.maxCount, 0);
  if (assignedSlots !== setup.totalSlots) {
    await interaction.reply({
      content: `Slot counts must add up to **${setup.totalSlots}**. Currently: **${assignedSlots}** (${setup.totalSlots - assignedSlots} remaining).`,
      ephemeral: true,
    });
    return;
  }

  const session: AttendanceSession = {
    messageId: "",
    channelId: setup.channelId,
    guildId: setup.guildId,
    creatorId: setup.creatorId,
    totalSlots: setup.totalSlots,
    title: setup.title,
    roles: setup.roles,
    pingRoleId: setup.pingRoleId,
    roleQueues: setup.roles.map(() => []),
    userRoles: new Map(),
  };

  // Clean up setup
  activeSetups.delete(setupMsgId);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle("Attendance Setup Complete")
        .setDescription("The attendance session has been posted below.")
        .setColor(0x00ff00),
    ],
    components: [],
  });

  // Post the attendance embed
  const channel = interaction.channel;
  if (!channel || !("send" in channel)) return;
  const pingContent = setup.pingRoleId
    ? `<@&${setup.pingRoleId}>`
    : undefined;

  const embed = buildAttendanceEmbed(session);
  const sent = await channel.send({
    content: pingContent,
    embeds: [embed],
  });

  session.messageId = sent.id;
  activeSessions.set(sent.id, session);
  saveAttendanceSession(session);

  // Add components (need message ID for custom IDs)
  const rows = buildAttendanceComponents(session);
  await sent.edit({
    content: pingContent,
    embeds: [embed],
    components: rows,
  });
}

// ─── Setup: Cancel ──────────────────────────────────────────────────────────

async function handleSetupCancel(
  interaction: ButtonInteraction
): Promise<void> {
  const parts = interaction.customId.split(":");
  const setupMsgId = parts[1];

  const setup = activeSetups.get(setupMsgId);
  if (!setup) {
    await interaction.reply({
      content: "This setup session has expired.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== setup.creatorId) {
    await interaction.reply({
      content: "Only the creator can cancel.",
      ephemeral: true,
    });
    return;
  }

  activeSetups.delete(setupMsgId);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle("Attendance Setup Cancelled")
        .setColor(0xed4245),
    ],
    components: [],
  });
}

// ─── Attendance: Signup (Dropdown) ──────────────────────────────────────────

async function handleSignup(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const parts = interaction.customId.split(":");
  const attendanceMsgId = parts[1];

  const session = activeSessions.get(attendanceMsgId);
  if (!session) {
    await interaction.reply({
      content: "This attendance session has expired.",
      ephemeral: true,
    });
    return;
  }

  const roleIndex = parseInt(interaction.values[0], 10);
  const role = session.roles[roleIndex];
  if (!role) {
    await interaction.reply({
      content: "Invalid role selection.",
      ephemeral: true,
    });
    return;
  }

  // Role restriction check
  const member = interaction.member;
  if (member instanceof GuildMember && !hasRequiredDiscordRole(member, role.name)) {
    const reqSubstring = ATTENDANCE_ROLE_REQUIREMENTS[role.name.toLowerCase()];
    await interaction.reply({
      content: `You need a Discord role containing **"${reqSubstring}"** to sign up as **${role.name}**.`,
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;
  const displayName = getDisplayName(interaction);

  const existingRoleIndex = session.userRoles.get(userId);

  // Already in the same role
  if (existingRoleIndex === roleIndex) {
    await interaction.reply({
      content: `You are already signed up as **${role.name}**.`,
      ephemeral: true,
    });
    return;
  }

  // Remove from previous role if switching
  if (existingRoleIndex !== undefined) {
    const oldQueue = session.roleQueues[existingRoleIndex];
    const idx = oldQueue.findIndex((s) => s.userId === userId);
    if (idx !== -1) oldQueue.splice(idx, 1);
  }

  // Add to new role's queue
  const signup: RoleSignup = { userId, displayName };
  session.roleQueues[roleIndex].push(signup);
  session.userRoles.set(userId, roleIndex);
  saveAttendanceSession(session);

  const embed = buildAttendanceEmbed(session);
  await interaction.update({ embeds: [embed] });

  // Notify about role switch
  if (existingRoleIndex !== undefined) {
    const oldRoleName = session.roles[existingRoleIndex].name;
    await interaction.followUp({
      content: `You switched from **${oldRoleName}** to **${role.name}**.`,
      ephemeral: true,
    });
  }
}

// ─── Attendance: Leave ──────────────────────────────────────────────────────

async function handleLeave(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const attendanceMsgId = parts[1];

  const session = activeSessions.get(attendanceMsgId);
  if (!session) {
    await interaction.reply({
      content: "This attendance session has expired.",
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;
  const roleIndex = session.userRoles.get(userId);

  if (roleIndex === undefined) {
    await interaction.reply({
      content: "You are not signed up for this attendance.",
      ephemeral: true,
    });
    return;
  }

  // Remove from queue (auto-promotes waitlisted users via array shift)
  const queue = session.roleQueues[roleIndex];
  const idx = queue.findIndex((s) => s.userId === userId);
  if (idx !== -1) queue.splice(idx, 1);

  session.userRoles.delete(userId);
  saveAttendanceSession(session);

  const embed = buildAttendanceEmbed(session);
  await interaction.update({ embeds: [embed] });
}

// ─── Attendance: Close ──────────────────────────────────────────────────────

async function handleClose(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const attendanceMsgId = parts[1];

  const session = activeSessions.get(attendanceMsgId);
  if (!session) {
    await interaction.reply({
      content: "This attendance session has expired.",
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member;
  if (
    !member ||
    !(member instanceof GuildMember) ||
    !member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    await interaction.reply({
      content: "Only administrators can close this session.",
      ephemeral: true,
    });
    return;
  }

  activeSessions.delete(attendanceMsgId);
  deleteAttendanceSession(attendanceMsgId);

  const totalSignups = getConfirmedCount(session);
  const finalEmbed = buildAttendanceEmbed(session)
    .setTitle(
      `${session.title} (Closed) — ${totalSignups}/${session.totalSlots}`
    )
    .setColor(0xed4245)
    .setFooter({ text: "This attendance session has been closed." });

  await interaction.update({ embeds: [finalEmbed], components: [] });
}

// ─── Attendance: Edit Roster Button → Modal ─────────────────────────────────

// Tracks which sessions need a Part 2 edit (for >5 active roles)
const editRosterPendingPart2 = new Set<string>();

async function handleEditRosterButton(
  interaction: ButtonInteraction
): Promise<void> {
  const parts = interaction.customId.split(":");
  const attendanceMsgId = parts[1];

  const session = activeSessions.get(attendanceMsgId);
  if (!session) {
    await interaction.reply({
      content: "This attendance session has expired.",
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member;
  if (
    !member ||
    !(member instanceof GuildMember) ||
    !member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    await interaction.reply({
      content: "Only administrators can edit the roster.",
      ephemeral: true,
    });
    return;
  }

  const roleCount = session.roles.length;
  const needsTwoParts = roleCount > 5;

  // Determine which phase to show
  let phase: number;
  let startIdx: number;
  let endIdx: number;

  if (!needsTwoParts) {
    phase = -1; // single modal
    startIdx = 0;
    endIdx = roleCount;
  } else if (editRosterPendingPart2.has(attendanceMsgId)) {
    phase = 1; // Part 2
    startIdx = 5;
    endIdx = roleCount;
  } else {
    phase = 0; // Part 1
    startIdx = 0;
    endIdx = 5;
  }

  const currentTotal = session.roles.reduce((sum, r) => sum + r.maxCount, 0);
  const remaining = session.totalSlots - currentTotal;

  const titleBase = phase === 0
    ? "Edit Roster (1/2)"
    : phase === 1
      ? "Edit Roster (2/2)"
      : "Edit Roster";
  const title = `${titleBase} — ${remaining} remaining`;

  const modal = new ModalBuilder()
    .setCustomId(`${ATT_ID.MODAL_EDIT_ROSTER}:${attendanceMsgId}:${phase}`)
    .setTitle(title);

  for (let i = startIdx; i < endIdx; i++) {
    const role = session.roles[i];
    const input = new TextInputBuilder()
      .setCustomId(`role_${i}`)
      .setLabel(`${role.emoji} ${role.name} (currently ${role.maxCount})`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("0")
      .setValue(role.maxCount.toString())
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(3);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input)
    );
  }

  await interaction.showModal(modal);
}

// ─── Attendance: Edit Roster Modal Submit ───────────────────────────────────

async function handleEditRosterModal(
  interaction: ModalSubmitInteraction
): Promise<void> {
  const parts = interaction.customId.split(":");
  const attendanceMsgId = parts[1];
  const phase = Number.parseInt(parts[2], 10); // -1 = single, 0 = part 1, 1 = part 2

  const session = activeSessions.get(attendanceMsgId);
  if (!session) {
    await interaction.reply({
      content: "This attendance session has expired.",
      ephemeral: true,
    });
    return;
  }

  const roleCount = session.roles.length;

  const startIdx = phase === 1 ? 5 : 0;
  const endIdx = phase === 0 ? 5 : roleCount;

  // Parse and validate inputs
  const counts: number[] = [];
  const errors: string[] = [];

  for (let i = startIdx; i < endIdx; i++) {
    const raw = interaction.fields.getTextInputValue(`role_${i}`).trim();

    if (!/^\d+$/.test(raw)) {
      errors.push(`**${session.roles[i].name}**: "${raw}" — only whole numbers are allowed.`);
      continue;
    }

    counts.push(Number.parseInt(raw, 10));
  }

  if (errors.length > 0) {
    await interaction.reply({
      content: `Invalid input:\n${errors.join("\n")}`,
      ephemeral: true,
    });
    return;
  }

  if (phase === 0) {
    // Part 1 submitted — save counts, prompt admin to click Edit Roster again
    for (let i = startIdx; i < endIdx; i++) {
      session.roles[i].maxCount = counts[i - startIdx];
    }
    editRosterPendingPart2.add(attendanceMsgId);

    await interaction.deferUpdate();
    await interaction.followUp({
      content: "Part 1 saved. Click **Edit Roster** again to configure the remaining roles.",
      ephemeral: true,
    });
    return;
  }

  // Final validation: total must equal session.totalSlots
  const otherRolesTotal = session.roles.reduce((sum, r, i) => {
    if (i >= startIdx && i < endIdx) return sum;
    return sum + r.maxCount;
  }, 0);
  const theseRolesTotal = counts.reduce((sum, c) => sum + c, 0);
  const newTotal = otherRolesTotal + theseRolesTotal;

  if (newTotal !== session.totalSlots) {
    await interaction.reply({
      content: `Total slots must equal **${session.totalSlots}**. Your new counts add up to **${newTotal}**.`,
      ephemeral: true,
    });
    return;
  }

  // Apply the counts
  for (let i = startIdx; i < endIdx; i++) {
    session.roles[i].maxCount = counts[i - startIdx];
  }

  editRosterPendingPart2.delete(attendanceMsgId);
  saveAttendanceSession(session);

  // Update the attendance embed and components
  await interaction.deferUpdate();

  const channel = interaction.channel;
  if (!channel) return;

  const attendanceMessage = await channel.messages.fetch(attendanceMsgId);
  const embed = buildAttendanceEmbed(session);
  const components = buildAttendanceComponents(session);
  await attendanceMessage.edit({ embeds: [embed], components });
}

// ─── Embed Builders ─────────────────────────────────────────────────────────

function buildSetupEmbed(setup: AttendanceSetup): EmbedBuilder {
  const assignedSlots = setup.roles.reduce((sum, r) => sum + r.maxCount, 0);
  const remaining = setup.totalSlots - assignedSlots;

  const roleLines = setup.roles.map(
    (r, i) => {
      const configured = r.maxCount > 0 || (setup.setupPhase === 1 && i < MODAL_PHASE_0_COUNT);
      const marker = configured ? "\u2705 " : ""; // ✅ prefix only when configured
      return `${marker}${r.emoji} **${r.name}**: ${r.maxCount} slots`;
    }
  );

  const pingLine = setup.pingRoleId
    ? `Ping Role: <@&${setup.pingRoleId}>`
    : "Ping Role: *Not selected*";

  const phaseHint =
    setup.setupPhase === 0
      ? `Click **"Set Role Counts"** to configure roles 1-${MODAL_PHASE_0_COUNT}.`
      : `Click **"Set Role Counts"** to configure remaining roles.`;

  return new EmbedBuilder()
    .setTitle(`${setup.title} — Setup`)
    .setDescription(
      roleLines.join("\n") +
        `\n\n${pingLine}` +
        `\n\n**Total: ${assignedSlots}/${setup.totalSlots}** (${remaining} remaining)` +
        `\n\n${phaseHint}`
    )
    .setColor(assignedSlots === setup.totalSlots ? 0x00ff00 : 0xffa500);
}

function getConfirmedCount(session: AttendanceSession): number {
  return session.roleQueues.reduce(
    (sum, queue, i) => sum + Math.min(queue.length, session.roles[i].maxCount),
    0
  );
}

function buildAttendanceEmbed(session: AttendanceSession): EmbedBuilder {
  const totalSignups = getConfirmedCount(session);

  const fields: { name: string; value: string; inline: boolean }[] = [];
  for (let roleIndex = 0; roleIndex < session.roles.length; roleIndex++) {
    const role = session.roles[roleIndex];
    const queue = session.roleQueues[roleIndex];

    // Skip roles with 0 slots and no users queued
    if (role.maxCount === 0 && queue.length === 0) continue;

    const confirmed = Math.min(queue.length, role.maxCount);

    let memberList: string;
    if (queue.length === 0) {
      memberList = "*No signups yet*";
    } else {
      memberList = queue
        .map((signup, i) => {
          const num = i + 1;
          if (i < role.maxCount) {
            return `${num}. ${signup.displayName}`;
          }
          return `${num}. ~~${signup.displayName}~~`;
        })
        .join("\n");
    }

    fields.push({
      name: `${role.emoji} ${role.name} (${confirmed}/${role.maxCount})`,
      value: memberList,
      inline: true,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`${session.title} — ${totalSignups}/${session.totalSlots}`)
    .setColor(totalSignups >= session.totalSlots ? 0x00ff00 : 0x5865f2)
    .addFields(fields);

  if (totalSignups >= session.totalSlots) {
    embed.setFooter({ text: "All slots are filled!" });
  }

  return embed;
}

// ─── Component Builders ─────────────────────────────────────────────────────

function buildSetupComponents(
  setup: AttendanceSetup
): ActionRowBuilder<ButtonBuilder | RoleSelectMenuBuilder>[] {
  const setupMsgId = setup.messageId;

  const buttonLabel =
    setup.setupPhase === 0
      ? `Set Role Counts (1-${MODAL_PHASE_0_COUNT})`
      : `Set Role Counts (${MODAL_PHASE_0_COUNT + 1}-${ATTENDANCE_ROLES.length})`;

  const roleSetupRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ATT_ID.SETUP_ROLE}:${setupMsgId}`)
      .setLabel(buttonLabel)
      .setStyle(ButtonStyle.Primary)
  );

  const roleSelect =
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`${ATT_ID.SETUP_PING}:${setupMsgId}`)
        .setPlaceholder("Select a Discord role to ping")
        .setMinValues(0)
        .setMaxValues(1)
    );

  const actionButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ATT_ID.SETUP_TITLE}:${setupMsgId}`)
      .setLabel("Set Title")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${ATT_ID.SETUP_CONFIRM}:${setupMsgId}`)
      .setLabel("Confirm")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${ATT_ID.SETUP_CANCEL}:${setupMsgId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );

  return [roleSetupRow, roleSelect, actionButtons];
}

function buildAttendanceComponents(
  session: AttendanceSession
): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const options: StringSelectMenuOptionBuilder[] = [];
  for (let i = 0; i < session.roles.length; i++) {
    const role = session.roles[i];
    if (role.maxCount === 0) continue;
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(role.name)
        .setValue(i.toString())
        .setDescription(`${role.emoji} ${role.maxCount} slots`)
    );
  }

  const selectRow =
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${ATT_ID.SIGNUP}:${session.messageId}`)
        .setPlaceholder("Select a role to sign up for")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options)
    );

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ATT_ID.LEAVE}:${session.messageId}`)
      .setLabel("Leave")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${ATT_ID.EDIT_ROSTER}:${session.messageId}`)
      .setLabel("Edit Roster")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${ATT_ID.CLOSE}:${session.messageId}`)
      .setLabel("Close")
      .setStyle(ButtonStyle.Secondary)
  );

  return [selectRow, buttonRow];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hasRequiredDiscordRole(
  member: GuildMember,
  attendanceRoleName: string
): boolean {
  const requiredSubstring =
    ATTENDANCE_ROLE_REQUIREMENTS[attendanceRoleName.toLowerCase()];
  if (!requiredSubstring) return true;
  return member.roles.cache.some((role) =>
    role.name.toLowerCase().includes(requiredSubstring)
  );
}

function getDisplayName(interaction: Interaction): string {
  if (interaction.member instanceof GuildMember) {
    return interaction.member.displayName;
  }
  return (
    interaction.user?.displayName ?? interaction.user?.username ?? "Unknown"
  );
}
