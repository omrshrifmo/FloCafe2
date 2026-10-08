import { getDatabase, now, newId } from '../db';

export interface HaccpTaskInput {
  title: string;
  category: string; // 'cleaning' | 'temperature' | 'equipment' | 'hygiene' | 'allergen'
  stationId?: string;
  frequency: string; // 'daily' | 'per_shift' | 'weekly' | 'hourly'
  targetValue?: string;
  isActive?: boolean;
}

export interface HaccpLogInput {
  taskId: string;
  businessDate: string;
  shiftId?: number;
  status: 'passed' | 'failed' | 'warning' | 'skipped';
  measuredValue?: string;
  completedBy: string;
  correctiveAction?: string;
  notes?: string;
}

export function listHaccpTasks(
  db: ReturnType<typeof getDatabase>,
  options: { category?: string; stationId?: string; activeOnly?: boolean } = {}
) {
  const where: string[] = [];
  const params: any[] = [];

  if (options.activeOnly !== false) {
    where.push('is_active = 1');
  }
  if (options.category) {
    where.push('category = ?');
    params.push(options.category);
  }
  if (options.stationId) {
    where.push('station_id = ?');
    params.push(options.stationId);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM haccp_tasks ${whereClause} ORDER BY category, title`).all(...params);
}

export function createHaccpTask(db: ReturnType<typeof getDatabase>, input: HaccpTaskInput) {
  const id = newId('hcp');
  const timestamp = now();

  db.prepare(`
    INSERT INTO haccp_tasks (id, title, category, station_id, frequency, target_value, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.title,
    input.category,
    input.stationId || null,
    input.frequency,
    input.targetValue || null,
    input.isActive !== false ? 1 : 0,
    timestamp
  );

  return db.prepare('SELECT * FROM haccp_tasks WHERE id = ?').get(id);
}

export function recordHaccpLog(db: ReturnType<typeof getDatabase>, input: HaccpLogInput) {
  const id = newId('hcl');
  const timestamp = now();

  db.prepare(`
    INSERT INTO haccp_logs (
      id, task_id, business_date, shift_id, status, measured_value,
      completed_by, verified_by, corrective_action, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `).run(
    id,
    input.taskId,
    input.businessDate,
    input.shiftId || null,
    input.status,
    input.measuredValue || null,
    input.completedBy,
    input.correctiveAction || null,
    input.notes || null,
    timestamp
  );

  return db.prepare(`
    SELECT hl.*, ht.title as task_title, ht.category as task_category, ht.target_value
    FROM haccp_logs hl
    JOIN haccp_tasks ht ON ht.id = hl.task_id
    WHERE hl.id = ?
  `).get(id);
}

export function verifyHaccpLog(
  db: ReturnType<typeof getDatabase>,
  logId: string,
  verifiedBy: string,
  correctiveAction?: string
) {
  db.prepare(`
    UPDATE haccp_logs
    SET verified_by = ?, corrective_action = COALESCE(?, corrective_action)
    WHERE id = ?
  `).run(verifiedBy, correctiveAction || null, logId);

  return db.prepare('SELECT * FROM haccp_logs WHERE id = ?').get(logId);
}

export function getDailyHaccpReport(
  db: ReturnType<typeof getDatabase>,
  businessDate: string,
  shiftId?: number
) {
  const params: any[] = [businessDate];
  let shiftClause = '';
  if (shiftId) {
    shiftClause = 'AND hl.shift_id = ?';
    params.push(shiftId);
  }

  const logs = db.prepare(`
    SELECT hl.*, ht.title as task_title, ht.category as task_category, ht.target_value,
      u.name as completed_by_name, v.name as verified_by_name
    FROM haccp_logs hl
    JOIN haccp_tasks ht ON ht.id = hl.task_id
    LEFT JOIN users u ON u.id = hl.completed_by
    LEFT JOIN users v ON v.id = hl.verified_by
    WHERE hl.business_date = ? ${shiftClause}
    ORDER BY hl.created_at ASC
  `).all(...params);

  const total = logs.length;
  const passed = logs.filter((l: any) => l.status === 'passed').length;
  const failed = logs.filter((l: any) => l.status === 'failed').length;
  const warning = logs.filter((l: any) => l.status === 'warning').length;

  return {
    businessDate,
    shiftId: shiftId || null,
    totalCount: total,
    passedCount: passed,
    failedCount: failed,
    warningCount: warning,
    compliancePercent: total > 0 ? Math.round((passed / total) * 100) : 100,
    logs,
  };
}
