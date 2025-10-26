#!/bin/bash

# Vercel Deployment Script for Mail Invoice Backend
echo "🚀 Starting Vercel Deployment..."

# Check if vercel CLI is installed
if ! command -v vercel &> /dev/null
then
    echo "❌ Vercel CLI not found. Installing..."
    npm install -g vercel
fi

# Navigate to Backend directory
cd "$(dirname "$0")"

echo "📦 Current directory: $(pwd)"

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "ℹ️  Make sure to set environment variables in Vercel Dashboard"
fi

# Deploy to Vercel
echo "🌐 Deploying to Vercel..."
vercel --prod

echo "✅ Deployment complete!"
echo "🔗 Check your deployment at: https://vercel.com/dashboard"
echo ""
echo "⚙️  Don't forget to:"
echo "  1. Set environment variables in Vercel Dashboard"
echo "  2. Update frontend VITE_API_BASE_URL"
echo "  3. Test all endpoints after deployment"
