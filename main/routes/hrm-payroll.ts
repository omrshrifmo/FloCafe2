import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getDatabase, now, withTxn } from '../db';
import { requirePermission } from '../services/authorization';
import { getOpenSession } from '../services/shift-session-gate';

export const hrmPayrollRoutes = Router();

// ==========================================
// HR Employee Profiles (hr_employee_profiles linked to staff/users)
// ==========================================
hrmPayrollRoutes.get('/profiles', requirePermission('hrm.payroll.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const profiles = db.prepare(`
      SELECT p.*, u.name, u.email, u.role, u.is_active
      FROM hr_employee_profiles p
      JOIN users u ON u.id = p.staff_id
      ORDER BY u.name ASC
    `).all();
    res.json({ profiles });
  } catch (error: any) {
    console.error('[HRM] Error listing profiles:', error);
    res.status(500).json({ error: error.message || 'Failed to list employee profiles' });
  }
});

hrmPayrollRoutes.post('/profiles', requirePermission('hrm.payroll.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      staff_id,
      employee_code,
      department = 'Operations',
      contract_type = 'full_time',
      base_monthly_salary = 0,
      hourly_rate = 0,
      standard_work_days = 26,
      social_insurance_amount = 0,
      tax_rate_pct = 0,
      phone,
      hire_date,
    } = req.body;

    if (!staff_id || !employee_code) {
      return res.status(400).json({ error: 'staff_id and employee_code are required' });
    }

    const timestamp = now();
    const hDate = hire_date || new Date().toISOString().split('T')[0];

    db.prepare(`
      INSERT INTO hr_employee_profiles (
        staff_id, employee_code, department, contract_type, base_monthly_salary, hourly_rate,
        standard_work_days, social_insurance_amount, tax_rate_pct, phone, hire_date, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(staff_id) DO UPDATE SET
        employee_code = excluded.employee_code,
        department = excluded.department,
        contract_type = excluded.contract_type,
        base_monthly_salary = excluded.base_monthly_salary,
        hourly_rate = excluded.hourly_rate,
        standard_work_days = excluded.standard_work_days,
        social_insurance_amount = excluded.social_insurance_amount,
        tax_rate_pct = excluded.tax_rate_pct,
        phone = excluded.phone,
        hire_date = excluded.hire_date,
        updated_at = excluded.updated_at
    `).run(
      staff_id, employee_code, department, contract_type, Number(base_monthly_salary) || 0,
      Number(hourly_rate) || 0, Number(standard_work_days) || 26, Number(social_insurance_amount) || 0,
      Number(tax_rate_pct) || 0, phone || null, hDate, timestamp
    );

    const profile = db.prepare('SELECT * FROM hr_employee_profiles WHERE staff_id = ?').get(staff_id);
    res.status(201).json({ profile });
  } catch (error: any) {
    console.error('[HRM] Error saving profile:', error);
    res.status(500).json({ error: error.message || 'Failed to save employee profile' });
  }
});

// ==========================================
// Monthly Attendance Summaries
// ==========================================
hrmPayrollRoutes.get('/attendance', requirePermission('hrm.payroll.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { month } = req.query;
    const currentMonth = month ? String(month) : new Date().toISOString().slice(0, 7);

    // Auto-seed attendance summaries for active profiles if missing for this month
    const activeStaff = db.prepare('SELECT p.staff_id FROM hr_employee_profiles p JOIN users u ON u.id = p.staff_id WHERE u.is_active = 1').all() as any[];
    const checkAtt = db.prepare('SELECT id FROM hr_attendance_summaries WHERE staff_id = ? AND payroll_month = ?');
    const insertAtt = db.prepare(`
      INSERT INTO hr_attendance_summaries (
        id, staff_id, payroll_month, days_worked, absent_days, overtime_hours, late_minutes, bonus_amount, penalty_amount, updated_at
      ) VALUES (?, ?, ?, 26, 0, 0, 0, 0, 0, ?)
    `);

    for (const s of activeStaff) {
      if (!checkAtt.get(s.staff_id, currentMonth)) {
        insertAtt.run(randomUUID(), s.staff_id, currentMonth, now());
      }
    }

    const attendance = db.prepare(`
      SELECT a.*, u.name as staff_name, u.role as staff_role, p.employee_code, p.base_monthly_salary, p.hourly_rate
      FROM hr_attendance_summaries a
      JOIN users u ON u.id = a.staff_id
      JOIN hr_employee_profiles p ON p.staff_id = a.staff_id
      WHERE a.payroll_month = ?
      ORDER BY u.name ASC
    `).all(currentMonth);

    res.json({ attendance, payroll_month: currentMonth });
  } catch (error: any) {
    console.error('[HRM] Error listing attendance:', error);
    res.status(500).json({ error: error.message || 'Failed to list attendance' });
  }
});

hrmPayrollRoutes.put('/attendance/:id', requirePermission('hrm.payroll.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { days_worked, absent_days, overtime_hours, late_minutes, bonus_amount, penalty_amount } = req.body;

    db.prepare(`
      UPDATE hr_attendance_summaries SET
        days_worked = COALESCE(?, days_worked),
        absent_days = COALESCE(?, absent_days),
        overtime_hours = COALESCE(?, overtime_hours),
        late_minutes = COALESCE(?, late_minutes),
        bonus_amount = COALESCE(?, bonus_amount),
        penalty_amount = COALESCE(?, penalty_amount),
        updated_at = ?
      WHERE id = ?
    `).run(
      days_worked !== undefined ? Number(days_worked) : null,
      absent_days !== undefined ? Number(absent_days) : null,
      overtime_hours !== undefined ? Number(overtime_hours) : null,
      late_minutes !== undefined ? Number(late_minutes) : null,
      bonus_amount !== undefined ? Number(bonus_amount) : null,
      penalty_amount !== undefined ? Number(penalty_amount) : null,
      now(),
      req.params.id,
    );

    const updated = db.prepare('SELECT * FROM hr_attendance_summaries WHERE id = ?').get(req.params.id);
    res.json({ attendance: updated });
  } catch (error: any) {
    console.error('[HRM] Error updating attendance:', error);
    res.status(500).json({ error: error.message || 'Failed to update attendance' });
  }
});

// ==========================================
// Employee Loans & Advances
// ==========================================
hrmPayrollRoutes.get('/loans', requirePermission('hrm.payroll.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { status } = req.query;
    let query = `
      SELECT l.*, u.name as staff_name, p.employee_code
      FROM hr_employee_loans l
      JOIN users u ON u.id = l.staff_id
      LEFT JOIN hr_employee_profiles p ON p.staff_id = l.staff_id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (status) {
      query += ' AND l.status = ?';
      params.push(String(status));
    }
    query += ' ORDER BY l.issued_at DESC';
    const loans = db.prepare(query).all(...params);
    res.json({ loans });
  } catch (error: any) {
    console.error('[HRM] Error listing loans:', error);
    res.status(500).json({ error: error.message || 'Failed to list loans' });
  }
});

// POST /hrm/loans: Issues a loan or advance, records loan_disbursement in cash_movements if disburse_from_drawer is true
hrmPayrollRoutes.post('/loans', requirePermission('hrm.payroll.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const actorId = user?.id || user?.userId || 'system';
    const {
      staff_id,
      loan_type = 'installment_loan',
      principal_amount,
      monthly_installment,
      reason,
      disburse_from_drawer = false,
      session_id,
    } = req.body;

    if (!staff_id || !principal_amount || Number(principal_amount) <= 0) {
      return res.status(400).json({ error: 'staff_id and positive principal_amount are required' });
    }

    const principal = Number(principal_amount);
    const installment = Math.max(1, Number(monthly_installment) || principal);
    const loanId = randomUUID();
    const timestamp = now();

    withTxn(() => {
      db.prepare(`
        INSERT INTO hr_employee_loans (
          id, staff_id, loan_type, principal_amount, monthly_installment, remaining_balance, status, reason, issued_at, approved_by
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
      `).run(loanId, staff_id, loan_type, principal, installment, principal, reason || null, timestamp, actorId);

      if (disburse_from_drawer) {
        const effectiveSessionId = session_id ? Number(session_id) : (getOpenSession(db)?.id ?? null);
        let drawerMovementId: number | null = null;
        try {
          const dRes = db.prepare(`
            INSERT INTO cash_drawer_movements (
              business_date, movement_type, amount_cents, reason, created_by, created_at, cash_session_id
            ) VALUES (date('now'), 'pay_out', ?, ?, ?, ?, ?)
          `).run(
            Math.round(principal * 100),
            `Employee loan payout: ${reason || ''}`.trim(),
            actorId,
            timestamp,
            effectiveSessionId,
          );
          drawerMovementId = Number(dRes.lastInsertRowid);
        } catch (err) {
          console.error('[HRM] Error inserting cash_drawer_movements:', err);
        }

        const movementId = randomUUID();
        db.prepare(`
          INSERT INTO cash_movements (
            id, session_id, movement_type, category, amount, payment_method, reference_type, reference_id, notes, created_by, created_at, cash_drawer_movement_id
          ) VALUES (?, ?, 'loan_disbursement', 'Payroll & Loans', ?, 'cash', 'employee_loan', ?, ?, ?, ?, ?)
        `).run(
          movementId,
          effectiveSessionId ? String(effectiveSessionId) : null,
          principal,
          loanId,
          `Loan disbursement to staff: ${reason || ''}`,
          actorId,
          timestamp,
          drawerMovementId,
        );
      }
    });

    const loan = db.prepare('SELECT * FROM hr_employee_loans WHERE id = ?').get(loanId);
    res.status(201).json({ loan });
  } catch (error: any) {
    console.error('[HRM] Error issuing loan:', error);
    res.status(500).json({ error: error.message || 'Failed to issue loan' });
  }
});

// ==========================================
// Payroll Runs & Disbursal
// Formula: Net Payable = Base Salary - Absence Deduction + (Overtime Hours * Hourly Rate * 1.5) + Bonuses - Penalties - Tax/Social - Loan Installment
// ==========================================
hrmPayrollRoutes.get('/payroll/runs', requirePermission('hrm.payroll.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { month } = req.query;
    let query = `
      SELECT pr.*, u.name as staff_name, u.role as staff_role, p.employee_code
      FROM hr_payroll_runs pr
      JOIN users u ON u.id = pr.staff_id
      LEFT JOIN hr_employee_profiles p ON p.staff_id = pr.staff_id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (month) {
      query += ' AND pr.payroll_month = ?';
      params.push(String(month));
    }
    query += ' ORDER BY pr.payroll_month DESC, u.name ASC';
    const runs = db.prepare(query).all(...params);
    res.json({ payroll_runs: runs });
  } catch (error: any) {
    console.error('[HRM] Error listing payroll runs:', error);
    res.status(500).json({ error: error.message || 'Failed to list payroll runs' });
  }
});

// POST /hrm/payroll/run: Inside a db.transaction(), calculate each active employee's slip, decrement loans, mark paid, record payout in cash_movements
hrmPayrollRoutes.post('/payroll/run', requirePermission('hrm.payroll.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const actorId = user?.id || user?.userId || 'system';
    const { payroll_month, disburse_from_drawer = false, session_id } = req.body;

    const month = payroll_month ? String(payroll_month) : new Date().toISOString().slice(0, 7);
    const timestamp = now();

    const activeStaff = db.prepare(`
      SELECT p.*, u.name as staff_name
      FROM hr_employee_profiles p
      JOIN users u ON u.id = p.staff_id
      WHERE u.is_active = 1
    `).all() as any[];

    if (activeStaff.length === 0) {
      return res.status(400).json({ error: 'No active employee profiles found. Create employee profiles first.' });
    }

    const createdRunIds: string[] = [];
    let totalDisbursed = 0;

    withTxn(() => {
      // Clean draft runs for this month if rerunning
      db.prepare("DELETE FROM hr_payroll_runs WHERE payroll_month = ? AND status = 'draft'").run(month);

      const getAttendance = db.prepare('SELECT * FROM hr_attendance_summaries WHERE staff_id = ? AND payroll_month = ?');
      const getActiveLoans = db.prepare("SELECT * FROM hr_employee_loans WHERE staff_id = ? AND status = 'active'");
      const updateLoan = db.prepare('UPDATE hr_employee_loans SET remaining_balance = ?, status = ? WHERE id = ?');
      const insertRun = db.prepare(`
        INSERT INTO hr_payroll_runs (
          id, payroll_month, staff_id, base_salary, attendance_deduction, overtime_pay, bonus_amount, penalty_amount,
          tax_and_insurance, loan_installment_deducted, net_payable, status, paid_at, paid_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?)
      `);

      for (const emp of activeStaff) {
        const att = getAttendance.get(emp.staff_id, month) as any || {
          days_worked: 26,
          absent_days: 0,
          overtime_hours: 0,
          bonus_amount: 0,
          penalty_amount: 0,
        };

        const baseSalary = Number(emp.base_monthly_salary) || 0;
        const standardDays = Math.max(1, Number(emp.standard_work_days) || 26);
        const dayRate = baseSalary / standardDays;
        const hourlyRate = Number(emp.hourly_rate) > 0 ? Number(emp.hourly_rate) : (dayRate / 8);

        // Absence Deduction: absent_days * dayRate
        const absenceDeduction = (Number(att.absent_days) || 0) * dayRate;

        // Overtime Pay: Overtime Hours * Hourly Rate * 1.5
        const overtimePay = (Number(att.overtime_hours) || 0) * hourlyRate * 1.5;

        const bonus = Number(att.bonus_amount) || 0;
        const penalty = Number(att.penalty_amount) || 0;

        // Tax & Social Insurance
        const socialIns = Number(emp.social_insurance_amount) || 0;
        const taxDeduction = (baseSalary * (Number(emp.tax_rate_pct) || 0)) / 100;
        const taxAndInsurance = socialIns + taxDeduction;

        // Loan Deductions: MIN(monthly_installment, remaining_balance) across active loans
        const loans = getActiveLoans.all(emp.staff_id) as any[];
        let totalLoanDeducted = 0;

        for (const loan of loans) {
          const installment = Math.min(Number(loan.monthly_installment), Number(loan.remaining_balance));
          if (installment > 0) {
            totalLoanDeducted += installment;
            const newBal = Math.max(0, Number(loan.remaining_balance) - installment);
            const newStatus = newBal <= 0.001 ? 'settled' : 'active';
            updateLoan.run(newBal, newStatus, loan.id);
          }
        }

        // Net Payable calculation
        const grossEarnings = baseSalary - absenceDeduction + overtimePay + bonus;
        const totalDeductions = penalty + taxAndInsurance + totalLoanDeducted;
        const netPayable = Math.max(0, grossEarnings - totalDeductions);

        const runId = randomUUID();
        insertRun.run(
          runId, month, emp.staff_id, baseSalary, absenceDeduction, overtimePay, bonus, penalty,
          taxAndInsurance, totalLoanDeducted, netPayable, timestamp, actorId
        );

        createdRunIds.push(runId);
        totalDisbursed += netPayable;
      }

      // Record payroll payout in cash_movements
      const payoutMovementId = randomUUID();
      db.prepare(`
        INSERT INTO cash_movements (
          id, session_id, movement_type, category, amount, payment_method, reference_type, reference_id, notes, created_by, created_at
        ) VALUES (?, ?, 'payroll_payout', 'Payroll', ?, ?, 'payroll_run', ?, ?, ?, ?)
      `).run(
        payoutMovementId,
        session_id ? String(session_id) : null,
        totalDisbursed,
        disburse_from_drawer ? 'cash' : 'bank_transfer',
        month,
        `Disbursed monthly payroll for ${month} (${createdRunIds.length} staff)`,
        actorId,
        timestamp,
      );

      if (disburse_from_drawer) {
        try {
          db.prepare(`
            INSERT INTO cash_drawer_movements (
              business_date, movement_type, amount_cents, reason, created_by, created_at, cash_session_id
            ) VALUES (date('now'), 'pay_out', ?, ?, ?, ?, ?)
          `).run(
            Math.round(totalDisbursed * 100),
            `Monthly payroll payout (${month})`,
            actorId,
            timestamp,
            session_id ? Number(session_id) : null,
          );
        } catch {}
      }
    });

    res.json({
      success: true,
      payroll_month: month,
      employee_count: createdRunIds.length,
      total_disbursed: totalDisbursed,
      payroll_run_ids: createdRunIds,
    });
  } catch (error: any) {
    console.error('[HRM] Error running payroll:', error);
    res.status(500).json({ error: error.message || 'Failed to process payroll run' });
  }
});
