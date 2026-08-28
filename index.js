require("dotenv").config();

const express = require("express");
const mineflayer = require("mineflayer");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder
} = require("discord.js");

// ======================================================
// CONFIG
// ======================================================

const PREFIX = process.env.PREFIX || "?";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const DEFAULT_MC_HOST = process.env.MC_HOST;
const DEFAULT_MC_PORT = Number(process.env.MC_PORT || 25565);
const MC_USERNAME = process.env.MC_USERNAME || "DiscordBot";

const RECONNECT_DELAY = Number(
  process.env.RECONNECT_DELAY || 5000
);

const AFK_INTERVAL = Number(
  process.env.AFK_INTERVAL || 300000
);

const WEB_PORT = Number(
  process.env.WEB_PORT || 3000
);

// ======================================================
// AUTO LOGIN
// ======================================================

const LOGIN_COMMAND = "/login hiophiop";

// ======================================================
// CHECK CONFIG
// ======================================================

if (!DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN is missing.");
  process.exit(1);
}

if (!DISCORD_CHANNEL_ID) {
  console.error("DISCORD_CHANNEL_ID is missing.");
  process.exit(1);
}

// ======================================================
// DISCORD
// ======================================================

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ======================================================
// MINECRAFT STATE
// ======================================================

let mcBot = null;

let currentHost = DEFAULT_MC_HOST;
let currentPort = DEFAULT_MC_PORT;

let afkMode = false;

let afkTimer = null;
let reconnectTimer = null;

let manuallyDisconnected = false;
let isConnecting = false;

let loginSent = false;

// ======================================================
// DISCORD HELPERS
// ======================================================

async function getDiscordChannel() {
  try {
    return await discord.channels.fetch(
      DISCORD_CHANNEL_ID
    );
  } catch (error) {
    console.error(
      "Could not fetch Discord channel:",
      error.message
    );

    return null;
  }
}

async function sendDiscordMessage(content) {
  const channel = await getDiscordChannel();

  if (!channel) return;

  try {
    await channel.send({
      content: String(content).slice(0, 1900)
    });
  } catch (error) {
    console.error(
      "Discord message error:",
      error.message
    );
  }
}

async function sendLog(title, description) {
  const channel = await getDiscordChannel();

  if (!channel) return;

  try {
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(
        String(description).slice(0, 4000)
      )
      .setTimestamp();

    await channel.send({
      embeds: [embed]
    });
  } catch (error) {
    console.error(
      "Discord log error:",
      error.message
    );
  }
}

// ======================================================
// AUTO LOGIN DETECTION
// ======================================================

function tryAutoLogin(text) {
  if (!mcBot) return;

  if (loginSent) return;

  const lower = text.toLowerCase();

  const loginRequested =
    lower.includes("/login") ||
    lower.includes("please login") ||
    lower.includes("please log in") ||
    lower.includes("type /login") ||
    lower.includes("use /login") ||
    lower.includes("login with") ||
    lower.includes("you need to login") ||
    lower.includes("you need to log in");

  if (!loginRequested) return;

  loginSent = true;

  console.log("🔐 Login requested by server.");

  setTimeout(() => {
    if (!mcBot) return;

    try {
      mcBot.chat(LOGIN_COMMAND);

      console.log("🔐 Auto-login command sent.");

      sendLog(
        "🔐 Auto Login",
        "The Minecraft server requested a login. Auto-login was sent."
      );
    } catch (error) {
      loginSent = false;

      console.error(
        "Auto-login error:",
        error.message
      );
    }
  }, 1000);
}

// ======================================================
// AFK
// ======================================================

function stopAfkTimer() {
  if (afkTimer) {
    clearInterval(afkTimer);
    afkTimer = null;
  }
}

function startAfkTimer() {
  stopAfkTimer();

  if (!afkMode) return;

  console.log(
    "💤 AFK mode enabled."
  );

  afkTimer = setInterval(() => {

    if (!mcBot || !mcBot.entity) {
      return;
    }

    try {

      mcBot.setControlState(
        "jump",
        true
      );

      setTimeout(() => {

        if (mcBot) {
          mcBot.setControlState(
            "jump",
            false
          );
        }

      }, 500);

      console.log(
        "🦘 AFK jump."
      );

    } catch (error) {

      console.error(
        "AFK error:",
        error.message
      );

    }

  }, AFK_INTERVAL);
}

// ======================================================
// AUTO RECONNECT
// ======================================================

function scheduleReconnect() {

  if (manuallyDisconnected) {
    return;
  }

  if (reconnectTimer) {
    return;
  }

  console.log(
    `🔄 Reconnecting in ${RECONNECT_DELAY / 1000}s...`
  );

  sendLog(
    "🔄 Auto Reconnect",
    `Trying again in **${RECONNECT_DELAY / 1000} seconds**.`
  );

  reconnectTimer = setTimeout(() => {

    reconnectTimer = null;

    connectMinecraft();

  }, RECONNECT_DELAY);
}

// ======================================================
// MINECRAFT EVENTS
// ======================================================

function setupMinecraftEvents() {

  if (!mcBot) return;

  mcBot.once("spawn", () => {

    isConnecting = false;

    loginSent = false;

    console.log(
      "🟢 Minecraft bot spawned."
    );

    sendLog(
      "🟢 Minecraft Connected",
      `Connected to \`${currentHost}:${currentPort}\` as **${MC_USERNAME}**`
    );

    startAfkTimer();

  });

  // ================================================
  // ALL MINECRAFT CHAT / SERVER MESSAGES
  // ================================================

  mcBot.on("message", (jsonMsg) => {

    const text = jsonMsg.toString();

    console.log(
      `[MC] ${text}`
    );

    sendDiscordMessage(
      `**[MC]** ${text}`
    );

    // Check for login request
    tryAutoLogin(text);

  });

  // ================================================
  // PLAYER CHAT
  // ================================================

  mcBot.on(
    "chat",
    (username, message) => {

      if (
        mcBot &&
        username === mcBot.username
      ) {
        return;
      }

      console.log(
        `[MC CHAT] ${username}: ${message}`
      );

      sendDiscordMessage(
        `💬 **${username}:** ${message}`
      );

    }
  );

  // ================================================
  // WHISPERS
  // ================================================

  mcBot.on(
    "whisper",
    (username, message) => {

      console.log(
        `[MC WHISPER] ${username}: ${message}`
      );

      sendDiscordMessage(
        `📩 **${username} whispered:** ${message}`
      );

    }
  );

  // ================================================
  // KICK
  // ================================================

  mcBot.on(
    "kicked",
    (reason) => {

      console.log(
        "⚠️ Minecraft bot kicked:",
        reason
      );

      sendLog(
        "⚠️ Minecraft Kicked",
        `Reason: \`${String(reason).slice(0, 1000)}\``
      );

    }
  );

  // ================================================
  // ERROR
  // ================================================

  mcBot.on(
    "error",
    (error) => {

      console.error(
        "❌ Minecraft error:",
        error.message
      );

      sendLog(
        "❌ Minecraft Error",
        `\`${error.message}\``
      );

    }
  );

  // ================================================
  // DISCONNECT
  // ================================================

  mcBot.on(
    "end",
    (reason) => {

      isConnecting = false;

      loginSent = false;

      console.log(
        "🔴 Minecraft connection ended:",
        reason
      );

      stopAfkTimer();

      sendLog(
        "🔴 Minecraft Disconnected",
        `Reason: \`${String(reason || "Unknown")}\``
      );

      if (!manuallyDisconnected) {
        scheduleReconnect();
      }

    }
  );
}

// ======================================================
// CONNECT MINECRAFT
// ======================================================

function connectMinecraft() {

  if (isConnecting) {

    console.log(
      "⚠️ Already connecting."
    );

    return;
  }

  if (!currentHost) {

    console.log(
      "❌ No Minecraft server configured."
    );

    return;
  }

  if (mcBot) {

    try {
      mcBot.quit(
        "Reconnecting"
      );
    } catch {}

    mcBot = null;
  }

  clearTimeout(
    reconnectTimer
  );

  reconnectTimer = null;

  isConnecting = true;

  manuallyDisconnected = false;

  loginSent = false;

  console.log(
    `🔗 Connecting to ${currentHost}:${currentPort}`
  );

  sendLog(
    "🔗 Minecraft Connecting",
    `Connecting to \`${currentHost}:${currentPort}\``
  );

  const options = {

    host: currentHost,

    port: currentPort,

    username: MC_USERNAME,

    auth: "offline"

  };

  // IMPORTANT:
  // Your server currently requires 1.21.11
  // even though it reports a newer version.

  if (process.env.MC_VERSION) {

    options.version =
      process.env.MC_VERSION;

  }

  try {

    mcBot =
      mineflayer.createBot(
        options
      );

    setupMinecraftEvents();

  } catch (error) {

    isConnecting = false;

    console.error(
      "Minecraft creation error:",
      error.message
    );

    scheduleReconnect();

  }
}

// ======================================================
// DISCORD COMMANDS
// ======================================================

discord.on(
  "messageCreate",
  async (message) => {

    if (message.author.bot) {
      return;
    }

    if (
      !message.content.startsWith(
        PREFIX
      )
    ) {
      return;
    }

    const args =
      message.content
        .slice(PREFIX.length)
        .trim()
        .split(/\s+/);

    const command =
      args.shift()?.toLowerCase();

    // ================================================
    // ?say
    // ================================================

    if (command === "say") {

      const text =
        args.join(" ");

      if (!text) {

        return message.reply(
          "❌ Usage: `?say <message>`"
        );

      }

      if (
        !mcBot ||
        !mcBot.player
      ) {

        return message.reply(
          "❌ Minecraft bot is not connected."
        );

      }

      try {

        mcBot.chat(text);

        await message.reply(
          `✅ Sent to Minecraft: **${text}**`
        );

        sendLog(
          "💬 Discord → Minecraft",
          `**${message.author.tag}** sent:\n> ${text}`
        );

      } catch (error) {

        message.reply(
          `❌ Failed to send: ${error.message}`
        );

      }

      return;
    }

    // ================================================
    // ?join
    // ================================================

    if (command === "join") {

      const host = args[0];

      if (!host) {

        return message.reply(
          "❌ Usage: `?join <server-ip> [port]`"
        );

      }

      const port =
        Number(
          args[1] || 25565
        );

      if (
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535
      ) {

        return message.reply(
          "❌ Invalid port."
        );

      }

      currentHost = host;

      currentPort = port;

      manuallyDisconnected =
        false;

      if (mcBot) {

        try {

          mcBot.quit(
            "Switching server"
          );

        } catch {}

        mcBot = null;

      }

      clearTimeout(
        reconnectTimer
      );

      reconnectTimer = null;

      await message.reply(
        `🔗 Joining **${host}:${port}**...`
      );

      connectMinecraft();

      return;
    }

    // ================================================
    // ?mode
    // ================================================

    if (command === "mode") {

      const mode =
        args[0]?.toLowerCase();

      if (!mode) {

        return message.reply(
          `⚙️ Current mode: **${afkMode ? "AFK" : "NO AFK"}**`
        );

      }

      if (mode === "afk") {

        afkMode = true;

        startAfkTimer();

        await message.reply(
          "💤 **AFK mode enabled.** The bot will jump every 5 minutes."
        );

        sendLog(
          "💤 AFK Mode",
          `Enabled by **${message.author.tag}**`
        );

        return;
      }

      if (
        mode === "noafk" ||
        mode === "no-afk" ||
        mode === "off"
      ) {

        afkMode = false;

        stopAfkTimer();

        await message.reply(
          "🟢 **NO AFK mode enabled.**"
        );

        sendLog(
          "🟢 AFK Mode Disabled",
          `Disabled by **${message.author.tag}**`
        );

        return;
      }

      return message.reply(
        "❌ Use `?mode afk` or `?mode noafk`."
      );
    }

    // ================================================
    // ?status
    // ================================================

    if (command === "status") {

      const mcStatus =
        mcBot && mcBot.player
          ? "🟢 Connected"
          : "🔴 Disconnected";

      return message.reply(
        `🤖 **Bot Status**\n\n` +
        `Minecraft: ${mcStatus}\n` +
        `Server: \`${currentHost || "None"}:${currentPort}\`\n` +
        `Mode: **${afkMode ? "AFK" : "NO AFK"}**`
      );

    }

    // ================================================
    // ?help
    // ================================================

    if (command === "help") {

      return message.reply(
        `**Minecraft Bot Commands**\n\n` +
        `\`${PREFIX}say <message>\` — Send chat to Minecraft\n` +
        `\`${PREFIX}join <ip> [port]\` — Join a Minecraft server\n` +
        `\`${PREFIX}mode afk\` — Enable AFK jumping\n` +
        `\`${PREFIX}mode noafk\` — Disable AFK jumping\n` +
        `\`${PREFIX}mode\` — Show current mode\n` +
        `\`${PREFIX}status\` — Show bot status\n` +
        `\`${PREFIX}help\` — Show commands`
      );

    }

  }
);

// ======================================================
// DISCORD READY
// ======================================================

discord.once(
  "ready",
  () => {

    console.log(
      `🤖 Discord logged in as ${discord.user.tag}`
    );

    sendLog(
      "🟢 Discord Bot Online",
      `Logged in as **${discord.user.tag}**`
    );

    if (DEFAULT_MC_HOST) {
      connectMinecraft();
    }

  }
);

// ======================================================
// DISCORD ERROR
// ======================================================

discord.on(
  "error",
  (error) => {

    console.error(
      "Discord error:",
      error
    );

  }
);

// ======================================================
// RAILWAY / HEALTH SERVER
// ======================================================

const app = express();

app.get(
  "/",
  (req, res) => {

    res.status(200).send(
      "Minecraft Discord Bot is running."
    );

  }
);

app.get(
  "/status",
  (req, res) => {

    res.json({

      discord:
        discord.isReady(),

      minecraft:
        !!(
          mcBot &&
          mcBot.player
        ),

      server:
        currentHost
          ? `${currentHost}:${currentPort}`
          : null,

      mode:
        afkMode
          ? "afk"
          : "noafk"

    });

  }
);

app.listen(
  WEB_PORT,
  () => {

    console.log(
      `🌐 Health server running on port ${WEB_PORT}`
    );

  }
);

// ======================================================
// START DISCORD
// ======================================================

discord.login(
  DISCORD_TOKEN
);