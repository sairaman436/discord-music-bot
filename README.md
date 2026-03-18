# Discord Music Bot (Production Ready)

A modern, robust Discord music bot built using Node.js, `discord.js` v14, `@discordjs/voice`, and Spotify/SoundCloud integration.

## Features
- 🎵 Plays music from Spotify & SoundCloud (Lavalink free!)
- 🤖 `/recommend` - AI-powered Spotify recommendations based on the current track
- 🌙 `/247` - 24/7 mode, keeps the bot in VC even when empty
- ❤️ `/favorite` - Custom favorite playlists per user
- 😴 `/sleeptimer` - Auto-disconnects after a set time
- 🎮 `/quiz` - Interactive music trivia game with Discord buttons
- 🚪 Auto-leaves VC when everyone else disconnects

## Setup
1.  Run `npm install` to install all dependencies.
2.  Set up your `.env` file (copy from `.env.example`). Provide the following keys:
    *   `DISCORD_TOKEN`
    *   `CLIENT_ID`
    *   `SPOTIFY_CLIENT_ID`
    *   `SPOTIFY_CLIENT_SECRET`
    *   `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
3.  **MySQL Database**: Ensure you have a MySQL database running. The bot will automatically create the `favorites` table on its first run if the credentials are correct.
4.  Deploy slash commands to your server by running `node deploy-commands.js`.
5.  Start the bot using `node index.js`.

## Hosting
This folder is fully separated from your development environment and is ready to be pushed to GitHub and hosted on platforms like Heroku, DigitalOcean, or Railway.

You can push to your own repository by running:
```bash
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```
