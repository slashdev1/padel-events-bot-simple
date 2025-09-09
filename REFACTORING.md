# Project Refactoring

This document describes the refactoring of the Padel Events Telegram Bot from a monolithic structure to a modular, class-based architecture.

## New Structure

### Classes Created

1. **Config** (`src/config/Config.js`)
   - Handles environment configuration and settings
   - Provides centralized access to environment variables
   - Includes utility methods for configuration validation

2. **Database** (`src/database/Database.js`)
   - Manages MongoDB connections and operations
   - Provides methods for all database interactions
   - Handles collections: games, users, chatSettings, globalSettings

3. **WebServer** (`src/webserver/WebServer.js`)
   - Manages Express server functionality
   - Handles webhook setup for Telegram bot
   - Provides basic web interface

4. **Bot** (`src/bot/Bot.js`)
   - Contains all Telegram bot logic and commands
   - Handles user interactions and game management
   - Manages bot lifecycle and webhook configuration

5. **Scheduler** (`src/scheduler/Scheduler.js`)
   - Manages cron jobs and scheduled tasks
   - Handles game notifications and cleanup
   - Provides centralized scheduling functionality

6. **PadelBotApp** (`app.js`)
   - Main application class that orchestrates all components
   - Handles application lifecycle and graceful shutdown
   - Coordinates between all other classes

## Benefits of Refactoring

1. **Separation of Concerns**: Each class has a single responsibility
2. **Maintainability**: Code is easier to understand and modify
3. **Testability**: Individual components can be tested in isolation
4. **Scalability**: New features can be added without affecting existing code
5. **Reusability**: Classes can be reused in different contexts

## File Structure

```
├── src/
│   ├── config/
│   │   └── Config.js
│   ├── database/
│   │   └── Database.js
│   ├── webserver/
│   │   └── WebServer.js
│   ├── bot/
│   │   └── Bot.js
│   └── scheduler/
│       └── Scheduler.js
├── app.js (new main file)
├── padel-events-bot-simple.js (legacy file)
├── package.json (updated with scripts)
└── REFACTORING.md (this file)
```

## Usage

### Running the Refactored Version
```bash
npm start
# or
npm run dev
```

### Running the Legacy Version
```bash
npm run legacy
```

## Migration Notes

- All original functionality is preserved
- Environment variables and configuration remain the same
- Database schema is unchanged
- Bot commands and behavior are identical
- The legacy file is kept for reference and fallback

## Future Improvements

1. Add unit tests for each class
2. Implement dependency injection
3. Add logging framework
4. Create configuration validation
5. Add error handling middleware
6. Implement health checks
