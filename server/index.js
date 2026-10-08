import app from './app.js';
import { scheduleBackups } from './backup.js';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`[api] revenue-tracker on http://localhost:${PORT}`);
  scheduleBackups();
});
