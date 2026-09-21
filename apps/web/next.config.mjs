/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  env: {
    NEXT_PUBLIC_APP_NAME: process.env.APP_NAME ?? 'Project ORBIT',
    NEXT_PUBLIC_BRAND_NAME: process.env.BRAND_NAME ?? 'Project ORBIT',
    NEXT_PUBLIC_API_BASE_URL: process.env.API_BASE_URL ?? 'http://localhost:3001',
  },
};

export default nextConfig;
