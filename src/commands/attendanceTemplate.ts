import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { ATTENDANCE_ROLES, BUILTIN_TEMPLATES } from "@/constants/attendance";
import type { AttendanceTemplate } from "@/types/attendance";
import { deleteAttendanceTemplate, loadAttendanceTemplates } from "@/services/database";

// ─── Template Lookup ─────────────────────────────────────────────────────────

function builtInTemplates(): AttendanceTemplate[] {
  return BUILTIN_TEMPLATES.map((t) => ({
    name: t.name,
    title: t.name,
    roles: ATTENDANCE_ROLES.map((r) => ({
      name: r.name,
      emoji: r.emoji,
      maxCount: t.counts[r.name] ?? 0,
    })),
    pingRoleId: null,
    builtIn: true,
  }));
}

/** Built-in templates merged with the guild's saved ones (saved wins on name clash). */
export function getAvailableTemplates(guildId: string): AttendanceTemplate[] {
  const byName = new Map<string, AttendanceTemplate>();
  for (const t of builtInTemplates()) byName.set(t.name.toLowerCase(), t);
  for (const t of loadAttendanceTemplates(guildId)) byName.set(t.name.toLowerCase(), t);
  return [...byName.values()];
}

export function findTemplate(guildId: string, name: string): AttendanceTemplate | undefined {
  const key = name.trim().toLowerCase();
  return getAvailableTemplates(guildId).find((t) => t.name.toLowerCase() === key);
}

function templateTotal(template: AttendanceTemplate): number {
  return template.roles.reduce((sum, r) => sum + r.maxCount, 0);
}

// ─── Slash Command Definition ────────────────────────────────────────────────

export const attendanceTemplateCommand = new SlashCommandBuilder()
  .setName("attendance-template")
  .setDescription("Manage attendance templates")
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List available attendance templates")
  )
  .addSubcommand((sub) =>
    sub
      .setName("delete")
      .setDescription("Delete a saved attendance template")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Template to delete")
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// ─── Slash Command Handler ───────────────────────────────────────────────────

export async function handleAttendanceTemplateSlashCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guild) return;

  const sub = interaction.options.getSubcommand();

  if (sub === "list") {
    const templates = getAvailableTemplates(interaction.guild.id);
    const lines = templates.map((t) => {
      const counts = t.roles
        .filter((r) => r.maxCount > 0)
        .map((r) => `${r.emoji} ${r.name} ${r.maxCount}`)
        .join(" · ");
      const tag = t.builtIn ? " *(built-in)*" : "";
      return `**${t.name}**${tag} — ${templateTotal(t)} slots\n${counts}`;
    });

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Attendance Templates")
          .setDescription(lines.join("\n\n") || "*No templates*")
          .setColor(0x5865f2),
      ],
      ephemeral: true,
    });
    return;
  }

  if (sub === "delete") {
    const name = interaction.options.getString("name", true);
    const deleted = deleteAttendanceTemplate(interaction.guild.id, name.trim());
    await interaction.reply({
      content: deleted
        ? `Deleted template **${name}**.`
        : `No saved template named **${name}**. Built-in templates can't be deleted.`,
      ephemeral: true,
    });
  }
}

// ─── Autocomplete ────────────────────────────────────────────────────────────

export async function handleTemplateAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  if (!interaction.guild) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused().toLowerCase();
  // Only saved templates can be deleted; posting can use any template
  const isDelete = interaction.commandName === "attendance-template";
  const templates = isDelete
    ? loadAttendanceTemplates(interaction.guild.id)
    : getAvailableTemplates(interaction.guild.id);

  const choices = templates
    .filter((t) => t.name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((t) => ({ name: `${t.name} (${templateTotal(t)} slots)`, value: t.name }));

  await interaction.respond(choices);
}
