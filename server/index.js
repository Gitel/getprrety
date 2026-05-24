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

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3001;

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
