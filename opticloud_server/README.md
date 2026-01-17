# OptiCloud Server

Reliable Migration Manager with Tier-Aware File Explorer backend server.

## Features

- **File Upload & Management**: Upload files to MongoDB Atlas using GridFS
- **Tier Management**: Automatic tier classification (HOT, WARM, COLD) based on access patterns
- **Reliable Migration**: Copy-Verify-Delete process with integrity checks
- **Queue Management**: Background job processing with Agenda.js
- **Retry Logic**: Exponential backoff retry for failed migrations
- **Concurrency Control**: File locking mechanism to prevent race conditions

## Prerequisites

- Node.js (v18 or higher)
- MongoDB Atlas account (or local MongoDB instance)
- npm or yarn

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory:
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/opticloud?retryWrites=true&w=majority
PORT=3001
NODE_ENV=development
AGENDA_DB_URI=mongodb+srv://username:password@cluster.mongodb.net/opticloud?retryWrites=true&w=majority
```

3. Update the MongoDB connection string with your Atlas credentials.

## Running the Server

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

The server will start on `http://localhost:3001` (or the port specified in `.env`).

## API Endpoints

### Files

- `GET /api/files` - Get all files
- `GET /api/files/:id` - Get file metadata by ID
- `GET /api/files/:id/download` - Download a file
- `POST /api/files/upload` - Upload a file (multipart/form-data)
- `DELETE /api/files/:id` - Delete a file
- `POST /api/files/:id/migrate` - Manually trigger migration for a file

### Health Check

- `GET /health` - Server health check

## Architecture

### Tier Evaluation Rules

- **HOT**: Files accessed within the last 30 days
- **WARM**: Files accessed 31-90 days ago
- **COLD**: Files accessed more than 90 days ago

### Migration Process

1. **Staging**: Identify candidate files for migration
2. **Binary Copy**: Stream file from source tier to target tier
3. **Integrity Check**: Calculate and compare MD5 hashes
4. **Commit**: If hashes match, delete source and update metadata
5. **Rollback**: If hashes don't match, delete target copy

### Background Jobs

- **Migration Job**: Runs every 5 minutes to migrate files between tiers
- **Recovery Job**: Runs every 10 minutes to recover stuck migrations

## Database Schema

The File model includes:
- `fileName`: Original file name
- `fileId`: GridFS file ID
- `currentTier`: Current storage tier (HOT/WARM/COLD)
- `checksum`: MD5 hash of file content
- `isLocked`: Lock flag for concurrency control
- `migrationStatus`: Current migration status (IDLE/PROCESSING/VERIFYING/FAILED)
- `retryAttempts`: Number of retry attempts
- `lastAccessDate`: Last access timestamp
- `lastMigrationDate`: Last migration timestamp

## Error Handling

- Files locked during migration return 409 Conflict
- Failed migrations are retried up to 3 times with exponential backoff
- Stuck migrations are automatically recovered on server restart

## Testing

To test the API, you can use tools like Postman or curl:

```bash
# Upload a file
curl -X POST http://localhost:3001/api/files/upload \
  -F "file=@test.txt"

# Get all files
curl http://localhost:3001/api/files

# Download a file
curl http://localhost:3001/api/files/:id/download -o downloaded_file.txt
```

## License

ISC
