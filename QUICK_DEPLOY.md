# 🚀 Quick Deployment Guide

## Step 1: Install Vercel CLI
```bash
npm install -g vercel
```

## Step 2: Login to Vercel
```bash
vercel login
```

## Step 3: Deploy Backend
```bash
cd Backend
vercel
```

When prompted:
- Project name: `mail-invoice-backend`
- Directory: `./` (press enter)
- Override settings: No

## Step 4: Add Environment Variables in Vercel Dashboard

Go to: https://vercel.com/dashboard → Your Project → Settings → Environment Variables

Add these (copy from your `.env` file):

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_CALLBACK_URL
RESEND_API_KEY
EMAIL_FROM
EXPORTS_BUCKET
SESSION_SECRET
```

## Step 5: Deploy to Production
```bash
vercel --prod
```

## Step 6: Update Frontend

Update your frontend `.env`:
```env
VITE_API_BASE_URL=https://your-backend.vercel.app
```

Then deploy frontend:
```bash
cd ../Mail-Invoice
vercel --prod
```

## Step 7: Test

Visit:
- Backend health: `https://your-backend.vercel.app/healthz`
- Frontend: `https://your-frontend.vercel.app`

## ⚡ Quick Commands

```bash
# Deploy backend to production
cd Backend && vercel --prod

# Deploy frontend to production  
cd Mail-Invoice && vercel --prod

# View logs
vercel logs

# List deployments
vercel ls
```

## 🔧 Troubleshooting

### Environment Variables Not Working
1. Go to Vercel Dashboard
2. Settings → Environment Variables
3. Make sure they're set for "Production"
4. Redeploy: `vercel --prod`

### CORS Errors
- Make sure frontend URL is in `allowedOrigins` in `app.js`
- Vercel preview URLs (*.vercel.app) are automatically allowed

### Function Timeout
- Upgrade to Vercel Pro for 60s timeout
- Or move long tasks to background workers

## ✅ Done!

Your app is now live on Vercel! 🎉
