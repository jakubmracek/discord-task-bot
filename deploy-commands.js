// deploy-commands.js
// Spusť jednorázově: node deploy-commands.js
// Zaregistruje slash commandy na Discord serveru

const { REST, Routes, SlashCommandBuilder } = require('@discordjs/rest');
require('dotenv').config();

const AREAS = ['Administrativa', 'Pedagogika', 'Komunikace', 'Provoz', 'Ostatní'];
const PRIORITIES = ['high', 'medium', 'low'];

const commands = [
  // ── /task ────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('task')
    .setDescription('Přidá nový úkol')
    .addStringOption(o => o.setName('nazev').setDescription('Co je potřeba udělat').setRequired(true))
    .addUserOption(o => o.setName('pro').setDescription('Komu úkol přiřadit').setRequired(true))
    .addStringOption(o =>
      o.setName('oblast')
        .setDescription('Oblast/téma úkolu')
        .setRequired(true)
        .addChoices(...AREAS.map(a => ({ name: a, value: a })))
    )
    .addStringOption(o =>
      o.setName('priorita')
        .setDescription('Priorita úkolu')
        .setRequired(true)
        .addChoices(
          { name: '🔴 Vysoká', value: 'high' },
          { name: '🟡 Střední', value: 'medium' },
          { name: '🟢 Nízká', value: 'low' },
        )
    )
    .addStringOption(o =>
      o.setName('deadline')
        .setDescription('Termín splnění (formát: DD.MM.YYYY)')
        .setRequired(false)
    ),

  // ── /done ─────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('done')
    .setDescription('Označí úkol jako hotový')
    .addIntegerOption(o => o.setName('id').setDescription('ID úkolu (viz /mytasks)').setRequired(true)),

  // ── /progress ─────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('progress')
    .setDescription('Označí úkol jako "probíhá"')
    .addIntegerOption(o => o.setName('id').setDescription('ID úkolu').setRequired(true)),

  // ── /mytasks ─────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('mytasks')
    .setDescription('Zobrazí tvoje aktuální úkoly'),

  // ── /tasks ───────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('tasks')
    .setDescription('Přehled všech otevřených úkolů (volitelně podle oblasti)')
    .addStringOption(o =>
      o.setName('oblast')
        .setDescription('Filtrovat podle oblasti')
        .setRequired(false)
        .addChoices(...AREAS.map(a => ({ name: a, value: a })))
    ),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registruji slash commandy...');
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID,
        process.env.DISCORD_GUILD_ID,
      ),
      { body: commands.map(c => c.toJSON()) },
    );
    console.log('✅ Slash commandy úspěšně zaregistrovány.');
  } catch (err) {
    console.error('❌ Chyba při registraci:', err);
  }
})();
