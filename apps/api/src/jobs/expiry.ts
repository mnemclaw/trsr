import type { Server } from 'socket.io';
import { pool } from '../db.js';

export function startExpiryJob(io: Server): NodeJS.Timeout {
  return setInterval(async () => {
    const result = await pool.query(
      `UPDATE drops
       SET status = 'expired'
       WHERE expires_at < now() AND status = 'active'
       RETURNING id`,
    );
    for (const row of result.rows as { id: string }[]) {
      io.emit('drop:expired', { id: row.id });
    }
  }, 5 * 60 * 1000);
}
