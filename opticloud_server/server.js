import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/database.js';
import fileRoutes from './routes/files.js';
import Agenda from 'agenda';
import { setupMigrationJob, setupRecoveryJob } from './jobs/migrationJob.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/files', fileRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize Agenda.js for job scheduling
let agenda;

const initializeAgenda = async () => {
  try {
    agenda = new Agenda({
      db: { address: process.env.MONGODB_URI || process.env.AGENDA_DB_URI }
    });

    agenda.on('ready', () => {
      console.log('Agenda.js is ready');
      
      // Setup migration jobs
      setupMigrationJob(agenda);
      setupRecoveryJob(agenda);
      
      // Start agenda
      agenda.start();
    });

    agenda.on('error', (error) => {
      console.error('Agenda error:', error);
    });

  } catch (error) {
    console.error('Failed to initialize Agenda:', error);
  }
};

// Start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // Initialize Agenda.js
    await initializeAgenda();
    
    // Start Express server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  if (agenda) {
    await agenda.stop();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  if (agenda) {
    await agenda.stop();
  }
  process.exit(0);
});

// Start the server
startServer();

export default app;
