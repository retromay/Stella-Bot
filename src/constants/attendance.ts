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
} as const;
