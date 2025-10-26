# Vercel Deployment Guide - Mail Invoice Backend

## 🚀 Deployment Steps

### 1. Install Vercel CLI (if not installed)
```bash
npm install -g vercel
```

### 2. Login to Vercel
```bash
vercel login
```

### 3. Deploy from Backend folder
```bash
cd Backend
vercel
```

Follow the prompts:
- **Set up and deploy?** → Yes
- **Which scope?** → Select your account
- **Link to existing project?** → No (first time) or Yes (subsequent)
- **Project name?** → mail-invoice-backend
- **Directory?** → ./ (current directory)
- **Override settings?** → No

### 4. Set Environment Variables
Go to Vercel Dashboard → Your Project → Settings → Environment Variables

Add these variables:

```
SUPABASE_URL=https://bkvmqiznstcapyzxwash.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=https://bkvmqiznstcapyzxwash.supabase.co/auth/v1/callback
PORT=8080
RESEND_API_KEY=your_resend_api_key
EMAIL_FROM=alihusban458@gmail.com
EXPORTS_BUCKET=invoices
```

### 5. Deploy Production
```bash
vercel --prod
```

## 🔧 Update Frontend API URL

After deployment, update your frontend's `.env`:

```env
VITE_API_BASE_URL=https://your-backend.vercel.app
```

## ⚠️ Important Notes

### Limitations:
1. **Function Timeout**: Max 60 seconds (on Hobby/Pro plans)
   - IMAP email fetching may timeout for large mailboxes
   - Consider using Vercel Cron for scheduled fetching

2. **Memory Limit**: 1024MB default
   - Large PDF processing may fail
   - Monitor and optimize if needed

3. **Cold Starts**: First request will be slower (5-10s)

### Recommended:
- Use Vercel Cron for scheduled email fetching instead of real-time
- Keep file uploads under 50MB
- Monitor function execution time in Vercel dashboard

## 📊 Monitoring

Check logs:
```bash
vercel logs
```

Or visit: Vercel Dashboard → Project → Logs

## 🔄 CI/CD (Optional)

Connect your GitHub repository to Vercel for automatic deployments:
1. Go to Vercel Dashboard
2. Import Git Repository
3. Select your repo
4. Configure build settings
5. Auto-deploy on git push!

## 🆘 Troubleshooting

### Function Timeout
If IMAP fetch times out, use this approach:
```javascript
// Add to server.js
export const config = {
  maxDuration: 60, // Max 60 seconds on Pro plan
};
```

### Environment Variables Not Loading
- Verify all env vars are set in Vercel Dashboard
- Redeploy after adding new variables

### Cold Start Issues
- Add a keep-alive endpoint
- Ping it every 5 minutes using a cron service (cron-job.org)

## 🎉 Success!

Your backend is now live at: `https://your-backend.vercel.app`

Test it:
```bash
curl https://your-backend.vercel.app/health
```
