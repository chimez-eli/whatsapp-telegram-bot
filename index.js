require("dotenv").config();

const fs = require("fs");
const path = require("path");
const P = require("pino");
const TelegramBot = require("node-telegram-bot-api");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN is missing.");
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
  polling: true
});

const sessions = new Map();

const SESSION_ROOT = path.join(process.cwd(), "sessions");

if (!fs.existsSync(SESSION_ROOT)) {
  fs.mkdirSync(SESSION_ROOT, { recursive: true });
}

function getSessionDir(telegramId) {
  return path.join(SESSION_ROOT, String(telegramId));
}

async function startWhatsAppSession(telegramId) {
  const sessionDir = getSessionDir(telegramId);

  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const { version } = await fetchLatestBaileysVersion();

  console.log(
    `Starting WhatsApp session for Telegram user ${telegramId}`
  );

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: "silent" }),
    browser: ["CHIMEZ ELI", "Chrome", "1.0.0"],
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false
  });

  sock.ev.on("creds.update", saveCreds);

  
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      console.log(
        `WhatsApp connected for Telegram user ${telegramId}`
      );

      sessions.set(String(telegramId), sock);

      await bot.sendMessage(
        telegramId,
        "✅ *CHIMEZ ELI connected successfully!*\n\nYour WhatsApp account is now linked.",
        { parse_mode: "Markdown" }
      );
    }

    if (connection === "close") {
      sessions.delete(String(telegramId));

      const statusCode =
        lastDisconnect?.error?.output?.statusCode;

      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut;

      console.log(
        `WhatsApp connection closed for Telegram user ${telegramId}. Reconnect: ${shouldReconnect}`
      );

      if (shouldReconnect) {
        setTimeout(() => {
          startWhatsAppSession(telegramId).catch((error) => {
            console.error(
              `Reconnect failed for ${telegramId}:`,
              error
            );
          });
        }, 5000);
      } else {
        await bot.sendMessage(
          telegramId,
          "⚠️ Your WhatsApp session was logged out. Use /pair again to connect."
        );
      }
    }
  });

  sessions.set(String(telegramId), sock);

  return sock;
}

bot.onText(/^\/start$/, async (msg) => {
  const chatId = msg.chat.id;

  await bot.sendMessage(
    chatId,
    `*⚡ CHIMEZ ELI*

Welcome to CHIMEZ ELI powered by CHIMEZ ELI.

Use /pair <phone number> to connect your WhatsApp account.

Example:
\`/pair 2348012345678\`

Use /status to check your connection.`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/^\/status$/, async (msg) => {
  const chatId = String(msg.chat.id);

  const session = sessions.get(chatId);

  if (session) {
    await bot.sendMessage(
      msg.chat.id,
      "🟢 *WhatsApp:* Connected\n🔵 *Telegram:* Connected",
      { parse_mode: "Markdown" }
    );
  } else {
    await bot.sendMessage(
      msg.chat.id,
      "🔴 *WhatsApp:* Not connected\n🔵 *Telegram:* Connected\n\nUse /pair <phone number> to connect.",
      { parse_mode: "Markdown" }
    );
  }
});

bot.onText(/^\/pair(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  const phoneNumber = match?.[1]?.replace(/\D/g, "");

  if (!phoneNumber) {
    await bot.sendMessage(
      msg.chat.id,
      "❌ Please provide your WhatsApp number.\n\nExample:\n/pair 2348012345678"
    );
    return;
  }

  try {
    await bot.sendMessage(
      msg.chat.id,
      "🔄 Preparing your WhatsApp pairing code..."
    );

    const sock = await startWhatsAppSession(chatId);

    if (sock.authState?.creds?.registered) {
      await bot.sendMessage(
        msg.chat.id,
        "✅ This Telegram user already has a WhatsApp session."
      );
      return;
    }

    const code = await sock.requestPairingCode(phoneNumber);

    const formattedCode = String(code)
      .match(/.{1,4}/g)
      ?.join("-") || code;

    await bot.sendMessage(
      msg.chat.id,
      `🔐 *CHIMEZ ELI PAIRING CODE*\n\n\`${formattedCode}\`\n\n` +
      `Open WhatsApp → Linked Devices → Link with phone number instead.\n\n` +
      `Enter the code above.\n\n` +
      `⚡ CHIMEZ ELI powered by CHIMEZ ELI`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error(
      `Pairing error for Telegram user ${chatId}:`,
      error
    );

    await bot.sendMessage(
      msg.chat.id,
      "❌ Failed to generate the pairing code.\n\nPlease wait a moment and try /pair again."
    );
  }
});

bot.on("polling_error", (error) => {
  console.error("Telegram polling error:", error.message);
});

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("⚡ CHIMEZ ELI");
console.log("Telegram-controlled WhatsApp bot");
console.log("Multi-user pairing system loaded");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
