/**
 * ThoughtRings 性能基准测试脚本 —— 完全隔离版
 * ------------------------------------------------------------------
 * 安全声明：
 *   1. 本脚本只操作系统临时目录下的一个随机命名 SQLite 文件，
 *      绝不引用、绝不读写 app.getPath('userData') 下的真实数据库。
 *   2. 运行结束（无论成功还是异常）都会尝试删除该临时文件。
 *   3. 不导入、不修改项目里的 electron/db.cjs 或任何业务代码。
 *
 * 用法：
 *   ELECTRON_RUN_AS_NODE=1 npx electron benchmark.cjs [规模1] [规模2] ...
 *   不传参数时默认测试 1000 / 10000 / 100000 三档。
 */

const path = require("path");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

// ---------------------------------------------------------------------
// 1. 隔离的临时数据库文件（与真实数据完全无关）
// ---------------------------------------------------------------------
const randomSuffix = crypto.randomBytes(6).toString("hex");
const BENCH_DB_PATH = path.join(os.tmpdir(), `thoughtrings-bench-${randomSuffix}.db`);

console.log("=".repeat(70));
console.log("ThoughtRings 性能基准测试（隔离沙盒，不影响真实数据）");
console.log("临时数据库文件路径:", BENCH_DB_PATH);
console.log("=".repeat(70));

function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = BENCH_DB_PATH + suffix;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (e) {
      console.warn(`[警告] 清理临时文件失败，请手动检查并删除: ${p}`);
    }
  }
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(1);
});

// ---------------------------------------------------------------------
// 2. 与 db.cjs 一致的 schema（独立建表，互不影响）
// ---------------------------------------------------------------------
function createSchema(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);

    CREATE TABLE quotes (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      source TEXT,
      is_question INTEGER NOT NULL DEFAULT 0,
      is_resolved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE thoughts (
      id TEXT PRIMARY KEY,
      quote_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(quote_id) REFERENCES quotes(id) ON DELETE CASCADE
    );

    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE quote_tags (
      quote_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY(quote_id, tag_id),
      FOREIGN KEY(quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_quotes_created ON quotes(created_at DESC);
    CREATE INDEX idx_thoughts_quote ON thoughts(quote_id);
    CREATE INDEX idx_thoughts_created ON thoughts(created_at ASC);
    CREATE INDEX idx_quote_tags_tag ON quote_tags(tag_id);
    CREATE INDEX idx_quotes_type_created ON quotes(is_question, created_at DESC);
    CREATE INDEX idx_quote_tags_lookup ON quote_tags(tag_id, quote_id);

    CREATE TABLE quote_links (
      source_quote_id TEXT NOT NULL,
      target_quote_id TEXT NOT NULL,
      source_thought_id TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(source_quote_id, target_quote_id, source_thought_id)
    );
    CREATE INDEX idx_quote_links_target ON quote_links(target_quote_id);
  `);
}

// ---------------------------------------------------------------------
// 3. 与 db.cjs 一致的加解密实现（用于衡量密码锁开启时的真实开销）
// ---------------------------------------------------------------------
const masterKey = crypto.randomBytes(32); // 模拟一个已解锁的会话密钥

function encryptText(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);
  let enc = cipher.update(plain, "utf8");
  enc = Buffer.concat([enc, cipher.final()]);
  const tag = cipher.getAuthTag();
  return "ENC:" + Buffer.concat([iv, tag, enc]).toString("base64");
}

function decryptText(data) {
  if (!data || !data.startsWith("ENC:")) return data;
  const raw = Buffer.from(data.slice(4), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const text = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(tag);
  let dec = decipher.update(text, null, "utf8");
  dec += decipher.final("utf8");
  return dec;
}

// ---------------------------------------------------------------------
// 4. 模拟数据生成（贴近真实使用：中文段落 + 少量标签 + 1~2 层思考）
// ---------------------------------------------------------------------
const SAMPLE_SENTENCES = [
  "认知的边界往往不是知识的边界，而是勇气的边界。",
  "系统的复杂性不会消失，只会从一个地方转移到另一个地方。",
  "真正的自由不是想做什么就做什么，而是不想做什么就可以不做什么。",
  "我们并非通过思考走出困境，而是通过行动重新定义困境。",
  "好的架构不是没有缺陷，而是缺陷可以被局部化。",
  "耐心不是等待，而是在等待时依然保持专注的能力。",
];
const SAMPLE_TAGS = ["哲学/认知", "工程/架构", "心理/成长", "写作", "阅读笔记", "工作/复盘", "产品/思考"];

function randomContent() {
  const n = 2 + Math.floor(Math.random() * 4);
  let s = "<p>";
  for (let i = 0; i < n; i++) {
    s += SAMPLE_SENTENCES[Math.floor(Math.random() * SAMPLE_SENTENCES.length)];
  }
  s += "</p>";
  return s;
}

function seedDatabase(db, count, encrypted) {
  const insertQuote = db.prepare(
    `INSERT INTO quotes (id, content, source, is_question, is_resolved, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertThought = db.prepare(
    `INSERT INTO thoughts (id, quote_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  );
  const insertTag = db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`);
  const getTagId = db.prepare(`SELECT id FROM tags WHERE name = ?`);
  const insertQuoteTag = db.prepare(`INSERT OR IGNORE INTO quote_tags (quote_id, tag_id) VALUES (?, ?)`);

  for (const t of SAMPLE_TAGS) insertTag.run(t);

  const seedAll = db.transaction(() => {
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const id = crypto.randomUUID();
      const createdAt = now - Math.floor(Math.random() * 365 * 2) * 86400000;
      const rawContent = randomContent();
      const content = encrypted ? encryptText(rawContent) : rawContent;
      const isQuestion = Math.floor(Math.random() * 3); // 0/1/2 三态

      insertQuote.run(id, content, null, isQuestion, 0, createdAt);

      // 每条附带 0~2 个标签
      const tagCount = Math.floor(Math.random() * 3);
      for (let k = 0; k < tagCount; k++) {
        const tagName = SAMPLE_TAGS[Math.floor(Math.random() * SAMPLE_TAGS.length)];
        const row = getTagId.get(tagName);
        if (row) insertQuoteTag.run(id, row.id);
      }

      // 每条附带 0~2 层思考（模拟真实分布）
      const thoughtCount = Math.floor(Math.random() * 3);
      for (let j = 0; j < thoughtCount; j++) {
        const thId = crypto.randomUUID();
        const thRaw = randomContent();
        const thContent = encrypted ? encryptText(thRaw) : thRaw;
        insertThought.run(thId, id, thContent, createdAt + j * 3600000, createdAt + j * 3600000);
      }
    }
  });

  seedAll();
}

// ---------------------------------------------------------------------
// 5. 对齐 db.cjs 真实查询逻辑的基准测试用例
// ---------------------------------------------------------------------
function benchGetTotalCount(db) {
  const row = db.prepare(`SELECT COUNT(*) as c FROM quotes`).get();
  return row.c;
}

function benchGetTagStats(db) {
  return db
    .prepare(
      `SELECT t.id, t.name, COUNT(qt.quote_id) as count
       FROM tags t LEFT JOIN quote_tags qt ON t.id = qt.tag_id
       GROUP BY t.id, t.name ORDER BY count DESC, t.name ASC`
    )
    .all();
}

function benchGetTimelineStats(db) {
  const quotesByDay = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', 'localtime')) as day, COUNT(*) as count
       FROM quotes GROUP BY day ORDER BY day DESC`
    )
    .all();
  const thoughtsByDay = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', 'localtime')) as day, COUNT(*) as count
       FROM thoughts GROUP BY day ORDER BY day DESC`
    )
    .all();
  return { quotes: quotesByDay, thoughts: thoughtsByDay };
}

// 分页首屏查询：完全对齐补丁后 get_quotes 的核心查询结构（含三个相关子查询）
function benchPagedFirstPage(db, encrypted, limit = 40) {
  const sql = `
    SELECT
      q.id, q.content, q.source, q.is_question, q.is_resolved, q.created_at,
      (SELECT COUNT(DISTINCT ql.source_quote_id) FROM quote_links ql WHERE ql.target_quote_id = q.id) AS backlinks_count,
      (SELECT COALESCE(json_group_array(t.name), '[]') FROM quote_tags qt JOIN tags t ON qt.tag_id = t.id WHERE qt.quote_id = q.id) AS tags_json,
      (SELECT COALESCE(json_group_array(json_object('id', th.id, 'content', th.content, 'created_at', th.created_at)), '[]') FROM thoughts th WHERE th.quote_id = q.id) AS thoughts_json
    FROM quotes q
    ORDER BY q.created_at DESC
    LIMIT ${limit}
  `;
  const rows = db.prepare(sql).all();
  // 模拟前端拿到数据后的解密+反序列化开销
  for (const r of rows) {
    if (encrypted) decryptText(r.content);
    JSON.parse(r.tags_json);
    const thoughts = JSON.parse(r.thoughts_json);
    if (encrypted) {
      for (const t of thoughts) decryptText(t.content);
    }
  }
  return rows.length;
}

// 旧版 all:true 全量拉取：作为"优化前"的对照组
function benchLegacyFullFetch(db, encrypted) {
  const sql = `
    SELECT
      q.id, q.content, q.source, q.is_question, q.is_resolved, q.created_at,
      (SELECT COUNT(DISTINCT ql.source_quote_id) FROM quote_links ql WHERE ql.target_quote_id = q.id) AS backlinks_count,
      (SELECT COALESCE(json_group_array(t.name), '[]') FROM quote_tags qt JOIN tags t ON qt.tag_id = t.id WHERE qt.quote_id = q.id) AS tags_json,
      (SELECT COALESCE(json_group_array(json_object('id', th.id, 'content', th.content, 'created_at', th.created_at)), '[]') FROM thoughts th WHERE th.quote_id = q.id) AS thoughts_json
    FROM quotes q
    ORDER BY q.created_at DESC
  `;
  const rows = db.prepare(sql).all();
  for (const r of rows) {
    if (encrypted) decryptText(r.content);
    JSON.parse(r.tags_json);
    const thoughts = JSON.parse(r.thoughts_json);
    if (encrypted) {
      for (const t of thoughts) decryptText(t.content);
    }
  }
  return rows.length;
}

// 标签筛选下的分页查询（对齐补丁后下推到 SQL 的 tag 条件）
function benchTagFilteredPage(db, tagName, limit = 40) {
  const sql = `
    SELECT q.id, q.content, q.created_at
    FROM quotes q
    WHERE q.id IN (
      SELECT qt.quote_id FROM quote_tags qt
      JOIN tags t ON qt.tag_id = t.id
      WHERE t.name = ? OR t.name LIKE ?
    )
    ORDER BY q.created_at DESC
    LIMIT ${limit}
  `;
  return db.prepare(sql).all(tagName, tagName + "/%").length;
}

// ---------------------------------------------------------------------
// 6. 主流程：对每个规模、每种加密状态跑一遍全部基准
// ---------------------------------------------------------------------
function runBenchmarkForSize(size, encrypted) {
  const label = `规模=${size.toLocaleString()} 条  ${encrypted ? "[已加密]" : "[未加密]"}`;
  console.log("\n" + "-".repeat(70));
  console.log(label);
  console.log("-".repeat(70));

  if (fs.existsSync(BENCH_DB_PATH)) cleanup();
  const db = new Database(BENCH_DB_PATH);
  createSchema(db);

  console.time(`  [写入] 灌入 ${size} 条模拟数据`);
  seedDatabase(db, size, encrypted);
  console.timeEnd(`  [写入] 灌入 ${size} 条模拟数据`);

  const totalThoughts = db.prepare(`SELECT COUNT(*) as c FROM thoughts`).get().c;
  console.log(`  （实际生成 thoughts 数: ${totalThoughts}）`);

  console.time("  [查询] get_total_quotes_count（新增，界面总数用）");
  benchGetTotalCount(db);
  console.timeEnd("  [查询] get_total_quotes_count（新增，界面总数用）");

  console.time("  [查询] get_tag_stats（标签统计）");
  benchGetTagStats(db);
  console.timeEnd("  [查询] get_tag_stats（标签统计）");

  console.time("  [查询] get_timeline_stats（月/日归档统计，新增）");
  benchGetTimelineStats(db);
  console.timeEnd("  [查询] get_timeline_stats（月/日归档统计，新增）");

  console.time("  [查询] 分页首屏 40 条（补丁后日常浏览的真实开销）");
  benchPagedFirstPage(db, encrypted, 40);
  console.timeEnd("  [查询] 分页首屏 40 条（补丁后日常浏览的真实开销）");

  console.time("  [查询] 标签筛选分页（补丁后走 SQL 下推）");
  benchTagFilteredPage(db, "工程/架构", 40);
  console.timeEnd("  [查询] 标签筛选分页（补丁后走 SQL 下推）");

  console.time("  [对照组·补丁前] 全量拉取 all:true（'深入思考'筛选仍是此路径）");
  benchLegacyFullFetch(db, encrypted);
  console.timeEnd("  [对照组·补丁前] 全量拉取 all:true（'深入思考'筛选仍是此路径）");

  db.close();
  cleanup();
}

function main() {
  const args = process.argv.slice(2).map(Number).filter((n) => !isNaN(n) && n > 0);
  const sizes = args.length > 0 ? args : [1000, 10000, 100000];

  for (const size of sizes) {
    runBenchmarkForSize(size, false); // 未加密
    runBenchmarkForSize(size, true);  // 已加密（模拟开启密码锁）
  }

  console.log("\n" + "=".repeat(70));
  console.log("全部基准测试完成，临时数据库已清理。");
  console.log("=".repeat(70));
}

main();