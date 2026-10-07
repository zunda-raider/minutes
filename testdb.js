const { Client } = require("pg");

async function main() {
  // 練習用なので接続情報を直書き（本実装では .env.local を使う）
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  console.log("DBに接続できた");

  await client.query(
    "INSERT INTO minutes (title, body) VALUES ($1, $2)",
    ["Node.jsから保存", "スクリプトから書き込んだ本文"]
  );
  console.log("1件保存した");

  const result = await client.query(
    "SELECT id, title, created_at FROM minutes ORDER BY created_at DESC"
  );
  console.table(result.rows);

  await client.end();
}

main().catch((err) => {
  console.error("エラーの種類:", err.name);
  console.error("エラーコード:", err.code);
  console.error("全体:", err);
});