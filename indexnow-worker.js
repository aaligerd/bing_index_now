const pkg = require('pg');
const { configDotenv } = require('dotenv');
const { Pool } = pkg;

configDotenv();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const HOST = process.env.INDEXNOW_HOST;
const KEY = process.env.INDEXNOW_KEY;
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 20);
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchUnindexedArticles(client) {
  const res = await client.query(`
    SELECT id, link
    FROM news_articles
    WHERE bing_index_status = FALSE
    ORDER BY created_at ASC
    LIMIT $1
    FOR UPDATE SKIP LOCKED
  `, [BATCH_SIZE]);

  return res.rows;
}

async function submitToIndexNow(urls) {
  const payload = {
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: urls
  };

  const res = await fetch(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  console.log('IndexNow status:', res.status);

  if (![200, 202].includes(res.status)) {
    const text = await res.text();
    throw new Error(`IndexNow failed ${res.status}: ${text}`);
  }
}

async function markAsIndexed(client, ids) {
  await client.query(`
    UPDATE news_articles
    SET bing_index_status = TRUE
    WHERE id = ANY($1)
  `, [ids]);
}

async function runWorker() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const rows = await fetchUnindexedArticles(client);
    if (rows.length === 0) {
      console.log('🟢 No URLs to index');
      await client.query('COMMIT');
      return;
    }

    const urls = rows.map(r => r.link);
    const ids = rows.map(r => r.id);

    await submitToIndexNow(urls);
    await markAsIndexed(client, ids);

    await client.query('COMMIT');

    console.log(`✅ Indexed ${ids.length} URLs`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ IndexNow worker error:', err.message);
  } finally {
    client.release();
  }
}

/* =========================
   MAIN LOOP
========================= */

async function main() {
  console.log('🚀 IndexNow worker started');

  // run immediately on startup
  await runWorker();

  // then run every 10 minutes
  setInterval(async () => {
    await runWorker();
  }, INTERVAL_MS);
}

main();
