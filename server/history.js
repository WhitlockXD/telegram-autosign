import fs from "node:fs/promises";
import path from "node:path";

export class RunHistory {
  constructor(workdir, limit = 100) {
    this.file = path.join(workdir, "run-history.json");
    this.limit = limit;
    this.pending = Promise.resolve();
  }

  async list(limit = this.limit) {
    try {
      const records = JSON.parse(await fs.readFile(this.file, "utf8"));
      return Array.isArray(records) ? records.slice(0, Math.max(0, limit)) : [];
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return [];
      throw error;
    }
  }

  async add(result) {
    this.pending = this.pending.then(
      () => this.write(result),
      () => this.write(result),
    );
    return this.pending;
  }

  async write(result) {
    const records = await this.list(this.limit);
    records.unshift(result);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(records.slice(0, this.limit), null, 2)}\n`, "utf8");
    await fs.rename(temporary, this.file);
    return result;
  }
}
