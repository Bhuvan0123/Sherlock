import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        globals: false,
        // The MCP server is a singleton-ish process (SQLite handle, env validation),
        // so tests run in isolated forks to avoid cross-file state bleed.
        pool: 'forks',
        testTimeout: 30_000,
        hookTimeout: 30_000
    }
});
