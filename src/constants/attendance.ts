export const ATTENDANCE_MIN_SLOTS = 1;
export const ATTENDANCE_MAX_SLOTS = 100;

export const ATTENDANCE_ROLES = [
  { name: "Mainball", emoji: "\u2694\uFE0F" }, // ⚔️
  { name: "Shotcaller", emoji: "\uD83D\uDCE2" }, // 📢
  { name: "Shai", emoji: "\uD83D\uDC9A" }, // 💚
  { name: "Def Team", emoji: "\uD83D\uDEE1\uFE0F" }, // 🛡️
  { name: "Cannoner", emoji: "\uD83D\uDCA5" }, // 💥
  { name: "ELE", emoji: "\uD83D\uDC18" }, // 🐘
  { name: "Flex", emoji: "\uD83D\uDD00" }, // 🔀
] as const;

/** Attendance roles that require a matching Discord server role to sign up.
 *  Key = lowercase attendance role name, Value = substring to match in Discord role name. */
export const ATTENDANCE_ROLE_REQUIREMENTS: Record<string, string> = {
  "def team": "def",
  "shotcaller": "shotcaller",
};

// Custom ID prefixes for interaction routing (scoped by message ID for concurrency)
export const ATT_ID = {
  SETUP_ROLE: "att_setup_role",
  SETUP_PING: "att_setup_ping",
  SETUP_TITLE: "att_setup_title",
  SETUP_CONFIRM: "att_setup_confirm",
  SETUP_CANCEL: "att_setup_cancel",
  MODAL_ROLE: "att_modal_role",
  MODAL_TITLE: "att_modal_title",
  SIGNUP: "att_signup",
  LEAVE: "att_leave",
  CLOSE: "att_close",
  EDIT_ROSTER: "att_edit_roster",
  MODAL_EDIT_ROSTER: "att_modal_edit_roster",
} as const;
