// notifier.js – Discord DM a kanálové notifikace

const { EmbedBuilder } = require('discord.js');

const STATUS_CS = { todo: '📋 K řešení', in_progress: '⚙️ Probíhá', done: '✅ Hotovo' };

// ── DM při přiřazení nového úkolu ─────────────────────────────────────────────
async function notifyAssigned(client, task, taskId) {
  try {
    const user = await client.users.fetch(task.assigneeId);
    const embed = new EmbedBuilder()
      .setTitle(`📌 Byl ti přiřazen nový úkol #${taskId}`)
      .setColor(0x5865F2)
      .addFields(
        { name: 'Název', value: task.title },
        { name: 'Oblast', value: task.area, inline: true },
        { name: 'Deadline', value: task.deadline, inline: true },
        { name: 'Zadal', value: task.createdByName },
      )
      .setFooter({ text: 'Změnit stav: /done nebo /progress' })
      .setTimestamp();

    await user.send({ embeds: [embed] });
  } catch (err) {
    console.error(`❌ Nepodařilo se poslat DM uživateli ${task.assigneeId}:`, err.message);
  }
}

// ── DM upomínka – deadline je zítra ──────────────────────────────────────────
async function notifyDeadlineTomorrow(client, task) {
  try {
    const user = await client.users.fetch(task.assigneeId);
    const embed = new EmbedBuilder()
      .setTitle(`⏰ Zítra ti vyprší deadline!`)
      .setColor(0xE74C3C)
      .addFields(
        { name: 'Úkol', value: `#${task.id} – ${task.title}` },
        { name: 'Oblast', value: task.area, inline: true },
        { name: 'Deadline', value: task.deadline, inline: true },
      )
      .setFooter({ text: 'Hotovo? Použij /done' })
      .setTimestamp();

    await user.send({ embeds: [embed] });
  } catch (err) {
    console.error(`❌ Nepodařilo se poslat deadline DM pro ${task.assigneeId}:`, err.message);
  }
}

// ── Ping v kanálu při změně stavu ─────────────────────────────────────────────
async function notifyStatusChange(client, task, newStatus, changedBy) {
  try {
    const channel = await client.channels.fetch(process.env.DISCORD_NOTIFY_CHANNEL_ID);
    const embed = new EmbedBuilder()
      .setTitle(`🔄 Změna stavu úkolu #${task[0]}`)
      .setColor(newStatus === 'done' ? 0x2ECC71 : 0x5865F2)
      .addFields(
        { name: 'Název', value: task[1] },
        { name: 'Nový stav', value: STATUS_CS[newStatus] || newStatus, inline: true },
        { name: 'Oblast', value: task[6], inline: true },
        { name: 'Přiřazeno', value: task[2], inline: true },
      )
      .setFooter({ text: `Změnil: ${changedBy}` })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('❌ Nepodařilo se odeslat notifikaci do kanálu:', err.message);
  }
}

module.exports = { notifyAssigned, notifyDeadlineTomorrow, notifyStatusChange };
