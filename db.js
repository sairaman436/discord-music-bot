const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

const dbPath = path.join(__dirname, 'data', 'favorites.json');

// Ensure database exists
function initDB() {
    try {
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
        if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({}));
        logger.info('📊 JSON Database initialized');
    } catch (e) {
        logger.error('❌ DB Init failed:', e.message);
    }
}

function readDB() {
    try {
        if (!fs.existsSync(dbPath)) return {};
        const data = fs.readFileSync(dbPath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
}

function writeDB(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

// Simple synchronous JSON database wrapper
const db = {
    addFavorite: (userId, track) => {
        const data = readDB();
        if (!data[userId]) data[userId] = [];

        // Check for duplicates using spotifyId
        if (track.spotifyId && data[userId].find(t => t.spotifyId === track.spotifyId)) {
            return false; // Already exists
        }

        // Generate a pseudo-ID based on the last item's ID
        const nextId = (data[userId][data[userId].length - 1]?.id || 0) + 1;
        data[userId].push({ id: nextId, ...track });

        writeDB(data);
        return true;
    },

    getFavorites: (userId) => {
        const data = readDB();
        return data[userId] || [];
    },

    removeFavorite: (userId, targetId) => {
        const data = readDB();
        if (!data[userId]) return false;

        const initialLen = data[userId].length;
        data[userId] = data[userId].filter(t => t.id !== targetId);

        if (data[userId].length !== initialLen) {
            writeDB(data);
            return true;
        }
        return false;
    }
};

module.exports = { db, initDB };
