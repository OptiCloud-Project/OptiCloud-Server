# Setup Instructions - OptiCloud Server

## Step 1: MongoDB Setup

1. Create a `.env` file in the `opticloud_server` directory
2. Add your MongoDB connection string:

```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/opticloud?retryWrites=true&w=majority
PORT=3001
NODE_ENV=development
AGENDA_DB_URI=mongodb+srv://username:password@cluster.mongodb.net/opticloud?retryWrites=true&w=majority
```

**Important:** Replace `username`, `password`, and `cluster` with your details from MongoDB Atlas.

## Step 2: Install Dependencies

```bash
cd OptiCloud-Server/opticloud_server
npm install
```

## Step 3: Run the Server

### Development Mode (with auto-reload):
```bash
npm run dev
```

### Production Mode:
```bash
npm start
```

The server will run on: `http://localhost:3001`

## Test the Server

Open in browser or Postman:
```
http://localhost:3001/health
```

Should return: `{"status":"ok","timestamp":"..."}`
