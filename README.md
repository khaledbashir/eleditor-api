# ElEditor API Server

Production-ready Node.js/Express API server for ElEditor with PostgreSQL backend.

## Features

- ✅ JWT Authentication
- ✅ PostgreSQL Database
- ✅ Cross-browser data synchronization
- ✅ Version history and backups
- ✅ Triple-redundancy storage system
- ✅ Health monitoring

## Deployment

### Easypanel Deployment

1. **Create PostgreSQL Service**
   - In Easypanel, create a new PostgreSQL service
   - Note the connection details

2. **Deploy API Server**
   - Create a new app from GitHub
   - Select this repository
   - Set environment variables (see below)

3. **Environment Variables**
   ```
   NODE_ENV=production
   PORT=3002
   DB_HOST=<postgres-service-name>
   DB_PORT=5432
   DB_NAME=eleditor
   DB_USER=eleditor_user
   DB_PASSWORD=<your-secure-password>
   JWT_SECRET=<your-jwt-secret>
   FRONTEND_URL=https://your-frontend-domain.com
   LOG_LEVEL=info
   ```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `GET /api/auth/verify` - Verify JWT token
- `POST /api/auth/logout` - User logout

### Data Sync
- `POST /api/sync` - Save data
- `GET /api/sync/:threadId` - Load data
- `GET /api/sync/:threadId/history` - Get version history
- `POST /api/sync/:threadId/restore` - Restore from backup
- `DELETE /api/sync/:threadId` - Delete data

### Health
- `GET /health` - Server health check

## Local Development

```bash
npm install
npm run build
npm start
```

## Database Setup

The schema will be automatically applied on first run, or you can manually apply:

```bash
psql -h localhost -U eleditor_user -d eleditor < database/schema.sql
```
