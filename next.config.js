/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  // Minimal config - no experimental features unless needed
  
  // Fix Turbopack root selection: explicitly set to project root
  // This prevents Next.js from incorrectly selecting /Users/stanislav as root
  // due to package-lock.json files outside the project directory
  // Note: In Next.js 16.1.1+, use top-level 'turbopack' key, not 'experimental.turbo'
  turbopack: {
    // Use project directory (where next.config.js is located) as absolute path
    root: __dirname,
  },
};

module.exports = nextConfig;

