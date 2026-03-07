/** @type {import('next').NextConfig} */
const nextConfig = {
  // Note: 'output: export' removed to enable API routes
  // For Capacitor static builds, use 'next build && next export' separately
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', '.prisma/client'],
  },
  transpilePackages: ['@rad-assist/api', '@rad-assist/db', '@rad-assist/shared'],
  
  // Disable error overlay for browser extension errors
  devIndicators: {
    buildActivity: true,
    buildActivityPosition: 'bottom-right',
  },
  
  // Filter out browser extension errors from the overlay
  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },

  webpack: (config, { dev }) => {
    if (dev) {
      // Ignore errors from browser extensions
      config.ignoreWarnings = [
        { module: /chrome-extension/ },
        { message: /extension/ },
      ];
    }
    return config;
  },
};

module.exports = nextConfig;
