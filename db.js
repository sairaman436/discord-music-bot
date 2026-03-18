const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const logger = require('./utils/logger');

let db;

// We export a pseudo "pool" that matches the mysql2 API we used before
// so we don't have to change index.js
const pool = {
    execute: async (query, params = []) => {
        if (!db) await initDB();

        // Convert MySQL ? to SQLite ?
        const isSelect = query.trim().toUpperCase().startsWith('SELECT');

        try {
            if (isSelect) {
                const rows = await db.all(query, params);
                return [rows]; // Return array containing rows to match mysql2 [rows, fields]
            } else {
                const result = await db.run(query, params);
                return [result]; // Return result for INSERT/UPDATE/DELETE
            }
        } catch (err) {
            throw err;
        }
    }
};

async function initDB() {
    try {
        const dbPath = path.join(__dirname, 'data', 'database.sqlite');

        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        logger.info('✅ Connected to local SQLite database');

        // Instead of AUTO_INCREMENT, SQLite uses AUTOINCREMENT
        // Also TIMESTAMP defaults are slightly different but CURRENT_TIMESTAMP works
        await db.exec(`
            CREATE TABLE IF NOT EXISTS favorites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                uri TEXT NOT NULL,
                thumbnail TEXT,
                searchQuery TEXT NOT NULL,
                spotifyId TEXT,
                duration INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        logger.info('📊 Database tables initialized');
    } catch (err) {
        logger.error('❌ Database initialization failed:', err.message);
    }
}

module.exports = { pool, initDB };
