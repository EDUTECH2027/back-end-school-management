# School Management API

Node.js / Express REST API backed by SQLite (via Node.js built-in `node:sqlite`).

## Quick Start

```bash
cd backend
npm install
node src/db/seed.js   # create & seed the database (run once)
npm run dev           # nodemon hot-reload on port 3001
# or
npm start             # production start
```

## Demo Credentials

| Role         | Email                    | Password      |
|--------------|--------------------------|---------------|
| Head Teacher | admin@edutech.com        | admin123      |
| Teacher      | teacher@edutech.com      | teacher123    |
| Secretary    | secretary@edutech.com    | secretary123  |

## Endpoint Reference

All routes are prefixed with `/api/` and require `Authorization: Bearer <token>` except `/api/auth/login`.

| Method | Path | Description |
|--------|------|-------------|
| POST   | /auth/login | Login, returns JWT token |
| GET    | /auth/me | Current user profile |
| PUT    | /auth/me/password | Change password |
| GET    | /dashboard | Aggregated stats |
| GET/PUT | /school | School info |
| GET/POST | /academic/years | Academic years |
| GET/POST | /academic/terms | Terms |
| GET    | /academic/grade-levels | Grade levels |
| GET/POST/PUT/DELETE | /subjects | Subjects |
| GET/POST/PUT/DELETE | /teachers | Teachers |
| GET/POST/PUT/DELETE | /classes | Classes |
| GET    | /classes/:id/students | Students in class |
| GET/POST/PUT/DELETE | /students | Students |
| GET/POST/PUT/DELETE | /parents | Parents |
| GET    | /attendance | Student attendance (filter: ?date=&classId=) |
| POST   | /attendance | Bulk upsert attendance |
| GET    | /attendance/stats | Monthly stats per student |
| GET    | /attendance/teachers | Teacher attendance |
| POST   | /attendance/teachers | Bulk upsert teacher attendance |
| GET/POST/PUT/DELETE | /timetable | Teacher schedule |
| GET/POST/PUT | /marks | Student marks |
| GET/POST/PUT | /report-cards | Report cards |
| PATCH  | /report-cards/:id/status | Change card status |
| GET/POST/PUT | /fees | Fee records |
| GET    | /fees/summary | Aggregated fee stats |
| POST   | /fees/:id/payments | Record a payment |
| GET    | /payroll?month=YYYY-MM | Payroll sheet for month |
| PUT    | /payroll/:teacherId/:month | Update payroll record |
| PATCH  | /payroll/:teacherId/:month/status | Change status |
| PATCH  | /payroll/:month/bulk-status | Bulk status update |
| GET/POST/PUT/DELETE | /announcements | Announcements |
| GET/POST/DELETE | /email-alerts | Email alerts |
| GET/POST/DELETE | /forums/threads | Forum threads |
| GET/POST/DELETE | /forums/threads/:id/messages | Forum messages |
| GET    | /health | Health check |

## Architecture

```
backend/
├── src/
│   ├── index.js          Main Express server
│   ├── db/
│   │   ├── database.js   DatabaseSync setup (node:sqlite)
│   │   ├── schema.js     CREATE TABLE statements
│   │   └── seed.js       Seed with mock data
│   ├── middleware/
│   │   ├── auth.js       JWT verification
│   │   └── errorHandler.js
│   └── routes/           One file per resource
├── data/
│   └── school.db         SQLite database (auto-created)
└── .env                  PORT, JWT_SECRET, DB_PATH, FRONTEND_URL
```
