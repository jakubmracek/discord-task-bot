// index.js – hlavní soubor Discord bota
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const cron = require('node-cron');

// ── Automatická registrace slash commandů při startu ──────────────────────────
async function registerCommands() {
  const AREAS = ['Administrativa', 'Pedagogika', 'Komunikace', 'Provoz', 'Ostatní'];

  const commands = [
    new SlashCommandBuilder()
      .setName('task').setDescription('Přidá nový úkol')
      .addStringOption(o => o.setName('nazev').setDescription('Co je potřeba udělat').setRequired(true))
      .addUserOption(o => o.setName('pro').setDescription('Komu úkol přiřadit').setRequired(true))
      .addStringOption(o => o.setName('oblast').setDescription('Oblast/téma').setRequired(true)
        .addChoices(...AREAS.map(a => ({ name: a, value: a }))))
      .addStringOption(o => o.setName('priorita').setDescription('Priorita').setRequired(true)
        .addChoices(
          { name: '🔴 Vysoká', value: 'high' },
          { name: '🟡 Střední', value: 'medium' },
          { name: '🟢 Nízká', value: 'low' },
        ))
      .addStringOption(o => o.setName('deadline').setDescription('Termín (DD.MM.YYYY)').setRequired(false)),
    new SlashCommandBuilder().setName('done').setDescription('Označí úkol jako hotový')
      .addIntegerOption(o => o.setName('id').setDescription('ID úkolu').setRequired(true)),
    new SlashCommandBuilder().setName('progress').setDescription('Označí úkol jako "probíhá"')
      .addIntegerOption(o => o.setName('id').setDescription('ID úkolu').setRequired(true)),
    new SlashCommandBuilder().setName('mytasks').setDescription('Zobrazí tvoje aktuální úkoly'),
    new SlashCommandBuilder().setName('tasks').setDescription('Přehled všech otevřených úkolů')
      .addStringOption(o => o.setName('oblast').setDescription('Filtrovat podle oblasti').setRequired(false)
        .addChoices(...AREAS.map(a => ({ name: a, value: a })))),
    new SlashCommandBuilder().setName('import').setDescription('Hromadný import úkolů z import-tasks.json (pouze admin)'),
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
      { body: commands.map(c => c.toJSON()) },
    );
    console.log('✅ Slash commandy zaregistrovány.');
  } catch (err) {
    console.error('❌ Chyba při registraci commandů:', err);
  }
}

const { initSheet, appendTask, updateTaskStatus, getTasksByUser, getTasksDueTomorrow, getTasksByArea } = require('./sheets');
const { notifyAssigned, notifyDeadlineTomorrow, notifyStatusChange } = require('./notifier');

// ── Pomocné funkce ─────────────────────────────────────────────────────────────

// Převede "DD.MM.YYYY" na "YYYY-MM-DD" (formát pro Sheet)
function parseDate(str) {
  if (!str) return '';
  const parts = str.trim().split('.');
  if (parts.length !== 3) return str; // vrátí jak je, pokud špatný formát
  const [d, m, y] = parts;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Formátuje datum z YYYY-MM-DD na DD.MM.YYYY pro zobrazení
function formatDate(str) {
  if (!str) return 'neurčen';
  const parts = str.split('-');
  if (parts.length !== 3) return str;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

const PRIORITY_CS = { high: '🔴 Vysoká', medium: '🟡 Střední', low: '🟢 Nízká' };
const STATUS_CS = { todo: '📋 K řešení', in_progress: '⚙️ Probíhá', done: '✅ Hotovo' };
const PRIORITY_COLOR = { high: 0xE74C3C, medium: 0xF39C12, low: 0x2ECC71 };

// ── Inicializace klienta ──────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', async () => {
  console.log(`✅ Bot přihlášen jako ${client.user.tag}`);
  await registerCommands();
  await initSheet();
  console.log('✅ Sheet zkontrolován.');
});

// ── Zpracování slash commandů ─────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // ── /task ──────────────────────────────────────────────────────────────────
  if (commandName === 'task') {
    await interaction.deferReply();

    const title = interaction.options.getString('nazev');
    const assignee = interaction.options.getUser('pro');
    const area = interaction.options.getString('oblast');
    const priority = interaction.options.getString('priorita');
    const deadlineRaw = interaction.options.getString('deadline');
    const deadline = parseDate(deadlineRaw);

    const task = {
      title,
      assigneeId: assignee.id,
      assigneeName: assignee.displayName || assignee.username,
      area,
      priority,
      deadline,
      createdByName: interaction.user.displayName || interaction.user.username,
    };

    let taskId;
    try {
      taskId = await appendTask(task);
    } catch (err) {
      console.error('❌ Chyba při zápisu do Sheetu:', err);
      await interaction.editReply('❌ Nepodařilo se uložit úkol do Sheetu. Zkontroluj logy.');
      return;
    }

    // Aktualizujeme task s ID a messageLinkem (link doplníme po odeslání zprávy)
    const embed = new EmbedBuilder()
      .setTitle(`✅ Nový úkol #${taskId} vytvořen`)
      .setColor(PRIORITY_COLOR[priority] || 0x5865F2)
      .addFields(
        { name: 'Název', value: title },
        { name: 'Přiřazeno', value: `<@${assignee.id}>`, inline: true },
        { name: 'Oblast', value: area, inline: true },
        { name: 'Priorita', value: PRIORITY_CS[priority], inline: true },
        { name: 'Deadline', value: formatDate(deadline), inline: true },
        { name: 'Stav', value: STATUS_CS['todo'], inline: true },
      )
      .setFooter({ text: `Zadal: ${task.createdByName}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Pošleme DM přiřazené osobě
    await notifyAssigned(client, task, taskId);

    return;
  }

  // ── /done ──────────────────────────────────────────────────────────────────
  if (commandName === 'done') {
    await interaction.deferReply();
    const taskId = interaction.options.getInteger('id');

    let originalRow;
    try {
      originalRow = await updateTaskStatus(taskId, 'done');
    } catch (err) {
      console.error('❌ Chyba při aktualizaci stavu:', err);
      await interaction.editReply('❌ Nepodařilo se aktualizovat úkol.');
      return;
    }

    if (!originalRow) {
      await interaction.editReply(`❌ Úkol #${taskId} nenalezen.`);
      return;
    }

    const changedBy = interaction.user.displayName || interaction.user.username;
    await interaction.editReply(`✅ Úkol **#${taskId} – ${originalRow[1]}** označen jako hotový!`);
    await notifyStatusChange(client, originalRow, 'done', changedBy);
    return;
  }

  // ── /progress ──────────────────────────────────────────────────────────────
  if (commandName === 'progress') {
    await interaction.deferReply();
    const taskId = interaction.options.getInteger('id');

    let originalRow;
    try {
      originalRow = await updateTaskStatus(taskId, 'in_progress');
    } catch (err) {
      console.error('❌ Chyba při aktualizaci stavu:', err);
      await interaction.editReply('❌ Nepodařilo se aktualizovat úkol.');
      return;
    }

    if (!originalRow) {
      await interaction.editReply(`❌ Úkol #${taskId} nenalezen.`);
      return;
    }

    const changedBy = interaction.user.displayName || interaction.user.username;
    await interaction.editReply(`⚙️ Úkol **#${taskId} – ${originalRow[1]}** je nyní ve stavu "probíhá".`);
    await notifyStatusChange(client, originalRow, 'in_progress', changedBy);
    return;
  }

  // ── /mytasks ───────────────────────────────────────────────────────────────
  if (commandName === 'mytasks') {
    await interaction.deferReply({ ephemeral: true }); // vidí jen tazatel

    let tasks;
    try {
      tasks = await getTasksByUser(interaction.user.id);
    } catch (err) {
      console.error('❌ Chyba při načítání úkolů:', err);
      await interaction.editReply('❌ Nepodařilo se načíst úkoly.');
      return;
    }

    if (tasks.length === 0) {
      await interaction.editReply('🎉 Žádné otevřené úkoly – máš čisto!');
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`📋 Tvoje úkoly (${tasks.length})`)
      .setColor(0x5865F2)
      .setTimestamp();

    tasks.forEach(t => {
      embed.addFields({
        name: `#${t.id} – ${t.title}`,
        value: `${PRIORITY_CS[t.priority]} | ${t.area} | Deadline: ${formatDate(t.deadline)} | ${STATUS_CS[t.status]}`,
      });
    });

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /tasks ─────────────────────────────────────────────────────────────────
  if (commandName === 'tasks') {
    await interaction.deferReply();
    const area = interaction.options.getString('oblast');

    let tasks;
    try {
      tasks = await getTasksByArea(area);
    } catch (err) {
      console.error('❌ Chyba při načítání úkolů:', err);
      await interaction.editReply('❌ Nepodařilo se načíst úkoly.');
      return;
    }

    if (tasks.length === 0) {
      const msg = area ? `Žádné otevřené úkoly v oblasti **${area}**.` : 'Žádné otevřené úkoly.';
      await interaction.editReply(`🎉 ${msg}`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(area ? `📋 Úkoly – ${area} (${tasks.length})` : `📋 Všechny úkoly (${tasks.length})`)
      .setColor(0x5865F2)
      .setTimestamp();

    // Discord embed má limit ~6000 znaků, zobrazíme max 20 úkolů
    tasks.slice(0, 20).forEach(t => {
      embed.addFields({
        name: `#${t.id} – ${t.title}`,
        value: `${t.assigneeName} | ${PRIORITY_CS[t.priority]} | Deadline: ${formatDate(t.deadline)} | ${STATUS_CS[t.status]}`,
      });
    });

    if (tasks.length > 20) {
      embed.setFooter({ text: `Zobrazeno 20 z ${tasks.length}. Pro detail viz Google Sheet.` });
    }

    await interaction.editReply({ embeds: [embed] });
    return;
  }
});

  // ── /import ───────────────────────────────────────────────────────────────
  if (commandName === 'import') {
    // Pouze admin (Jakub) může spustit import
    const ADMIN_ID = process.env.DISCORD_ADMIN_ID;
    if (ADMIN_ID && interaction.user.id !== ADMIN_ID) {
      await interaction.reply({ content: '❌ Na tento příkaz nemáš oprávnění.', ephemeral: true });
      return;
    }

    await interaction.deferReply();

    let tasks;
    try {
      tasks = JSON.parse(require('fs').readFileSync('./import-tasks.json', 'utf-8'));
    } catch (err) {
      await interaction.editReply('❌ Nepodařilo se načíst import-tasks.json: ' + err.message);
      return;
    }

    await interaction.editReply(`⏳ Importuji ${tasks.length} úkolů...`);

    let ok = 0;
    let fail = 0;
    const errors = [];

    for (const task of tasks) {
      try {
        await appendTask(task);
        ok++;
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        fail++;
        errors.push(task.title);
      }
    }

    const summary = `✅ Import dokončen: **${ok} úspěšně**, ${fail > 0 ? `**${fail} chyb**` : '0 chyb'}.`;
    const errorList = errors.length ? '\n\nChyby:\n' + errors.map(t => `• ${t}`).join('\n') : '';
    await interaction.editReply(summary + errorList);
    return;
  }

// ── CRON: Každý den v 8:00 – upomínky na zítřejší deadliny ───────────────────
// Timezone: Europe/Prague
cron.schedule('0 8 * * *', async () => {
  console.log('⏰ Kontrola zítřejších deadlinů...');
  try {
    const tasks = await getTasksDueTomorrow();
    console.log(`Nalezeno ${tasks.length} úkolů s deadlinem zítra.`);
    for (const task of tasks) {
      await notifyDeadlineTomorrow(client, task);
    }
  } catch (err) {
    console.error('❌ Chyba při deadline cron jobu:', err);
  }
}, {
  timezone: 'Europe/Prague',
});

// ── Start ─────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
