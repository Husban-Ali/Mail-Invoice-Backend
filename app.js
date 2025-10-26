// Load env FIRST so downstream modules see populated process.env
require('./config/env');
const express = require("express");
const { getGoogleConfigStatus } = require('./config/env');
const cors = require("cors");
const bodyParser = require("body-parser");
const session = require("express-session");
const passport = require("./config/passport");
const authRoutes = require("./routes/authRoutes");
const invoiceRoutes = require("./routes/invoices.routes");
const accountRoutes = require("./routes/accounts.routes");
const retrievalRoutes = require('./routes/retrieval.routes');
const scrapedDataRoutes = require('./routes/scrapedData.routes');
const rulesRoutes = require('./routes/rules.routes');
const suppliersRoutes = require('./routes/suppliers.routes');
const utilsRoutes = require('./routes/utils.routes');
const uploadsRoutes = require('./routes/uploads.routes');
const exportsRoutes = require('./routes/exports.routes');
const protectRoute = require('./middlewares/authMiddleware');

const app = express();


const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  // Add your Vercel frontend URLs here
  'https://mail-invoice.vercel.app',
  'https://your-frontend.vercel.app'
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    // Allow all Vercel preview deployments
    if (origin && origin.includes('.vercel.app')) return cb(null, true);
    return cb(null, allowedOrigins.includes(origin));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));
app.use(bodyParser.json());
// Session must be before passport.session for OAuth to work reliably
app.use(
  session({
    name: 'mi.sid',
    secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      secure: false, // set true only behind HTTPS
      sameSite: 'lax'
    }
  })
);
// Minimal startup diagnostics
const googleStatus = getGoogleConfigStatus();
console.log('[startup] Features:', { googleOAuth: googleStatus.enabled });
app.use(passport.initialize());
app.use(passport.session());

// Simple health check
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Routes
app.use("/api/auth", authRoutes);
// Protected routes (require Supabase JWT)
app.use('/api/accounts', protectRoute, accountRoutes);
app.use("/api/invoices", protectRoute, invoiceRoutes);
app.use('/api/retrieval', protectRoute, retrievalRoutes);
app.use('/api/scraped-data', protectRoute, scrapedDataRoutes);
app.use('/api/rules', protectRoute, rulesRoutes);
app.use('/api/suppliers', protectRoute, suppliersRoutes);
app.use('/api/utils', protectRoute, utilsRoutes);
app.use('/api/uploads', protectRoute, uploadsRoutes);
app.use('/api/exports', protectRoute, exportsRoutes);

module.exports = app;
