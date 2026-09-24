const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let db = null;
let imagesDir = null;

// 本地加密密钥容器 (对应原 Rust crypto.rs)
let masterKey = null;

function setMasterKeyFromHex(hexStr) {
  if (!hexStr || hexStr.length !== 64) throw new Error("密钥长度非法");
  masterKey = Buffer.from(hexStr, 'hex');
}

function clearMasterKey() {
  masterKey = null;
}

function encryptText(plain) {
  if (!masterKey || !plain) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  let enc = cipher.update(plain, 'utf8');
  enc = Buffer.concat([enc, cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, enc]).toString('base64');
  return `ENC:${payload}`;
}

const ENC_LOCKED_PLACEHOLDER = "[数据已加密，请解锁查看]";
const ENC_MISMATCH_PLACEHOLDER = "[秘钥不匹配，解密失败]";

function decryptText(data) {
  if (!data || !data.startsWith('ENC:')) return data;
  if (!masterKey) return ENC_LOCKED_PLACEHOLDER;
  try {
    const raw = Buffer.from(data.slice(4), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const text = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
    decipher.setAuthTag(tag);
    let dec = decipher.update(text, null, 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch {
    return ENC_MISMATCH_PLACEHOLDER;
  }
}

function getMetaFlag(key) {
  if (!db) return null;
  const row = db.prepare(`SELECT value FROM app_meta WHERE key = ?`).get(key);
  return row ? row.value : null;
}

function setMetaFlag(key, value) {
  if (!db) return;
  db.prepare(`INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)`).run(key, value);
}

// 全量回填反向链接：对"当前可解密"（明文，或已用当前会话密钥可解密）的原句/思考重新同步引用关系。
// 修复：从加密状态的旧版（Tauri）数据库迁移过来时，启动时的一次性回填只扫描明文内容，
// 加密部分被直接跳过；此前用"quote_links 表是否为空"判断要不要回填，导致回填只会跑一次，
// 哪怕之后解锁、正文变得可读了，这批数据的反向链接也永远不会被补上。
function backfillQuoteLinksForDecryptable() {
  if (!db) return;
  try {
    const allQ = db.prepare(`SELECT id, content, created_at FROM quotes`).all();
    for (const q of allQ) {
      const plain = decryptText(q.content);
      if (!plain || plain === ENC_LOCKED_PLACEHOLDER || plain === ENC_MISMATCH_PLACEHOLDER) continue;
      syncQuoteLinks(q.id, null, plain, q.created_at);
    }
    const allTh = db.prepare(`SELECT id, quote_id, content, created_at FROM thoughts`).all();
    for (const th of allTh) {
      const plain = decryptText(th.content);
      if (!plain || plain === ENC_LOCKED_PLACEHOLDER || plain === ENC_MISMATCH_PLACEHOLDER) continue;
      syncQuoteLinks(th.quote_id, th.id, plain, th.created_at);
    }
    setMetaFlag('links_backfill_full_done', '1');
  } catch (e) {}
}

// 解锁会话后调用：若此前从未针对加密内容完整回填过反向链接，立即补跑一次
function maybeBackfillQuoteLinksAfterUnlock() {
  if (getMetaFlag('links_backfill_full_done') === '1') return;
  backfillQuoteLinksForDecryptable();
}

function initDatabase(userDataDir) {
  imagesDir = path.join(userDataDir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });

  const dbPath = path.join(userDataDir, 'thought_rings.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 初始化基础表结构
  db.exec(`
    CREATE TABLE IF NOT EXISTS security_settings (
      id INTEGER PRIMARY KEY,
      is_locked INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT NOT NULL DEFAULT '',
      salt TEXT NOT NULL DEFAULT ''
    );
    INSERT OR IGNORE INTO security_settings (id, is_locked, password_hash, salt) VALUES (1, 0, '', '');

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      source TEXT,
      is_question INTEGER NOT NULL DEFAULT 0,
      is_resolved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS thoughts (
      id TEXT PRIMARY KEY,
      quote_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(quote_id) REFERENCES quotes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quote_tags (
      quote_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY(quote_id, tag_id),
      FOREIGN KEY(quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_quotes_created ON quotes(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_thoughts_quote ON thoughts(quote_id);
    CREATE INDEX IF NOT EXISTS idx_thoughts_created ON thoughts(created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_quote_tags_tag ON quote_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_quotes_type_created ON quotes(is_question, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_quote_tags_lookup ON quote_tags(tag_id, quote_id);

    CREATE TABLE IF NOT EXISTS quote_links (
      source_quote_id TEXT NOT NULL,
      target_quote_id TEXT NOT NULL,
      source_thought_id TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(source_quote_id, target_quote_id, source_thought_id),
      FOREIGN KEY(source_quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
      FOREIGN KEY(target_quote_id) REFERENCES quotes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_quote_links_target ON quote_links(target_quote_id);
  `);

  // 增量同步历史存量引用（首次启动时的明文回填，用标记位而非"表是否为空"判断，
  // 避免数据库从加密状态迁移而来、明文回填本就不完整却被误判为"已完成"）
  try {
    if (getMetaFlag('links_backfill_plain_done') !== '1') {
      const allQ = db.prepare(`SELECT id, content, created_at FROM quotes WHERE content NOT LIKE 'ENC:%'`).all();
      for (const q of allQ) syncQuoteLinks(q.id, null, q.content, q.created_at);
      const allTh = db.prepare(`SELECT id, quote_id, content, created_at FROM thoughts WHERE content NOT LIKE 'ENC:%'`).all();
      for (const th of allTh) syncQuoteLinks(th.quote_id, th.id, th.content, th.created_at);
      setMetaFlag('links_backfill_plain_done', '1');
    }
  } catch (e) {}
}

function extractQuoteRefs(text) {
  if (!text) return [];
  const refs = [];
  const regex = /\[quote:([a-zA-Z0-9_\-\.]+)(?:\|[^\]]*)?\]/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    refs.push(m[1]);
  }
  return [...new Set(refs)];
}

function syncQuoteLinks(sourceQuoteId, sourceThoughtId, plainText, createdAt = Date.now()) {
  if (!db || !sourceQuoteId) return;
  const targetIds = extractQuoteRefs(plainText);
  if (sourceThoughtId) {
    db.prepare(`DELETE FROM quote_links WHERE source_quote_id = ? AND source_thought_id = ?`).run(sourceQuoteId, sourceThoughtId);
  } else {
    db.prepare(`DELETE FROM quote_links WHERE source_quote_id = ? AND source_thought_id IS NULL`).run(sourceQuoteId);
  }
  if (targetIds.length > 0) {
    const insertStmt = db.prepare(`INSERT OR IGNORE INTO quote_links (source_quote_id, target_quote_id, source_thought_id, created_at) VALUES (?, ?, ?, ?)`);
    for (const targetId of targetIds) {
      if (targetId !== sourceQuoteId) {
        insertStmt.run(sourceQuoteId, targetId, sourceThoughtId || null, createdAt);
      }
    }
  }
}

function normalizeTag(tag) {
  return tag.replace(/^[#]+/, '').replace(/／/g, '/').split('/').map(s => s.trim()).filter(Boolean).join('/');
}

// 后端侧纵深防御：剥离 HTML 标签后判断内容是否实质为空
// 单纯 .trim() 无法识别 "<p></p>" 这类仅含格式标记的空内容
function isHtmlContentEmpty(raw) {
  if (!raw) return true;
  const stripped = String(raw).replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
  return stripped.length === 0;
}

// 统一调度执行命令
async function handleInvoke(cmd, args = {}, electronHelpers = {}) {
  switch (cmd) {
    case 'get_backlinks': {
      const targetId = args.quoteId;
      if (!targetId) return [];
      const rows = db.prepare(`
        SELECT 
          ql.source_quote_id, ql.source_thought_id, ql.created_at,
          q.content AS quote_content, q.source AS quote_source, q.is_question,
          th.content AS thought_content
        FROM quote_links ql
        JOIN quotes q ON ql.source_quote_id = q.id
        LEFT JOIN thoughts th ON ql.source_thought_id = th.id
        WHERE ql.target_quote_id = ?
        ORDER BY ql.created_at DESC
      `).all(targetId);

      return rows.map(r => {
        const rawContent = r.source_thought_id && r.thought_content ? decryptText(r.thought_content) : decryptText(r.quote_content);
        const cleanSnippet = (rawContent || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
        return {
          source_quote_id: r.source_quote_id,
          source_thought_id: r.source_thought_id || null,
          is_question: r.is_question,
          quote_source: r.quote_source ? decryptText(r.quote_source) : null,
          context_snippet: cleanSnippet.slice(0, 160) + (cleanSnippet.length > 160 ? '...' : ''),
          created_at: r.created_at
        };
      });
    }

    case 'get_quotes': {
      const onlyQ = args.onlyQuestions === true;
      const tagPrefix = args.tag ? normalizeTag(args.tag) : null;
      const search = args.search ? args.search.trim().toLowerCase() : null;
      const cursor = typeof args.cursor === 'number' ? args.cursor : null;
      const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 35;
      const isAll = args.all === true;

      let baseSql = `FROM quotes q`;
      const conditions = [];
      const params = {};

      if (tagPrefix) {
        // 使用子查询进行前缀过滤，避免多标签卡片产生笛卡尔积重复行导致虚拟滚动报错
        conditions.push(` q.id IN (
          SELECT qt.quote_id FROM quote_tags qt 
          JOIN tags t ON qt.tag_id = t.id 
          WHERE t.name = @tagPrefix OR t.name LIKE @tagLike
        ) `);
        params.tagPrefix = tagPrefix;
        params.tagLike = `${tagPrefix}/%`;
      }

      if (args.entryType !== undefined && args.entryType !== 'all') {
        conditions.push(` q.is_question = @entryType `);
        params.entryType = args.entryType;
      } else if (onlyQ) {
        conditions.push(` q.is_question = 1 `);
      }

      // 性能优化：在未设置密码锁（明文状态）时，直接下推到 SQLite SQL 引擎，发挥 B-Tree 索引与游标早停优势
      const canSqlSearch = Boolean(search && !masterKey);
      if (canSqlSearch) {
        conditions.push(` (
          q.content LIKE @searchLike 
          OR (q.source IS NOT NULL AND q.source LIKE @searchLike)
          OR EXISTS (SELECT 1 FROM thoughts th WHERE th.quote_id = q.id AND th.content LIKE @searchLike)
        ) `);
        params.searchLike = `%${search}%`;
      }

      // 明文可下推搜索场景沿用 SQL 游标（时间戳）；密文加密场景改用"已匹配条数"内存游标，
      // 因为密文必须逐条解密才能判断是否匹配，无法用 created_at 在 SQL 层早停
      const needsMemoryFilter = Boolean(search && !canSqlSearch);

      if (cursor && !needsMemoryFilter) {
        conditions.push(` q.created_at < @cursor `);
        params.cursor = cursor;
      }

      const whereClause = conditions.length > 0 ? ` WHERE ` + conditions.join(' AND ') : '';

      // 统计总数 (毫秒级 B-Tree 快速扫描)；密文加密+搜索场景下 SQL 层无法感知关键词，
      // 必须逐条解密后在内存中统计真实匹配总数 (见下方 memoryTotalCount)
      let totalCount = 0;
      if (!needsMemoryFilter) {
        try {
          const countRow = db.prepare(`SELECT COUNT(DISTINCT q.id) as total ${baseSql} ${whereClause}`).get(params);
          totalCount = countRow ? countRow.total : 0;
        } catch (e) {
          totalCount = 0;
        }
      }

      let dataSql = `
        SELECT 
          q.id, q.content, q.source, q.is_question, q.is_resolved, q.created_at,
          (SELECT COUNT(DISTINCT ql.source_quote_id) FROM quote_links ql WHERE ql.target_quote_id = q.id) AS backlinks_count,
          (SELECT COALESCE(json_group_array(t.name), '[]') FROM quote_tags qt JOIN tags t ON qt.tag_id = t.id WHERE qt.quote_id = q.id) AS tags_json,
          (SELECT COALESCE(json_group_array(json_object('id', th.id, 'quote_id', th.quote_id, 'content', th.content, 'created_at', th.created_at, 'updated_at', th.updated_at)), '[]') FROM thoughts th WHERE th.quote_id = q.id ORDER BY th.created_at ASC) AS thoughts_json
        ${baseSql} ${whereClause}
        ORDER BY q.created_at DESC
      `;

      // 非全量且无需内存解密后置扫描时，直接由 SQLite 游标限制返回条数，彻底释放 CPU
      if (!needsMemoryFilter && !isAll) {
        dataSql += ` LIMIT ${limit + 1} `;
      }

      const stmt = db.prepare(dataSql);
      const result = [];
      let hasMore = false;
      let nextCursor = null;

      // 密文加密+搜索场景：cursor 语义改为"此前分页已消费的匹配条数"，而非时间戳，
      // 从而在无法使用 SQL 早停的情况下，依然能正确跳过前面页面已返回的匹配项，杜绝重复数据
      const memorySkip = needsMemoryFilter && cursor ? cursor : 0;
      let memoryTotalCount = 0;

      // 使用流式迭代器 (iterate)，匹配足够数量即时早停 (Early-Exit)
      for (const r of stmt.iterate(params)) {
        const content = decryptText(r.content);
        const source = r.source ? decryptText(r.source) : null;
        const tags = JSON.parse(r.tags_json || '[]');
        const rawThoughts = JSON.parse(r.thoughts_json || '[]');
        const thoughts = rawThoughts.map(t => ({
          ...t,
          content: decryptText(t.content)
        }));

        // 仅在加密密文场景下才在 Node 内存执行后置逐条校验；明文状态已在 SQL 层过滤，直接放行
        if (needsMemoryFilter) {
          const matchC = content.toLowerCase().includes(search);
          const matchS = source ? source.toLowerCase().includes(search) : false;
          const matchT = thoughts.some(t => t.content.toLowerCase().includes(search));
          if (!matchC && !matchS && !matchT) continue;

          // 命中一条真实匹配：计入全局总数，并按 memorySkip 跳过前面页面已返回过的条目
          memoryTotalCount++;
          if (!isAll && memoryTotalCount <= memorySkip) continue;
        }

        if (!isAll && result.length >= limit) {
          hasMore = true;
          if (!needsMemoryFilter) break; // 明文场景 SQL 已用 LIMIT+1 早停，可直接跳出
          continue; // 密文场景仍需继续扫描剩余行，以统计 memoryTotalCount 的准确值
        }

        result.push({
          id: r.id,
          content,
          source,
          is_question: r.is_question,
          is_resolved: r.is_resolved,
          created_at: r.created_at,
          backlinks_count: r.backlinks_count || 0,
          tags,
          thoughts
        });
      }

      if (needsMemoryFilter) {
        totalCount = memoryTotalCount;
        // 密文场景 nextCursor 记为"累计已消费的匹配条数"，供下一页 memorySkip 使用
        if (result.length > 0) {
          nextCursor = memorySkip + result.length;
        }
      } else if (result.length > 0) {
        nextCursor = result[result.length - 1].created_at;
      }

      if (isAll) {
        return result; // 维持备份等全局操作的纯数组兼容
      }

      return {
        items: result,
        next_cursor: nextCursor,
        has_more: hasMore,
        total_count: totalCount
      };
    }

    case 'create_quote_with_thought': {
      if (isHtmlContentEmpty(args.content)) {
        throw new Error("原句内容不能为空");
      }
      const qId = crypto.randomUUID();
      const now = Date.now();
      const qType = args.entryType !== undefined ? args.entryType : (args.isQuestion ? 1 : 0);
      const encContent = encryptText(args.content);
      const encSource = args.source ? encryptText(args.source) : null;

      const insertQuote = db.prepare(`INSERT INTO quotes (id, content, source, is_question, is_resolved, created_at) VALUES (?, ?, ?, ?, 0, ?)`);
      const insertThought = db.prepare(`INSERT INTO thoughts (id, quote_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`);
      const insertTag = db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`);
      const getTagId = db.prepare(`SELECT id FROM tags WHERE name = ?`);
      const insertQuoteTag = db.prepare(`INSERT OR IGNORE INTO quote_tags (quote_id, tag_id) VALUES (?, ?)`);

      db.transaction(() => {
        insertQuote.run(qId, encContent, encSource, qType, now);
        syncQuoteLinks(qId, null, args.content, now);
        if (args.thought && args.thought.trim()) {
          const thId = crypto.randomUUID();
          insertThought.run(thId, qId, encryptText(args.thought.trim()), now, now);
          syncQuoteLinks(qId, thId, args.thought.trim(), now);
        }
        for (const rawTag of args.tags || []) {
          const clean = normalizeTag(rawTag);
          if (!clean) continue;
          insertTag.run(clean);
          const row = getTagId.get(clean);
          if (row) insertQuoteTag.run(qId, row.id);
        }
      })();

      return qId;
    }

    case 'append_thought': {
      if (isHtmlContentEmpty(args.content)) {
        throw new Error("思考内容不能为空");
      }
      const thId = crypto.randomUUID();
      const now = Date.now();
      db.prepare(`INSERT INTO thoughts (id, quote_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
        thId, args.quoteId, encryptText(args.content.trim()), now, now
      );
      syncQuoteLinks(args.quoteId, thId, args.content.trim(), now);
      return thId;
    }

    case 'update_thought': {
      if (isHtmlContentEmpty(args.content)) {
        throw new Error("思考内容不能为空");
      }
      db.prepare(`UPDATE thoughts SET content = ?, updated_at = ? WHERE id = ?`).run(
        encryptText(args.content.trim()), Date.now(), args.thoughtId
      );
      const thRow = db.prepare(`SELECT quote_id FROM thoughts WHERE id = ?`).get(args.thoughtId);
      if (thRow) syncQuoteLinks(thRow.quote_id, args.thoughtId, args.content.trim(), Date.now());
      return null;
    }

    case 'delete_thought': {
      db.prepare(`DELETE FROM quote_links WHERE source_thought_id = ?`).run(args.thoughtId);
      db.prepare(`DELETE FROM thoughts WHERE id = ?`).run(args.thoughtId);
      return null;
    }

    case 'update_quote': {
      if (isHtmlContentEmpty(args.content)) {
        throw new Error("原句内容不能为空");
      }
      const qType = args.entryType !== undefined ? args.entryType : (args.isQuestion ? 1 : 0);
      db.prepare(`UPDATE quotes SET content = ?, source = ?, is_question = ? WHERE id = ?`).run(
        encryptText(args.content.trim()), args.source ? encryptText(args.source.trim()) : null, qType, args.quoteId
      );
      syncQuoteLinks(args.quoteId, null, args.content.trim(), Date.now());
      return null;
    }

    case 'delete_quote': {
      db.transaction(() => {
        db.prepare(`DELETE FROM quote_tags WHERE quote_id = ?`).run(args.quoteId);
        db.prepare(`DELETE FROM thoughts WHERE quote_id = ?`).run(args.quoteId);
        db.prepare(`DELETE FROM quotes WHERE id = ?`).run(args.quoteId);
      })();
      return null;
    }

    case 'toggle_resolved': {
      const row = db.prepare(`SELECT is_resolved FROM quotes WHERE id = ?`).get(args.quoteId);
      const newStatus = row && row.is_resolved === 1 ? 0 : 1;
      db.prepare(`UPDATE quotes SET is_resolved = ? WHERE id = ?`).run(newStatus, args.quoteId);
      return newStatus;
    }

    case 'add_tag_to_quote': {
      const clean = normalizeTag(args.tagName || '');
      if (!clean) return null;
      db.transaction(() => {
        db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`).run(clean);
        if (args.quoteId && args.quoteId.trim()) {
          const row = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(clean);
          if (row) db.prepare(`INSERT OR IGNORE INTO quote_tags (quote_id, tag_id) VALUES (?, ?)`).run(args.quoteId, row.id);
        }
      })();
      return null;
    }

    case 'remove_tag_from_quote': {
      const clean = normalizeTag(args.tagName || '');
      db.prepare(`DELETE FROM quote_tags WHERE quote_id = ? AND tag_id IN (SELECT id FROM tags WHERE name = ?)`).run(args.quoteId, clean);
      return null;
    }

    case 'get_tag_stats': {
      return db.prepare(`
        SELECT t.id, t.name, COUNT(qt.quote_id) as count 
        FROM tags t LEFT JOIN quote_tags qt ON t.id = qt.tag_id 
        GROUP BY t.id, t.name ORDER BY count DESC, t.name ASC
      `).all();
    }

    case 'get_resurface_quote': {
      const now = Date.now();
      const dayMs = 86400000;
      const halfYear = now - 180 * dayMs;
      const hundredDays = now - 100 * dayMs;

      let row = db.prepare(`SELECT id FROM quotes WHERE is_question = 1 AND is_resolved = 0 AND created_at <= ? ORDER BY RANDOM() LIMIT 1`).get(halfYear);
      let reasonTag = "半年前的待解之问";

      if (!row) {
        row = db.prepare(`SELECT q.id FROM quotes q LEFT JOIN thoughts t ON q.id = t.quote_id WHERE q.is_question = 0 AND q.created_at <= ? GROUP BY q.id HAVING COUNT(t.id) <= 1 ORDER BY RANDOM() LIMIT 1`).get(hundredDays);
        reasonTag = "百日前的沉淀摘录";
      }
      if (!row) {
        row = db.prepare(`SELECT id FROM quotes ORDER BY RANDOM() LIMIT 1`).get();
        reasonTag = "年轮偶遇";
      }
      if (!row) return null;

      // 显式传入 { all: true } 获取全量纯数组，杜绝 quotesList.find 崩溃
      const quotesList = await handleInvoke('get_quotes', { all: true }, electronHelpers);
      const card = Array.isArray(quotesList) ? quotesList.find(c => c.id === row.id) : null;
      if (!card) return null;

      const daysAgo = Math.max(0, Math.floor((now - card.created_at) / dayMs));
      const promptTitle = card.is_question === 1 
        ? `${daysAgo} 天前你曾困惑于此，如今有了新的答案吗？`
        : (card.is_question === 2 ? `${daysAgo} 天前你曾萌发这一顿悟，如今有了新的演进吗？` : `${daysAgo} 天前你曾珍藏此句，如今有了新的体悟吗？`);

      return { card, prompt_title: promptTitle, days_ago: daysAgo, reason_tag: reasonTag };
    }

        case 'create_db_snapshot': {
      if (!db) return null;
      const userDir = electronHelpers.userDataPath || path.dirname(imagesDir);
      const backupsDir = path.join(userDir, 'backups');
      fs.mkdirSync(backupsDir, { recursive: true });
      const dateStr = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const targetPath = path.join(backupsDir, `thought_rings_snapshot_${dateStr}.db`);
      await db.backup(targetPath);
      return { filename: path.basename(targetPath), path: targetPath };
    }

    case 'open_user_data_folder': {
      if (electronHelpers.shell && electronHelpers.userDataPath) {
        await electronHelpers.shell.openPath(electronHelpers.userDataPath);
        return true;
      }
      return false;
    }

    case 'export_backup': {
      // 显式传入 { all: true } 获取全量纯数组，保证导出 records 结构的合法性
      const allQuotes = await handleInvoke('get_quotes', { all: true }, electronHelpers);
      const safeList = Array.isArray(allQuotes) ? allQuotes : (allQuotes.items || []);
      return JSON.stringify({
        app: "ThoughtRings",
        format_version: "2.0.0",
        exported_at: Date.now(),
        total_quotes: safeList.length,
        records: safeList
      }, null, 2);
    }

    case 'import_backup': {
      const data = JSON.parse(args.jsonStr);
      const list = data.records || data;
      let importedQ = 0, skippedQ = 0, importedT = 0, importedTags = 0;

      db.transaction(() => {
        for (const item of list) {
          const exists = db.prepare(`SELECT 1 FROM quotes WHERE id = ?`).get(item.id);
          if (exists) {
            skippedQ++;
          } else {
            const encC = encryptText(item.content);
            const encS = item.source ? encryptText(item.source) : null;
            db.prepare(`INSERT INTO quotes (id, content, source, is_question, is_resolved, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
              item.id, encC, encS, item.is_question || 0, item.is_resolved || 0, item.created_at || Date.now()
            );
            importedQ++;
          }

          for (const rawTag of item.tags || []) {
            const clean = normalizeTag(rawTag);
            if (!clean) continue;
            db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`).run(clean);
            const row = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(clean);
            if (row) db.prepare(`INSERT OR IGNORE INTO quote_tags (quote_id, tag_id) VALUES (?, ?)`).run(item.id, row.id);
            importedTags++;
          }

          for (const th of item.thoughts || []) {
            const thExists = db.prepare(`SELECT 1 FROM thoughts WHERE id = ?`).get(th.id);
            if (!thExists) {
              db.prepare(`INSERT INTO thoughts (id, quote_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
                th.id, item.id, encryptText(th.content), th.created_at || Date.now(), th.updated_at || Date.now()
              );
              importedT++;
            }
          }
        }
      })();

      return { imported_quotes: importedQ, skipped_quotes: skippedQ, imported_thoughts: importedT, imported_tags: importedTags };
    }

    case 'paste_clipboard_image': {
      if (electronHelpers.clipboard) {
        const img = electronHelpers.clipboard.readImage();
        if (!img.isEmpty()) {
          const filename = `${crypto.randomUUID()}.png`;
          const dest = path.join(imagesDir, filename);
          fs.writeFileSync(dest, img.toPNG());
          return filename;
        }
      }
      return null;
    }

    case 'read_system_clipboard': {
      return electronHelpers.clipboard ? electronHelpers.clipboard.readText() : "";
    }

    case 'get_security_settings': {
      const row = db.prepare(`SELECT is_locked, password_hash, salt FROM security_settings WHERE id = 1`).get();
      return { is_locked: row.is_locked === 1, password_hash: row.password_hash, salt: row.salt };
    }

    case 'save_security_settings': {
      // 若用户主动解除密码锁，必须在清空密钥前将数据库内所有密文全部解密并持久化还原为明文，杜绝历史数据锁死
      if (!args.isLocked && masterKey) {
        db.transaction(() => {
          const quotesWithEnc = db.prepare("SELECT id, content, source FROM quotes WHERE content LIKE 'ENC:%' OR source LIKE 'ENC:%'").all();
          const updateQuoteStmt = db.prepare("UPDATE quotes SET content = ?, source = ? WHERE id = ?");
          for (const q of quotesWithEnc) {
            updateQuoteStmt.run(decryptText(q.content), q.source ? decryptText(q.source) : null, q.id);
          }

          const thoughtsWithEnc = db.prepare("SELECT id, content FROM thoughts WHERE content LIKE 'ENC:%'").all();
          const updateThoughtStmt = db.prepare("UPDATE thoughts SET content = ? WHERE id = ?");
          for (const th of thoughtsWithEnc) {
            updateThoughtStmt.run(decryptText(th.content), th.id);
          }
        })();
      }

      // 若用户新开启密码锁，必须先挂载本次会话密钥，再将数据库内所有历史明文全部加密落盘，杜绝旧数据裸奔
      if (args.isLocked && args.sessionKeyHex) {
        setMasterKeyFromHex(args.sessionKeyHex);
        db.transaction(() => {
          const quotesPlain = db.prepare("SELECT id, content, source FROM quotes WHERE content NOT LIKE 'ENC:%' OR (source IS NOT NULL AND source NOT LIKE 'ENC:%')").all();
          const updateQuoteStmt = db.prepare("UPDATE quotes SET content = ?, source = ? WHERE id = ?");
          for (const q of quotesPlain) {
            const newContent = q.content && q.content.startsWith('ENC:') ? q.content : encryptText(q.content);
            const newSource = q.source ? (q.source.startsWith('ENC:') ? q.source : encryptText(q.source)) : null;
            updateQuoteStmt.run(newContent, newSource, q.id);
          }

          const thoughtsPlain = db.prepare("SELECT id, content FROM thoughts WHERE content NOT LIKE 'ENC:%'").all();
          const updateThoughtStmt = db.prepare("UPDATE thoughts SET content = ? WHERE id = ?");
          for (const th of thoughtsPlain) {
            updateThoughtStmt.run(encryptText(th.content), th.id);
          }
        })();
      }

      db.prepare(`UPDATE security_settings SET is_locked = ?, password_hash = ?, salt = ? WHERE id = 1`).run(
        args.isLocked ? 1 : 0, args.passwordHash, args.salt
      );
      if (!args.isLocked) {
        clearMasterKey();
      }
      return null;
    }

    case 'unlock_vault_session': {
      setMasterKeyFromHex(args.sessionKeyHex);
      maybeBackfillQuoteLinksAfterUnlock();
      return null;
    }

    case 'lock_vault_session': {
      clearMasterKey();
      return null;
    }

    case 'get_system_fonts': {
      return [
        "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC",
        "Source Han Sans SC", "Songti SC", "SimSun", "SF Pro Text", "Segoe UI",
        "Helvetica Neue", "Arial", "Georgia", "JetBrains Mono"
      ];
    }

    case 'clean_orphan_images': {
      if (!imagesDir || !fs.existsSync(imagesDir)) {
        return { deleted_count: 0, freed_bytes: 0 };
      }
      const quotesRows = db.prepare(`SELECT content FROM quotes`).all();
      const thoughtsRows = db.prepare(`SELECT content FROM thoughts`).all();
      const usedImages = new Set();
      const imgRegex = /!\[.*?\]\(img:([a-zA-Z0-9_\-\.]+)\)/g;

      const scanContent = (raw) => {
        if (!raw) return;
        const plain = decryptText(raw);
        let match;
        while ((match = imgRegex.exec(plain)) !== null) {
          usedImages.add(match[1]);
        }
      };

      for (const q of quotesRows) scanContent(q.content);
      for (const th of thoughtsRows) scanContent(th.content);

      const files = fs.readdirSync(imagesDir);
      let deletedCount = 0;
      let freedBytes = 0;

      for (const file of files) {
        if (!usedImages.has(file)) {
          try {
            const filePath = path.join(imagesDir, file);
            const stat = fs.statSync(filePath);
            if (stat.isFile()) {
              freedBytes += stat.size;
              fs.unlinkSync(filePath);
              deletedCount++;
            }
          } catch (e) {
            console.error(`删除孤立图片失败: ${file}`, e);
          }
        }
      }
      return { deleted_count: deletedCount, freed_bytes: freedBytes };
    }

    case 'save_image_base64': {
      const rawBase64 = args.base64Data || '';
      const match = rawBase64.match(/^data:image\/([a-zA-Z0-9_\-\+]+);base64,(.+)$/);
      let ext = (args.extHint || 'png').toLowerCase().replace(/^\./, '');
      let data = rawBase64;
      if (match) {
        if (match[1]) ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        data = match[2];
      }
      const filename = `${crypto.randomUUID()}.${ext}`;
      const dest = path.join(imagesDir, filename);
      fs.writeFileSync(dest, Buffer.from(data, 'base64'));
      return filename;
    }

    case 'save_image_from_file_path': {
      const srcPath = args.pathStr;
      if (!srcPath || !fs.existsSync(srcPath)) throw new Error("指定源图片文件不存在");
      const ext = path.extname(srcPath).replace(/^\./, '') || 'png';
      const filename = `${crypto.randomUUID()}.${ext}`;
      const dest = path.join(imagesDir, filename);
      fs.copyFileSync(srcPath, dest);
      return filename;
    }

    case 'get_image_base64': {
      const safeName = path.basename(args.filename || '');
      if (!safeName) return null;
      const targetPath = path.join(imagesDir, safeName);
      if (!fs.existsSync(targetPath)) return null;
      const ext = path.extname(safeName).toLowerCase().replace(/^\./, '');
      const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : (ext === 'gif' ? 'image/gif' : 'image/png'));
      const buffer = fs.readFileSync(targetPath);
      return `data:${mime};base64,${buffer.toString('base64')}`;
    }

    case 'get_image_asset_path': {
      const safeName = path.basename(args.filename || '');
      return path.join(imagesDir, safeName);
    }

    case 'merge_tags': {
      const sourceClean = normalizeTag(args.sourceTag || '');
      const targetClean = normalizeTag(args.targetTag || '');
      if (!sourceClean || !targetClean || sourceClean === targetClean) return { affected_count: 0 };

      let affected = 0;
      db.transaction(() => {
        const srcRow = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(sourceClean);
        if (!srcRow) return;

        db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`).run(targetClean);
        const tgtRow = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(targetClean);
        if (!tgtRow) return;

        const countRow = db.prepare(`SELECT COUNT(quote_id) as c FROM quote_tags WHERE tag_id = ?`).get(srcRow.id);
        affected = countRow ? countRow.c : 0;

        // 转移手记关联至目标标签 (INSERT OR IGNORE 自动去重)
        db.prepare(`
          INSERT OR IGNORE INTO quote_tags (quote_id, tag_id)
          SELECT quote_id, ? FROM quote_tags WHERE tag_id = ?
        `).run(tgtRow.id, srcRow.id);

        // 清理源标签关联与自身
        db.prepare(`DELETE FROM quote_tags WHERE tag_id = ?`).run(srcRow.id);
        db.prepare(`DELETE FROM tags WHERE id = ?`).run(srcRow.id);
      })();
      return { affected_count: affected };
    }

    case 'prune_empty_tags': {
      let deleted = 0;
      db.transaction(() => {
        const emptyRows = db.prepare(`
          SELECT t.id FROM tags t 
          LEFT JOIN quote_tags qt ON t.id = qt.tag_id 
          WHERE qt.quote_id IS NULL
        `).all();
        deleted = emptyRows.length;
        db.prepare(`
          DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM quote_tags)
        `).run();
      })();
      return { deleted_count: deleted };
    }

    case 'rename_tag': {
      const oldClean = normalizeTag(args.oldName || '');
      const newClean = normalizeTag(args.newName || '');
      if (!oldClean || !newClean || oldClean === newClean) return null;

      db.transaction(() => {
        const oldRow = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(oldClean);
        if (!oldRow) return;

        const newRow = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(newClean);
        if (newRow) {
          db.prepare(`
            INSERT OR IGNORE INTO quote_tags (quote_id, tag_id)
            SELECT quote_id, ? FROM quote_tags WHERE tag_id = ?
          `).run(newRow.id, oldRow.id);
          db.prepare(`DELETE FROM quote_tags WHERE tag_id = ?`).run(oldRow.id);
          db.prepare(`DELETE FROM tags WHERE id = ?`).run(oldRow.id);
        } else {
          db.prepare(`UPDATE tags SET name = ? WHERE id = ?`).run(newClean, oldRow.id);
        }
      })();
      return null;
    }

    case 'delete_tag': {
      const clean = normalizeTag(args.tagName || '');
      if (!clean) return null;
      db.transaction(() => {
        const row = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(clean);
        if (row) {
          db.prepare(`DELETE FROM quote_tags WHERE tag_id = ?`).run(row.id);
          db.prepare(`DELETE FROM tags WHERE id = ?`).run(row.id);
        }
      })();
      return null;
    }

    case 'get_timeline_stats': {
      const quotesByDay = db.prepare(`
        SELECT 
          strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', 'localtime')) as day,
          COUNT(*) as count
        FROM quotes GROUP BY day ORDER BY day DESC
      `).all();

      const thoughtsByDay = db.prepare(`
        SELECT 
          strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', 'localtime')) as day,
          COUNT(*) as count
        FROM thoughts GROUP BY day ORDER BY day DESC
      `).all();

      return { quotes: quotesByDay, thoughts: thoughtsByDay };
    }

    case 'export_markdown_vault': {
      const allQuotes = await handleInvoke('get_quotes', { all: true }, electronHelpers);
      let md = `# ThoughtRings 终生手记知识库全量导出\n\n`;
      md += `> 导出时间：${new Date().toLocaleString()}\n`;
      md += `> 档案格式：CommonMark + YAML Frontmatter (兼容 Obsidian / Logseq / 纯文本)\n\n---\n\n`;

      for (const q of allQuotes) {
        const d = new Date(q.created_at).toISOString();
        const typeStr = q.is_question === 1 ? '待解之问' : (q.is_question === 2 ? '原生感悟' : '客观摘录');
        md += `## [${typeStr}] ${q.source ? q.source : '未命名出处'}\n\n`;
        md += `\`\`\`yaml\nid: "${q.id}"\ncreated_at: "${d}"\ntype: "${typeStr}"\nresolved: ${q.is_resolved === 1}\ntags: [${(q.tags || []).map(t => `"${t}"`).join(', ')}]\n\`\`\`\n\n`;
        md += `### 典藏原句\n\n${q.content}\n\n`;
        if (q.source) {
          md += `*—— 出处：${q.source}*\n\n`;
        }

        if (q.thoughts && q.thoughts.length > 0) {
          md += `### 伴随思维年轮 (${q.thoughts.length} 层演进)\n\n`;
          for (let i = 0; i < q.thoughts.length; i++) {
            const th = q.thoughts[i];
            const thDate = new Date(th.created_at).toISOString();
            md += `#### 年轮 #${i + 1} (${thDate})\n\n${th.content}\n\n`;
          }
        }
        md += `\n---\n\n`;
      }
      return md;
    }

    default:
      console.warn(`[Electron IPC] 未处理的调用命令: ${cmd}`);
      return null;
  }
}

module.exports = { initDatabase, handleInvoke };
