/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the Turbopack root to this project. Without it Next.js may select a parent
  // directory (for example the home directory) when other lockfiles exist above it.
  turbopack: {
    root: __dirname,
  },
};

module.exports = nextConfig;
