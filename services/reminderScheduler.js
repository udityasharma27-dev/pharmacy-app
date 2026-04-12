const { runDailyReminderCycle } = require("./reminderService");

function normalizeHour(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 9;
  return Math.min(Math.max(Math.floor(parsed), 0), 23);
}

function getNextRunTime(now = new Date(), hour = 9) {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function startReminderScheduler() {
  const runHour = normalizeHour(process.env.REMINDER_RUN_HOUR);

  async function executeCycle() {
    try {
      const summary = await runDailyReminderCycle(new Date());
      console.log("Reminder cycle completed", summary);
    } catch (error) {
      console.error("Reminder cycle failed", error);
    } finally {
      scheduleNextRun();
    }
  }

  function scheduleNextRun() {
    const now = new Date();
    const nextRun = getNextRunTime(now, runHour);
    const delayMs = Math.max(1000, nextRun.getTime() - now.getTime());

    setTimeout(() => {
      executeCycle().catch(() => {});
    }, delayMs);

    console.log(`Reminder scheduler armed for ${nextRun.toISOString()}`);
  }

  scheduleNextRun();
}

module.exports = {
  startReminderScheduler,
  getNextRunTime
};
