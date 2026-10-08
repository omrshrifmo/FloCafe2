import { getDatabase, now, withTxn, newId } from '../db';
import { recordFinanceMovement } from './finance';

export interface EmployeeInput {
  userId?: string;
  name: string;
  phone?: string;
  nationalId?: string;
  role?: string;
  employmentStatus?: string;
  paySchedule?: string;
  baseSalaryCents?: number;
  hourlyRateCents?: number;
  joinedAt?: string;
  notes?: string;
}

export function listEmployees(db: ReturnType<typeof getDatabase>) {
  return db.prepare(`
    SELECT e.*, u.username
    FROM employees e
    LEFT JOIN users u ON u.id = e.user_id
    ORDER BY e.name COLLATE NOCASE
  `).all();
}

export function getEmployee(db: ReturnType<typeof getDatabase>, id: string) {
  return db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
}

export function createEmployee(db: ReturnType<typeof getDatabase>, input: EmployeeInput) {
  const id = newId('emp');
  const timestamp = now();
  const joinedAt = input.joinedAt || timestamp.split('T')[0];

  db.prepare(`
    INSERT INTO employees (
      id, user_id, name, phone, national_id, role, employment_status,
      pay_schedule, base_salary_cents, hourly_rate_cents, joined_at, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.userId || null,
    input.name,
    input.phone || null,
    input.nationalId || null,
    input.role || 'staff',
    input.employmentStatus || 'active',
    input.paySchedule || 'monthly',
    input.baseSalaryCents || 0,
    input.hourlyRateCents || 0,
    joinedAt,
    input.notes || null,
    timestamp,
    timestamp
  );

  return getEmployee(db, id);
}

export function updateEmployee(db: ReturnType<typeof getDatabase>, id: string, input: Partial<EmployeeInput>) {
  const existing = getEmployee(db, id);
  if (!existing) {
    throw Object.assign(new Error('Employee not found'), { statusCode: 404 });
  }

  const timestamp = now();
  const updates: string[] = ['updated_at = ?'];
  const params: any[] = [timestamp];

  if (input.name !== undefined) { updates.push('name = ?'); params.push(input.name); }
  if (input.phone !== undefined) { updates.push('phone = ?'); params.push(input.phone); }
  if (input.nationalId !== undefined) { updates.push('national_id = ?'); params.push(input.nationalId); }
  if (input.role !== undefined) { updates.push('role = ?'); params.push(input.role); }
  if (input.employmentStatus !== undefined) { updates.push('employment_status = ?'); params.push(input.employmentStatus); }
  if (input.paySchedule !== undefined) { updates.push('pay_schedule = ?'); params.push(input.paySchedule); }
  if (input.baseSalaryCents !== undefined) { updates.push('base_salary_cents = ?'); params.push(input.baseSalaryCents); }
  if (input.hourlyRateCents !== undefined) { updates.push('hourly_rate_cents = ?'); params.push(input.hourlyRateCents); }
  if (input.notes !== undefined) { updates.push('notes = ?'); params.push(input.notes); }
  if (input.userId !== undefined) { updates.push('user_id = ?'); params.push(input.userId); }

  params.push(id);
  db.prepare(`UPDATE employees SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  return getEmployee(db, id);
}

// Advances & Loans
export function createAdvanceOrLoan(
  db: ReturnType<typeof getDatabase>,
  input: {
    employeeId: string;
    type: 'advance' | 'loan';
    amountCents: number;
    installmentCents?: number;
    approvedBy: string;
    disburseNow?: boolean;
    cashDrawerId?: string;
    shiftId?: number;
    notes?: string;
  }
) {
  return withTxn(() => {
    const emp = getEmployee(db, input.employeeId) as any;
    if (!emp) throw Object.assign(new Error('Employee not found'), { statusCode: 404 });

    const id = newId('adv');
    const timestamp = now();
    let financeMovementId: string | null = null;

    if (input.disburseNow) {
      const movement = recordFinanceMovement(db, {
        businessDate: timestamp.split('T')[0],
        movementType: input.type === 'advance' ? 'employee_advance' : 'employee_loan',
        amountCents: input.amountCents,
        direction: 'out',
        category: 'payroll',
        description: `${input.type === 'advance' ? 'Advance' : 'Loan'} for ${emp.name}`,
        relatedEmployeeId: input.employeeId,
        createdBy: input.approvedBy,
        shiftId: input.shiftId,
        paymentMethod: 'cash',
      }) as any;
      financeMovementId = movement.id;
    }


    db.prepare(`
      INSERT INTO employee_advances_loans (
        id, employee_id, type, amount_cents, remaining_cents, installment_cents,
        approved_by, finance_movement_id, status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      id,
      input.employeeId,
      input.type,
      input.amountCents,
      input.amountCents,
      input.installmentCents || 0,
      input.approvedBy,
      financeMovementId,
      input.notes || null,
      timestamp,
      timestamp
    );

    return db.prepare('SELECT * FROM employee_advances_loans WHERE id = ?').get(id);
  });
}

export function listAdvancesAndLoans(db: ReturnType<typeof getDatabase>, employeeId?: string) {
  const where = employeeId ? 'WHERE a.employee_id = ?' : '';
  const params = employeeId ? [employeeId] : [];
  return db.prepare(`
    SELECT a.*, e.name as employee_name
    FROM employee_advances_loans a
    JOIN employees e ON e.id = a.employee_id
    ${where}
    ORDER BY a.created_at DESC
  `).all(...params);
}

// Attendance
export function clockIn(db: ReturnType<typeof getDatabase>, employeeId: string, shiftId?: number, notes?: string) {
  const active = db.prepare(`
    SELECT id FROM employee_attendance
    WHERE employee_id = ? AND clock_out IS NULL
  `).get(employeeId);

  if (active) {
    throw Object.assign(new Error('Employee is already clocked in'), { statusCode: 400 });
  }

  const id = newId('att');
  const timestamp = now();

  db.prepare(`
    INSERT INTO employee_attendance (id, employee_id, shift_id, clock_in, clock_out, hours_worked, status, notes, created_at)
    VALUES (?, ?, ?, ?, NULL, NULL, 'present', ?, ?)
  `).run(id, employeeId, shiftId || null, timestamp, notes || null, timestamp);

  return db.prepare('SELECT * FROM employee_attendance WHERE id = ?').get(id);
}

export function clockOut(db: ReturnType<typeof getDatabase>, employeeId: string, notes?: string) {
  const record = db.prepare(`
    SELECT * FROM employee_attendance
    WHERE employee_id = ? AND clock_out IS NULL
    ORDER BY clock_in DESC LIMIT 1
  `).get(employeeId) as any;

  if (!record) {
    throw Object.assign(new Error('No active clock-in found'), { statusCode: 400 });
  }

  const timestamp = now();
  const startTime = new Date(record.clock_in).getTime();
  const endTime = new Date(timestamp).getTime();
  const hoursWorked = Math.max(0, Math.round(((endTime - startTime) / (1000 * 60 * 60)) * 100) / 100);

  db.prepare(`
    UPDATE employee_attendance
    SET clock_out = ?, hours_worked = ?, notes = COALESCE(?, notes)
    WHERE id = ?
  `).run(timestamp, hoursWorked, notes || null, record.id);

  return db.prepare('SELECT * FROM employee_attendance WHERE id = ?').get(record.id);
}

// Payroll Run
export function createPayrollRun(
  db: ReturnType<typeof getDatabase>,
  input: { periodStart: string; periodEnd: string; createdBy: string }
) {
  return withTxn(() => {
    const id = newId('pr');
    const timestamp = now();

    const activeEmployees = db.prepare(`
      SELECT * FROM employees WHERE employment_status = 'active'
    `).all() as any[];

    let totalGrossCents = 0;
    let totalNetCents = 0;

    db.prepare(`
      INSERT INTO payroll_runs (id, period_start, period_end, status, total_net_cents, total_gross_cents, approved_by, created_at, updated_at)
      VALUES (?, ?, ?, 'draft', 0, 0, NULL, ?, ?)
    `).run(id, input.periodStart, input.periodEnd, timestamp, timestamp);

    for (const emp of activeEmployees) {
      const baseSalary = Number(emp.base_salary_cents || 0);

      // Check active advance/loan installments
      const loans = db.prepare(`
        SELECT * FROM employee_advances_loans
        WHERE employee_id = ? AND status = 'active' AND remaining_cents > 0
      `).all(emp.id) as any[];

      let advanceDeduction = 0;
      for (const loan of loans) {
        const installment = loan.installment_cents > 0 ? loan.installment_cents : loan.remaining_cents;
        advanceDeduction += Math.min(loan.remaining_cents, installment);
      }

      const netSalary = Math.max(0, baseSalary - advanceDeduction);
      totalGrossCents += baseSalary;
      totalNetCents += netSalary;

      const payslipId = newId('ps');
      const snapshot = JSON.stringify({
        employee: { id: emp.id, name: emp.name, role: emp.role },
        baseSalaryCents: baseSalary,
        advanceDeductionCents: advanceDeduction,
        netSalaryCents: netSalary,
        period: { start: input.periodStart, end: input.periodEnd },
      });

      db.prepare(`
        INSERT INTO payslips (
          id, payroll_run_id, employee_id, base_amount_cents, allowances_cents, bonuses_cents,
          deductions_cents, advance_deduction_cents, net_amount_cents, status, snapshot_json, created_at
        ) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, 'unpaid', ?, ?)
      `).run(payslipId, id, emp.id, baseSalary, advanceDeduction, netSalary, snapshot, timestamp);
    }

    db.prepare(`
      UPDATE payroll_runs
      SET total_gross_cents = ?, total_net_cents = ?
      WHERE id = ?
    `).run(totalGrossCents, totalNetCents, id);

    return db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(id);
  });
}

export function approvePayrollRun(
  db: ReturnType<typeof getDatabase>,
  payrollRunId: string,
  approvedBy: string,
  disburseFinanceMovements: boolean = false
) {
  return withTxn(() => {
    const run = db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(payrollRunId) as any;
    if (!run || run.status !== 'draft') {
      throw Object.assign(new Error('Payroll run is not in draft status'), { statusCode: 400 });
    }

    const timestamp = now();
    const payslips = db.prepare(`
      SELECT ps.*, e.name as employee_name
      FROM payslips ps
      JOIN employees e ON e.id = ps.employee_id
      WHERE ps.payroll_run_id = ?
    `).all(payrollRunId) as any[];

    for (const ps of payslips) {
      let financeMovementId: string | null = null;
      if (disburseFinanceMovements && ps.net_amount_cents > 0) {
        const movement = recordFinanceMovement(db, {
          businessDate: timestamp.split('T')[0],
          movementType: 'employee_salary',
          amountCents: ps.net_amount_cents,
          direction: 'out',
          category: 'payroll',
          description: `Salary disbursement for ${ps.employee_name} (${run.period_start} to ${run.period_end})`,
          relatedEmployeeId: ps.employee_id,
          createdBy: approvedBy,
          paymentMethod: 'bank_transfer',
        }) as any;
        financeMovementId = movement.id;
      }


      // Deduct advance/loan remaining if applicable
      if (ps.advance_deduction_cents > 0) {
        const activeLoans = db.prepare(`
          SELECT * FROM employee_advances_loans
          WHERE employee_id = ? AND status = 'active' AND remaining_cents > 0
          ORDER BY created_at ASC
        `).all(ps.employee_id) as any[];

        let remainingToDeduct = ps.advance_deduction_cents;
        for (const loan of activeLoans) {
          if (remainingToDeduct <= 0) break;
          const deduct = Math.min(loan.remaining_cents, remainingToDeduct);
          const newRemaining = loan.remaining_cents - deduct;
          const newStatus = newRemaining === 0 ? 'paid' : 'active';
          db.prepare(`
            UPDATE employee_advances_loans
            SET remaining_cents = ?, status = ?, updated_at = ?
            WHERE id = ?
          `).run(newRemaining, newStatus, timestamp, loan.id);
          remainingToDeduct -= deduct;
        }
      }

      db.prepare(`
        UPDATE payslips
        SET status = 'approved', finance_movement_id = ?
        WHERE id = ?
      `).run(financeMovementId, ps.id);
    }

    db.prepare(`
      UPDATE payroll_runs
      SET status = 'approved', approved_by = ?, updated_at = ?
      WHERE id = ?
    `).run(approvedBy, timestamp, payrollRunId);

    return db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(payrollRunId);
  });
}
