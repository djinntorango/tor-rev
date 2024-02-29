// server.js isn't set up to interact with this yet


const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const dbWrapper = require("sqlite");
const axios = require("axios");

// Initialize the database
const dbFile = "./.data/accessToken.db";
const exists = fs.existsSync(dbFile);

let db;

// Open the SQLite database
const initializeDatabase = async () => {
  const dbFile = "./.data/choices.db";
  const exists = fs.existsSync(dbFile);
  let db;

  if (!exists) {
    db = await dbWrapper.open({
      filename: dbFile,
      driver: sqlite3.Database,
    });

    // Create your access_token table if it doesn't exist
    await db.exec(`
      CREATE TABLE IF NOT EXISTS access_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT NOT NULL
      );
    `);
  } else {
    db = await dbWrapper.open({
      filename: dbFile,
      driver: sqlite3.Database,
    });
  }

  return db;
};

const storeAccessToken = async (db, accessToken) => {
  // Insert the access token into the access_tokens table
  await db.run("INSERT INTO access_tokens (token) VALUES (?)", accessToken);
};

async function getAccessToken() {
  const row = await db.get("SELECT * FROM access_token ORDER BY id DESC LIMIT 1");
  return row ? row.token : null;
}

module.exports = {
  initializeDatabase,
  storeAccessToken,
  getAccessToken,
};