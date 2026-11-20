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
  SendableChannels,
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
  ATT_ID,
  BDO_CLASSES,
  CLASS_SELECT_SPLIT,
  DEF_DUTIES,
  DEF_TEAM_ROLE_NAME,
  PLAYER_CATEGORIES,
  UNSET_EMOJI,
} from "@/constants/attendance";
import type {
  AttendanceRole,
  AttendanceSetup,
  AttendanceSession,
  DefDuty,
  PlayerCategory,
  PlayerProfile,
  RoleSignup,
} from "@/types/attendance";
import {
  saveAttendanceSession,
  deleteAttendanceSession,
  loadAllAttendanceSessions,
  getPlayerProfile,
  savePlayerProfile,
  saveAttendanceTemplate,
  writeAttendanceHistory,
} from "@/services/database";
import { findTemplate } from "@/commands/attendanceTemplate";

// Discord modals support max 5 text inputs — split roles into parts of 5
const ROLES_PER_MODAL = 5;
const FIELD_VALUE_LIMIT = 1024;

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
  .addStringOption((option) =>
    option
      .setName("template")
      .setDescription("Post instantly from a template (e.g. T2 50-man)")
      .setAutocomplete(true)
  )
  .addIntegerOption((option) =>
    option
      .setName("slots")
      .setDescription("Total number of attendance slots (manual setup)")
      .setMinValue(ATTENDANCE_MIN_SLOTS)
      .setMaxValue(ATTENDANCE_MAX_SLOTS)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// ─── Slash Command Handler ───────────────────────────────────────────────────

export async function handleAttendanceSlashCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guild) return;

  const templateName = interaction.options.getString("template");
  if (templateName) {
    await postFromTemplate(interaction, templateName);
    return;
  }

  const count = interaction.options.getInteger("slots");
  if (count === null) {
    await interaction.reply({
      content: "Pick a `template` to post instantly, or give `slots` for manual setup.",
      ephemeral: true,
    });
    return;
  }

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

async function postFromTemplate(
  interaction: ChatInputCommandInteraction,
  templateName: string
): Promise<void> {
  if (!interaction.guild) return;

  const template = findTemplate(interaction.guild.id, templateName);
  if (!template) {
    await interaction.reply({
      content: `No template named **${templateName}**. See \`/attendance-template list\`.`,
      ephemeral: true,
    });
    return;
  }

  const channel = interaction.channel;
  if (!channel?.isSendable()) {
    await interaction.reply({
      content: "I can't post in this channel.",
      ephemeral: true,
    });
    return;
  }

  const roles = template.roles.map((r) => ({ ...r }));
  const totalSlots = roles.reduce((sum, r) => sum + r.maxCount, 0);

  const session: AttendanceSession = {
    messageId: "",
    channelId: interaction.channelId,
    guildId: interaction.guild.id,
    creatorId: interaction.user.id,
    totalSlots,
    title: template.title,
    roles,
    pingRoleId: template.pingRoleId,
    roleQueues: roles.map(() => []),
    userRoles: new Map(),
  };

  await interaction.reply({
    content: `Posting **${template.name}** (${totalSlots} slots).`,
    ephemeral: true,
  });
  await postAttendanceSession(channel, session);
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
  if (id.startsWith(ATT_ID.SETUP_SAVE_TPL + ":")) {
    await handleSetupSaveTemplateButton(interaction as ButtonInteraction);
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
  if (id.startsWith(ATT_ID.MODAL_SAVE_TPL + ":")) {
    await handleSaveTemplateModal(interaction as ModalSubmitInteraction);
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

  // Player details (category / class / def duty)
  if (id.startsWith(ATT_ID.DETAILS + ":")) {
    await handleDetailsButton(interaction as ButtonInteraction);
    return true;
  }
  if (
    id.startsWith(ATT_ID.CATEGORY + ":") ||
    id.startsWith(ATT_ID.CLASS_A + ":") ||
    id.startsWith(ATT_ID.CLASS_B + ":") ||
    id.startsWith(ATT_ID.DUTY + ":")
  ) {
    await handleDetailsSelect(interaction as StringSelectMenuInteraction);
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
  const partCount = getModalPartCount(setup.roles.length);
  const [startIdx, endIdx] = getModalPartRange(phase, setup.roles.length);
  const phaseRoles = setup.roles.slice(startIdx, endIdx);

  const remaining =
    setup.totalSlots -
    setup.roles.reduce((sum, r) => sum + r.maxCount, 0);

  const modal = new ModalBuilder()
    .setCustomId(`${ATT_ID.MODAL_ROLE}:${setupMsgId}:${phase}`)
    .setTitle(
      partCount > 1
        ? `Set Role Counts (Part ${phase + 1}/${partCount})`
        : "Set Role Counts"
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

  const [startIdx, endIdx] = getModalPartRange(phase, setup.roles.length);

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

  // Advance to next part (or wrap back to 0 for re-editing)
  setup.setupPhase = (phase + 1) % getModalPartCount(setup.roles.length);

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

// ─── Setup: Save as Template Button → Modal ─────────────────────────────────

async function handleSetupSaveTemplateButton(
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
      content: "Only the creator can save this as a template.",
      ephemeral: true,
    });
    return;
  }

  const assignedSlots = setup.roles.reduce((sum, r) => sum + r.maxCount, 0);
  if (assignedSlots !== setup.totalSlots) {
    await interaction.reply({
      content: `Set role counts that add up to **${setup.totalSlots}** before saving. Currently: **${assignedSlots}**.`,
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${ATT_ID.MODAL_SAVE_TPL}:${setupMsgId}`)
    .setTitle("Save as Template");

  const input = new TextInputBuilder()
    .setCustomId("template_name")
    .setLabel("Template name (same name overwrites)")
    .setStyle(TextInputStyle.Short)
    .setValue(setup.title.slice(0, 50))
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(50);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input)
  );

  await interaction.showModal(modal);
}

async function handleSaveTemplateModal(
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

  const name = interaction.fields.getTextInputValue("template_name").trim();
  if (!name) {
    await interaction.reply({
      content: "Template name can't be empty.",
      ephemeral: true,
    });
    return;
  }

  saveAttendanceTemplate(setup.guildId, interaction.user.id, {
    name,
    title: setup.title,
    roles: setup.roles.map((r) => ({ ...r })),
    pingRoleId: setup.pingRoleId,
    builtIn: false,
  });

  await interaction.reply({
    content: `Saved template **${name}**. Post it anytime with \`/attendance template:${name}\`.`,
    ephemeral: true,
  });
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

  const channel = interaction.channel;
  if (!channel?.isSendable()) return;
  await postAttendanceSession(channel, session);
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

// ─── Post Attendance Session ────────────────────────────────────────────────

async function postAttendanceSession(
  channel: SendableChannels,
  session: AttendanceSession
): Promise<void> {
  const pingContent = session.pingRoleId
    ? `<@&${session.pingRoleId}>`
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

  const userId = interaction.user.id;
  const displayName = getDisplayName(interaction);

  const existingRoleIndex = session.userRoles.get(userId);

  // Already in the same role
  if (existingRoleIndex === roleIndex) {
    await interaction.reply({
      content: `You are already signed up as **${role.name}**. Use **My Details** to change your class or duty.`,
      ephemeral: true,
    });
    return;
  }

  // Remove from previous role if switching (keep their details)
  let previous: RoleSignup | undefined;
  if (existingRoleIndex !== undefined) {
    const oldQueue = session.roleQueues[existingRoleIndex];
    const idx = oldQueue.findIndex((s) => s.userId === userId);
    if (idx !== -1) previous = oldQueue.splice(idx, 1)[0];
  }

  // Fill details from this session first, then from the remembered profile
  const profile = getPlayerProfile(session.guildId, userId);
  const signup: RoleSignup = {
    userId,
    displayName,
    category: previous?.category ?? profile?.category ?? undefined,
    className: previous?.className ?? profile?.className ?? undefined,
  };
  if (isDefRole(role)) {
    signup.duty = previous?.duty ?? profile?.defDuty ?? undefined;
  }

  // Add to new role's queue
  session.roleQueues[roleIndex].push(signup);
  session.userRoles.set(userId, roleIndex);
  saveAttendanceSession(session);

  const embed = buildAttendanceEmbed(session);
  await interaction.update({ embeds: [embed] });

  const notes: string[] = [];
  if (existingRoleIndex !== undefined) {
    const oldRoleName = session.roles[existingRoleIndex].name;
    notes.push(`You switched from **${oldRoleName}** to **${role.name}**.`);
  }

  // Only ask for details that are still missing — returning players are done in one click
  if (needsDetails(signup, role)) {
    const panel = buildDetailsPanel(session, signup, roleIndex);
    await interaction.followUp({
      content: [...notes, panel.content].join("\n\n"),
      components: panel.components,
      ephemeral: true,
    });
  } else if (notes.length > 0) {
    await interaction.followUp({
      content: notes.join("\n"),
      ephemeral: true,
    });
  }
}

// ─── Attendance: My Details Button → Ephemeral Panel ────────────────────────

async function handleDetailsButton(
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

  const found = findSignup(session, interaction.user.id);
  if (!found) {
    await interaction.reply({
      content: "Sign up for a role first, then set your details.",
      ephemeral: true,
    });
    return;
  }

  const panel = buildDetailsPanel(session, found.signup, found.roleIndex);
  await interaction.reply({ ...panel, ephemeral: true });
}

// ─── Attendance: Category / Class / Duty Selects ────────────────────────────

async function handleDetailsSelect(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const parts = interaction.customId.split(":");
  const prefix = parts[0];
  const attendanceMsgId = parts[1];

  const session = activeSessions.get(attendanceMsgId);
  if (!session) {
    await interaction.update({
      content: "This attendance session has expired.",
      components: [],
    });
    return;
  }

  const found = findSignup(session, interaction.user.id);
  if (!found) {
    await interaction.update({
      content: "You are no longer signed up for this attendance.",
      components: [],
    });
    return;
  }

  const { signup, roleIndex } = found;
  const value = interaction.values[0];
  const profilePatch: Partial<PlayerProfile> = {};

  if (prefix === ATT_ID.CATEGORY) {
    if (!PLAYER_CATEGORIES.some((c) => c.key === value)) return;
    signup.category = value as PlayerCategory;
    profilePatch.category = signup.category;
  } else if (prefix === ATT_ID.DUTY) {
    if (value !== "none" && !DEF_DUTIES.some((d) => d.key === value)) return;
    signup.duty = value === "none" ? undefined : (value as DefDuty);
    profilePatch.defDuty = signup.duty ?? null;
  } else {
    if (!(BDO_CLASSES as readonly string[]).includes(value)) return;
    signup.className = value;
    profilePatch.className = signup.className;
  }

  saveAttendanceSession(session);

  // Remember for next time
  const current = getPlayerProfile(session.guildId, signup.userId) ?? {
    category: null,
    className: null,
    defDuty: null,
  };
  savePlayerProfile(session.guildId, signup.userId, { ...current, ...profilePatch });

  await interaction.update(buildDetailsPanel(session, signup, roleIndex));

  // Refresh the public attendance embed
  const channel = interaction.channel;
  if (!channel) return;
  const attendanceMessage = await channel.messages.fetch(attendanceMsgId);
  await attendanceMessage.edit({ embeds: [buildAttendanceEmbed(session)] });
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

  // History is a nice-to-have — never block closing on it
  try {
    writeAttendanceHistory(session, Date.now());
  } catch (error) {
    console.error("[Attendance History Error]", error);
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
      const configured = r.maxCount > 0 || i < setup.setupPhase * ROLES_PER_MODAL;
      const marker = configured ? "✅ " : ""; // ✅ prefix only when configured
      return `${marker}${r.emoji} **${r.name}**: ${r.maxCount} slots`;
    }
  );

  const pingLine = setup.pingRoleId
    ? `Ping Role: <@&${setup.pingRoleId}>`
    : "Ping Role: *Not selected*";

  const [startIdx, endIdx] = getModalPartRange(setup.setupPhase, setup.roles.length);
  const phaseHint = `Click **"Set Role Counts"** to configure roles ${startIdx + 1}-${endIdx}.`;

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

function buildCompositionLine(session: AttendanceSession): string | null {
  const counts = new Map<string, number>();
  let unset = 0;
  let total = 0;

  session.roleQueues.forEach((queue, roleIndex) => {
    for (const signup of queue.slice(0, session.roles[roleIndex].maxCount)) {
      total++;
      if (signup.category) {
        counts.set(signup.category, (counts.get(signup.category) ?? 0) + 1);
      } else {
        unset++;
      }
    }
  });

  if (total === 0) return null;

  const parts: string[] = PLAYER_CATEGORIES.map(
    (c) => `${c.emoji} ${c.name} **${counts.get(c.key) ?? 0}**`
  );
  if (unset > 0) parts.push(`${UNSET_EMOJI} Unset **${unset}**`);
  return parts.join(" · ");
}

// "🔮 [Witch] name", or "🔥 [Striker] name" (duty icon) for Def Team
function formatSignupLine(
  signup: RoleSignup,
  confirmed: boolean,
  isDef: boolean
): string {
  const icon = isDef
    ? getDutyEmoji(signup.duty)
    : PLAYER_CATEGORIES.find((c) => c.key === signup.category)?.emoji ?? UNSET_EMOJI;
  const name = confirmed ? signup.displayName : `~~${signup.displayName}~~`;
  const className = signup.className ? `[${signup.className}]` : undefined;
  return [icon, className, name].filter(Boolean).join(" ");
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
    const isDef = isDefRole(role);

    const memberList =
      queue.length === 0
        ? "*No signups yet*"
        : fitFieldValue(
            queue.map((signup, i) =>
              formatSignupLine(signup, i < role.maxCount, isDef)
            )
          );

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

  const composition = buildCompositionLine(session);
  if (composition) embed.setDescription(composition);

  if (totalSignups >= session.totalSlots) {
    embed.setFooter({ text: "All slots are filled!" });
  }

  return embed;
}

/** Embed field values are capped at 1024 chars — truncate long rosters. */
function fitFieldValue(lines: string[]): string {
  let value = "";
  for (let i = 0; i < lines.length; i++) {
    const next = value ? `${value}\n${lines[i]}` : lines[i];
    const reserve = i < lines.length - 1 ? 24 : 0; // room for the "…and N more" line
    if (next.length + reserve > FIELD_VALUE_LIMIT) {
      return `${value}\n…and ${lines.length - i} more`;
    }
    value = next;
  }
  return value;
}

// ─── Component Builders ─────────────────────────────────────────────────────

function buildSetupComponents(
  setup: AttendanceSetup
): ActionRowBuilder<ButtonBuilder | RoleSelectMenuBuilder>[] {
  const setupMsgId = setup.messageId;

  const [startIdx, endIdx] = getModalPartRange(setup.setupPhase, setup.roles.length);
  const buttonLabel = `Set Role Counts (${startIdx + 1}-${endIdx})`;

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
      .setCustomId(`${ATT_ID.SETUP_SAVE_TPL}:${setupMsgId}`)
      .setLabel("Save as Template")
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
      .setCustomId(`${ATT_ID.DETAILS}:${session.messageId}`)
      .setLabel("My Details")
      .setStyle(ButtonStyle.Success),
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

function buildDetailsPanel(
  session: AttendanceSession,
  signup: RoleSignup,
  roleIndex: number
): { content: string; components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const role = session.roles[roleIndex];
  const isDef = isDefRole(role);
  const msgId = session.messageId;

  const category = PLAYER_CATEGORIES.find((c) => c.key === signup.category);
  const summary = [
    `Category: ${category ? `${category.emoji} ${category.name}` : `${UNSET_EMOJI} not set`}`,
    `Class: ${signup.className ?? `${UNSET_EMOJI} not set`}`,
  ];
  if (isDef) {
    const duty = DEF_DUTIES.find((d) => d.key === signup.duty);
    summary.push(`Duty: ${duty ? `${duty.emoji} ${duty.name}` : `${UNSET_EMOJI} undecided`}`);
  }

  const content =
    `**Your details** for **${session.title}** — ${role.emoji} ${role.name}\n` +
    summary.join(" · ") +
    `\n-# Saved for next time. Change anytime with **My Details**.`;

  const categorySelect = new StringSelectMenuBuilder()
    .setCustomId(`${ATT_ID.CATEGORY}:${msgId}`)
    .setPlaceholder("What are you playing? (Tank / Melee / Mage / Range)")
    .addOptions(
      PLAYER_CATEGORIES.map((c) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(c.name)
          .setValue(c.key)
          .setEmoji(c.emoji)
          .setDefault(signup.category === c.key)
      )
    );

  const classSelect = (customIdPrefix: string, classes: readonly string[]) =>
    new StringSelectMenuBuilder()
      .setCustomId(`${customIdPrefix}:${msgId}`)
      .setPlaceholder(`Class (${classes[0]} – ${classes[classes.length - 1]})`)
      .addOptions(
        classes.map((name) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(name)
            .setValue(name)
            .setDefault(signup.className === name)
        )
      );

  const rows = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(categorySelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      classSelect(ATT_ID.CLASS_A, BDO_CLASSES.slice(0, CLASS_SELECT_SPLIT))
    ),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      classSelect(ATT_ID.CLASS_B, BDO_CLASSES.slice(CLASS_SELECT_SPLIT))
    ),
  ];

  if (isDef) {
    const dutySelect = new StringSelectMenuBuilder()
      .setCustomId(`${ATT_ID.DUTY}:${msgId}`)
      .setPlaceholder("Def duty")
      .addOptions(
        ...DEF_DUTIES.map((d) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(d.name)
            .setValue(d.key)
            .setEmoji(d.emoji)
            .setDefault(signup.duty === d.key)
        ),
        new StringSelectMenuOptionBuilder()
          .setLabel("Undecided")
          .setValue("none")
          .setEmoji(UNSET_EMOJI)
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dutySelect));
  }

  return { content, components: rows };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getModalPartCount(roleCount: number): number {
  return Math.max(1, Math.ceil(roleCount / ROLES_PER_MODAL));
}

function getModalPartRange(part: number, roleCount: number): [number, number] {
  const start = part * ROLES_PER_MODAL;
  return [start, Math.min(start + ROLES_PER_MODAL, roleCount)];
}

function isDefRole(role: AttendanceRole): boolean {
  return role.name === DEF_TEAM_ROLE_NAME;
}

function getDutyEmoji(duty: DefDuty | undefined): string {
  return DEF_DUTIES.find((d) => d.key === duty)?.emoji ?? UNSET_EMOJI;
}

function needsDetails(signup: RoleSignup, role: AttendanceRole): boolean {
  return !signup.category || !signup.className || (isDefRole(role) && !signup.duty);
}

function findSignup(
  session: AttendanceSession,
  userId: string
): { signup: RoleSignup; roleIndex: number } | null {
  const roleIndex = session.userRoles.get(userId);
  if (roleIndex === undefined) return null;
  const signup = session.roleQueues[roleIndex]?.find((s) => s.userId === userId);
  return signup ? { signup, roleIndex } : null;
}

function getDisplayName(interaction: Interaction): string {
  if (interaction.member instanceof GuildMember) {
    return interaction.member.displayName;
  }
  return (
    interaction.user?.displayName ?? interaction.user?.username ?? "Unknown"
  );
}
