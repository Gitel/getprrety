require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const helmet   = require('helmet');

const authRoutes     = require('./routes/auth');
const profileRoutes  = require('./routes/profile');
const analysisRoutes = require('./routes/analysis');
const checkinRoutes  = require('./routes/checkins');
const productRoutes  = require('./routes/products');
const uploadRoutes   = require('./routes/uploads');
const activityRoutes = require('./routes/activity');
const skinScanRoutes = require('./routes/skinScan');
const aiRoutes       = require('./routes/ai');
const skinScanPoller = require('./jobs/skinScanPoller');

const app = express();
app.set('trust proxy', 1);

app.use(helmet());
const configuredOrigins = (process.env.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
const developmentOrigins = ['http://localhost:19006', 'http://localhost:8081', 'http://localhost:5173'];
const allowedOrigins = process.env.NODE_ENV === 'production' ? configuredOrigins : [...configuredOrigins, ...developmentOrigins];
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    const err = new Error('Origin not allowed');
    err.status = 403;
    return callback(err);
  },
}));

// Skin scan uploads contain up to three base64 images and have their own strict per-image checks.
// Keep the general API limit small so photos can never leak into analysis/profile documents again.
app.use('/api/skin-scan', express.json({ limit: '35mb' }), skinScanRoutes);
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Routes
app.use('/api/auth',      authRoutes);
app.use('/api/profile',   profileRoutes);
app.use('/api/analysis',  analysisRoutes);
app.use('/api/checkins',  checkinRoutes);
app.use('/api/products',  productRoutes);
app.use('/api/uploads',   uploadRoutes);
app.use('/api/activity',  activityRoutes);
app.use('/api/ai',        aiRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status
    || (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE' ? 413 : null)
    || (typeof err.code === 'string' && err.code.startsWith('LIMIT_') ? 400 : 500);
  res.status(status).json({ error: status === 413 ? 'Request payload is too large' : status === 403 ? 'Origin not allowed' : 'Internal server error' });
});

const PORT = process.env.PORT || 3001;

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    skinScanPoller.recoverPendingScans().catch(err => console.error('Skin scan recovery error:', err));
    setInterval(() => {
      skinScanPoller.recoverPendingScans().catch(err => console.error('Skin scan recovery error:', err));
    }, 30000).unref();
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
