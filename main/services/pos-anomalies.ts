import crypto from 'crypto';
import { getDatabase } from '../db';

export interface PosAnomalyInput {
  event_type:
    | 'post_print_item_removed'
    | 'post_print_order_cancelled'
    | 'no_sale_drawer_open'
    | 'excessive_discount'
    | 'price_override_down'
    | 'post_checkout_void'
    | 'pre_blind_shortage';
  severity?: 'low' | 'medium' | 'high' | 'critical';
  risk_points?: number;
  order_id?: string | null;
  order_number?: string | null;
  bill_id?: string | null;
  shift_id?: string | null;
  actor_user_id?: string | null;
  actor_user_name?: string | null;
  actor_role?: string | null;
  item_name?: string | null;
  quantity?: number;
  amount_impact?: number;
  reason?: string | null;
  details_json?: any;
}

export function logPosAnomaly(dbOrInput: any, maybeInput?: PosAnomalyInput): any {
  let db: any;
  let input: PosAnomalyInput;

  if (maybeInput) {
    db = dbOrInput || getDatabase();
    input = maybeInput;
  } else if (dbOrInput && typeof dbOrInput.prepare === 'function') {
    db = dbOrInput;
    input = {} as any;
  } else {
    db = getDatabase();
    input = dbOrInput as PosAnomalyInput;
  }

  const id = `anom_${crypto.randomUUID()}`;

  // Default severity and risk points based on event type if not provided
  let severity = input?.severity;
  let riskPoints = input?.risk_points;

  if (!severity || !riskPoints) {
    switch (input?.event_type) {
      case 'post_print_item_removed':
      case 'post_print_order_cancelled':
      case 'post_checkout_void':
        severity = severity || 'critical';
        riskPoints = riskPoints ?? 25;
        break;
      case 'pre_blind_shortage':
        severity = severity || 'high';
        riskPoints = riskPoints ?? 20;
        break;
      case 'no_sale_drawer_open':
      case 'excessive_discount':
      case 'price_override_down':
      default:
        severity = severity || 'medium';
        riskPoints = riskPoints ?? 10;
        break;
    }
  }

  const detailsJsonStr = input.details_json
    ? (typeof input.details_json === 'string' ? input.details_json : JSON.stringify(input.details_json))
    : null;

  try {
    const stmt = db.prepare(`
      INSERT INTO pos_anomaly_logs (
        id, event_type, severity, risk_points,
        order_id, order_number, bill_id, shift_id,
        actor_user_id, actor_user_name, actor_role,
        item_name, quantity, amount_impact, reason, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    stmt.run(
      id,
      input.event_type,
      severity,
      riskPoints,
      input.order_id || null,
      input.order_number || null,
      input.bill_id || null,
      input.shift_id || null,
      input.actor_user_id || null,
      input.actor_user_name || null,
      input.actor_role || null,
      input.item_name || null,
      input.quantity || 0,
      input.amount_impact || 0,
      input.reason || null,
      detailsJsonStr
    );

    return db.prepare('SELECT * FROM pos_anomaly_logs WHERE id = ?').get(id);
  } catch (err) {
    console.error('[Anti-Theft] Error inserting anomaly log:', err);
    return null;
  }
}

export function getAntiTheftSummary(dbOrOptions?: any, maybeOptions?: { from?: string; to?: string; actor_user_id?: string; limit?: number }) {
  let db: any;
  let options: { from?: string; to?: string; actor_user_id?: string; limit?: number } = {};

  if (dbOrOptions && typeof dbOrOptions.prepare === 'function') {
    db = dbOrOptions;
    options = maybeOptions || {};
  } else {
    db = getDatabase();
    options = dbOrOptions || {};
  }

  const limit = options.limit || 100;

  let query = 'SELECT * FROM pos_anomaly_logs WHERE 1=1';
  const params: any[] = [];

  if (options.from) {
    query += ' AND created_at >= ?';
    params.push(options.from);
  }
  if (options.to) {
    query += ' AND created_at <= ?';
    params.push(options.to);
  }
  if (options.actor_user_id) {
    query += ' AND actor_user_id = ?';
    params.push(options.actor_user_id);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const logs = db.prepare(query).all(...params);

  // Aggregated summary
  let countQuery = 'SELECT * FROM pos_anomaly_logs WHERE 1=1';
  const countParams: any[] = [];
  if (options.from) {
    countQuery += ' AND created_at >= ?';
    countParams.push(options.from);
  }
  if (options.to) {
    countQuery += ' AND created_at <= ?';
    countParams.push(options.to);
  }

  const allFilteredLogs = db.prepare(countQuery).all(...countParams) as any[];

  let total_risk_score = 0;
  let post_print_deletions_count = 0;
  let post_print_deletions_amount = 0;
  let no_sale_drawer_opens_count = 0;
  let excessive_discounts_count = 0;
  let price_overrides_count = 0;
  let pre_blind_shortages_count = 0;

  const scorecards: Record<string, {
    actor_user_id: string;
    actor_user_name: string;
    actor_role: string;
    total_anomalies: number;
    total_risk_score: number;
    post_print_deletions: number;
    no_sale_drawer_opens: number;
    excessive_discounts: number;
    price_overrides: number;
    pre_blind_shortages: number;
  }> = {};

  for (const log of allFilteredLogs) {
    total_risk_score += log.risk_points || 0;

    if (log.event_type === 'post_print_item_removed' || log.event_type === 'post_print_order_cancelled') {
      post_print_deletions_count += 1;
      post_print_deletions_amount += Number(log.amount_impact) || 0;
    } else if (log.event_type === 'no_sale_drawer_open') {
      no_sale_drawer_opens_count += 1;
    } else if (log.event_type === 'excessive_discount') {
      excessive_discounts_count += 1;
    } else if (log.event_type === 'price_override_down') {
      price_overrides_count += 1;
    } else if (log.event_type === 'pre_blind_shortage') {
      pre_blind_shortages_count += 1;
    }

    const actorId = log.actor_user_id || 'unassigned';
    if (!scorecards[actorId]) {
      scorecards[actorId] = {
        actor_user_id: actorId,
        actor_user_name: log.actor_user_name || 'Staff Member',
        actor_role: log.actor_role || 'cashier',
        total_anomalies: 0,
        total_risk_score: 0,
        post_print_deletions: 0,
        no_sale_drawer_opens: 0,
        excessive_discounts: 0,
        price_overrides: 0,
        pre_blind_shortages: 0,
      };
    }

    scorecards[actorId].total_anomalies += 1;
    scorecards[actorId].total_risk_score += log.risk_points || 0;
    if (log.event_type === 'post_print_item_removed' || log.event_type === 'post_print_order_cancelled') {
      scorecards[actorId].post_print_deletions += 1;
    } else if (log.event_type === 'no_sale_drawer_open') {
      scorecards[actorId].no_sale_drawer_opens += 1;
    } else if (log.event_type === 'excessive_discount') {
      scorecards[actorId].excessive_discounts += 1;
    } else if (log.event_type === 'price_override_down') {
      scorecards[actorId].price_overrides += 1;
    } else if (log.event_type === 'pre_blind_shortage') {
      scorecards[actorId].pre_blind_shortages += 1;
    }
  }

  const integrity_status = total_risk_score === 0 ? 'clean' : total_risk_score >= 30 ? 'critical' : 'warning';

  const summary = {
    total_anomalies: allFilteredLogs.length,
    total_risk_score,
    overall_risk_score: total_risk_score,
    post_print_deletions: post_print_deletions_count,
    post_print_deletions_count,
    post_print_deletions_amount,
    no_sale_drawer_opens: no_sale_drawer_opens_count,
    no_sale_drawer_opens_count,
    excessive_discounts: excessive_discounts_count,
    excessive_discounts_count,
    price_overrides: price_overrides_count,
    price_overrides_count,
    pre_blind_shortages: pre_blind_shortages_count,
    pre_blind_shortages_count,
    integrity_status,
  };

  return {
    ...summary,
    logs,
    summary,
    cashier_scorecard: Object.values(scorecards).sort((a, b) => b.total_risk_score - a.total_risk_score),
  };
}

export function getSafeVaultBalance(dbOrNull?: any): number {
  const db = dbOrNull || getDatabase();
  const row = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS safe_balance
    FROM safe_vault_ledger
  `).get() as any;
  return Number(row?.safe_balance) || 0;
}
