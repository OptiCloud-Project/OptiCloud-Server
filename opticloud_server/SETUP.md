# הוראות הרצה - OptiCloud Server

## שלב 1: הגדרת MongoDB

1. צור קובץ `.env` בתיקיית `opticloud_server`
2. הוסף את ה-MongoDB connection string שלך:

```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/opticloud?retryWrites=true&w=majority
PORT=3001
NODE_ENV=development
AGENDA_DB_URI=mongodb+srv://username:password@cluster.mongodb.net/opticloud?retryWrites=true&w=majority
```

**חשוב:** החלף `username`, `password`, ו-`cluster` עם הפרטים שלך מ-MongoDB Atlas.

## שלב 2: התקנת Dependencies

```bash
cd OptiCloud-Server/opticloud_server
npm install
```

## שלב 3: הרצת השרת

### Development Mode (עם auto-reload):
```bash
npm run dev
```

### Production Mode:
```bash
npm start
```

השרת ירוץ על: `http://localhost:3001`

## בדיקת שהשרת עובד

פתח בדפדפן או ב-Postman:
```
http://localhost:3001/health
```

אמור להחזיר: `{"status":"ok","timestamp":"..."}`
