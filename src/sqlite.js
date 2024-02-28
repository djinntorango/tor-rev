const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const dbWrapper = require("sqlite");
const axios = require("axios");

// Initialize the database
const dbFile = "./.data/accessToken.db";
const exists = fs.existsSync(dbFile);

let db;

// Open the SQLite database
if (!exists) {
  db = new sqlite3.Database(dbFile);
  db.serialize(() => {
    // Create the access_token table
    db.run("CREATE TABLE access_token (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT)");
  });
} else {
  db = dbWrapper.open({
    filename: dbFile,
    driver: sqlite3.Database,
  });
}

// Function to store access token
async function storeAccessToken(token) {
  await db.run("INSERT INTO access_token (token) VALUES (?)", token);
}

// Function to fetch access token
async function getAccessToken() {
  const row = await db.get("SELECT * FROM access_token ORDER BY id DESC LIMIT 1");
  return row ? row.token : null;
}