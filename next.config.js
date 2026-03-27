/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/v1/:path*',
        destination: '/api/openai/v1/:path*',
      },
    ]
  },
}

module.exports = nextConfig
