import cron from "node-cron";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class CheckinScheduler {
  constructor({ runner, loadConfig, listConfigs, onResult, logger = console, timezoneProvider = () => process.env.TZ }) {
    this.runner = runner;
    this.loadConfig = loadConfig;
    this.listConfigs = listConfigs;
    this.onResult = onResult;
    this.logger = logger;
    this.timezoneProvider = timezoneProvider;
    this.jobs = new Map();
  }

  async loadAll() {
    const names = await this.listConfigs();
    for (const name of names) {
      try { await this.reload(name); }
      catch (error) { this.logger.error(`跳过无效签到配置 ${name}: ${error.message}`); }
    }
  }

  async reloadAll() {
    this.stop();
    await this.loadAll();
  }

  async reload(name) {
    this.remove(name);
    const config = await this.loadConfig(name);
    if (!cron.validate(config.sign_at)) throw new Error(`无效的 cron 表达式: ${config.sign_at}`);
    const job = cron.schedule(config.sign_at, () => this.execute(name), {
      timezone: this.timezoneProvider() || undefined,
    });
    this.jobs.set(name, job);
  }

  remove(name) {
    this.jobs.get(name)?.destroy();
    this.jobs.delete(name);
  }

  async execute(name) {
    try {
      const config = await this.loadConfig(name);
      const randomDelay = Math.floor(Math.random() * (config.random_seconds + 1));
      if (randomDelay) await delay(randomDelay * 1000);
      const result = await this.runner.run(config);
      await this.onResult({ task: name, source: "schedule", ...result });
    } catch (error) {
      this.logger.error(`定时签到 ${name} 失败: ${error.message}`);
      await this.onResult({ task: name, source: "schedule", error: error.message, finishedAt: new Date().toISOString() });
    }
  }

  stop() {
    for (const name of this.jobs.keys()) this.remove(name);
  }
}
