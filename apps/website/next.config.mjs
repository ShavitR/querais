/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fully static export → deploy to any CDN / Vercel; the gateway never serves this and a
  // gateway outage never takes the site down (headline numbers are baked at build time).
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
