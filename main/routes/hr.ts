import { Router } from 'express';
import { getDatabase } from '../db';
import { requirePermission } from '../services/authorization';
import {
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  createAdvanceOrLoan,
  listAdvancesAndLoans,
  clockIn,
  clockOut,
  createPayrollRun,
  approvePayrollRun,
} from '../services/hr';

export const hrRoutes = Router();

// Employee management
hrRoutes.get('/employees', requirePermission('staff.view'), (req, res) => {
  try {
    const db = getDatabase();
    const employees = listEmployees(db);
    res.json({ employees });
  } catch (error: any) {
    console.error('[API] Error listing employees:', error);
    res.status(500).json({ error: 'Failed to list employees' });
  }
});

hrRoutes.get('/employees/:id', requirePermission('staff.view'), (req, res) => {
  try {
    const db = getDatabase();
    const employee = getEmployee(db, String(req.params.id));
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    res.json({ employee });
  } catch (error: any) {
    console.error('[API] Error fetching employee:', error);
    res.status(500).json({ error: 'Failed to fetch employee' });
  }
});

hrRoutes.post('/employees', requirePermission('staff.operational.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const employee = createEmployee(db, req.body);
    res.status(201).json({ employee });
  } catch (error: any) {
    console.error('[API] Error creating employee:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to create employee' });
  }
});

hrRoutes.put('/employees/:id', requirePermission('staff.operational.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const employee = updateEmployee(db, String(req.params.id), req.body);
    res.json({ employee });
  } catch (error: any) {
    console.error('[API] Error updating employee:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to update employee' });
  }
});


// Advances and Loans
hrRoutes.get('/advances', requirePermission('staff.view'), (req, res) => {
  try {
    const db = getDatabase();
    const records = db.prepare(`
      SELECT a.id, a.employee_id as user_id, e.name as staff_name,
             (a.amount_cents / 100.0) as amount,
             (a.remaining_cents / 100.0) as remaining_balance,
             (a.installment_cents / 100.0) as deduction_per_period,
             a.status, a.created_at
      FROM employee_advances_loans a
      JOIN employees e ON e.id = a.employee_id
      ORDER BY a.created_at DESC
    `).all();
    res.json({ advances: records });
  } catch (error: any) {
    console.error('[API] Error listing advances:', error);
    res.status(500).json({ error: 'Failed to list advances' });
  }
});

hrRoutes.post('/advances', requirePermission('staff.operational.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const { user_id, employee_id, amount, deduction_per_period, reason, disburse_from_drawer, shift_id } = req.body;
    const targetId = user_id || employee_id;
    if (!targetId || !amount) {
      return res.status(400).json({ error: 'user_id and amount are required' });
    }
    const amountCents = Math.round(Number(amount) * 100);
    const installmentCents = deduction_per_period ? Math.round(Number(deduction_per_period) * 100) : 0;

    const record = createAdvanceOrLoan(db, {
      employeeId: String(targetId),
      type: 'advance',
      amountCents,
      installmentCents,
      approvedBy: user?.id || user?.userId || 'system',
      disburseNow: Boolean(disburse_from_drawer),
      shiftId: shift_id ? Number(shift_id) : undefined,
      notes: reason ? String(reason) : undefined,
    });
    res.status(201).json({ advance: record, success: true });
  } catch (error: any) {
    console.error('[API] Error creating advance:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to record advance' });
  }
});

hrRoutes.get('/advances-loans', requirePermission('staff.view'), (req, res) => {
  try {
    const db = getDatabase();
    const employeeId = req.query.employee_id ? String(req.query.employee_id) : undefined;
    const records = listAdvancesAndLoans(db, employeeId);
    res.json({ records });
  } catch (error: any) {
    console.error('[API] Error listing advances and loans:', error);
    res.status(500).json({ error: 'Failed to list records' });
  }
});

hrRoutes.post('/advances-loans', requirePermission('staff.operational.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const { employee_id, type, amount_cents, installment_cents, disburse_now, cash_drawer_id, shift_id, notes } = req.body;

    if (!employee_id || !type || !amount_cents) {
      return res.status(400).json({ error: 'employee_id, type, and amount_cents are required' });
    }

    const record = createAdvanceOrLoan(db, {
      employeeId: String(employee_id),
      type: type === 'loan' ? 'loan' : 'advance',
      amountCents: Number(amount_cents),
      installmentCents: installment_cents ? Number(installment_cents) : undefined,
      approvedBy: user?.id || user?.userId || 'system',
      disburseNow: Boolean(disburse_now),
      cashDrawerId: cash_drawer_id ? String(cash_drawer_id) : undefined,
      shiftId: shift_id ? Number(shift_id) : undefined,
      notes: notes ? String(notes) : undefined,
    });

    res.status(201).json({ record });
  } catch (error: any) {
    console.error('[API] Error creating advance/loan:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to record advance/loan' });
  }
});

// Attendance Clock-in / Clock-out
hrRoutes.post('/attendance/clock-in', (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const { employee_id, shift_id, notes } = req.body;
    const targetEmpId = employee_id || user?.id || user?.userId;
    if (!targetEmpId) return res.status(400).json({ error: 'employee_id required' });

    const attendance = clockIn(db, String(targetEmpId), shift_id ? Number(shift_id) : undefined, notes);
    res.json({ attendance });
  } catch (error: any) {
    console.error('[API] Error clocking in:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to clock in' });
  }
});

hrRoutes.post('/attendance/clock-out', (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const { employee_id, notes } = req.body;
    const targetEmpId = employee_id || user?.id || user?.userId;
    if (!targetEmpId) return res.status(400).json({ error: 'employee_id required' });

    const attendance = clockOut(db, String(targetEmpId), notes);
    res.json({ attendance });
  } catch (error: any) {
    console.error('[API] Error clocking out:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to clock out' });
  }
});

hrRoutes.get('/attendance', requirePermission('staff.view'), (req, res) => {
  try {
    const db = getDatabase();
    const records = db.prepare(`
      SELECT att.*, e.name as employee_name
      FROM employee_attendance att
      JOIN employees e ON e.id = att.employee_id
      ORDER BY att.clock_in DESC
      LIMIT 100
    `).all();
    res.json({ attendance: records });
  } catch (error: any) {
    console.error('[API] Error listing attendance:', error);
    res.status(500).json({ error: 'Failed to list attendance' });
  }
});

// Payroll Runs
hrRoutes.get('/payroll/runs', requirePermission('staff.operational.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const runs = db.prepare(`
      SELECT pr.*, u.name as approved_by_name
      FROM payroll_runs pr
      LEFT JOIN users u ON u.id = pr.approved_by
      ORDER BY pr.created_at DESC
      LIMIT 50
    `).all();
    res.json({ runs });
  } catch (error: any) {
    console.error('[API] Error listing payroll runs:', error);
    res.status(500).json({ error: 'Failed to list payroll runs' });
  }
});

hrRoutes.post('/payroll/calculate', requirePermission('staff.operational.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const employees = db.prepare(`SELECT * FROM employees WHERE employment_status = 'active' ORDER BY name ASC`).all() as any[];
    const calculations = employees.map((emp) => {
      const basePay = (emp.base_salary_cents || 0) / 100.0;
      const loans = db.prepare(`
        SELECT remaining_cents, installment_cents
        FROM employee_advances_loans
        WHERE employee_id = ? AND status = 'active'
      `).all(emp.id) as any[];

      let loanDeduction = 0;
      for (const l of loans) {
        const inst = l.installment_cents > 0 ? l.installment_cents : l.remaining_cents;
        loanDeduction += Math.min(l.remaining_cents, inst) / 100.0;
      }
      const netPay = Math.max(0, basePay - loanDeduction);

      return {
        staff_id: emp.id,
        staff_name: emp.name,
        role: emp.role || 'staff',
        base_pay: basePay,
        regular_hours: 160,
        overtime_hours: 0,
        overtime_pay: 0,
        loan_deduction: loanDeduction,
        bonus: 0,
        deductions: 0,
        net_pay: netPay,
      };
    });

    res.json({ calculations });
  } catch (error: any) {
    console.error('[API] Error calculating payroll:', error);
    res.status(500).json({ error: error.message || 'Failed to calculate payroll' });
  }
});

hrRoutes.post('/payroll/runs', requirePermission('staff.operational.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const { period_start, period_end } = req.body;

    if (!period_start || !period_end) {
      return res.status(400).json({ error: 'period_start and period_end are required' });
    }

    const run = createPayrollRun(db, {
      periodStart: String(period_start),
      periodEnd: String(period_end),
      createdBy: user?.id || user?.userId || 'system',
    });

    res.status(201).json({ run });
  } catch (error: any) {
    console.error('[API] Error creating payroll run:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to create payroll run' });
  }
});

hrRoutes.get('/payroll/runs/:id/payslips', requirePermission('staff.operational.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const payslips = db.prepare(`
      SELECT ps.*, e.name as employee_name, e.role as employee_role
      FROM payslips ps
      JOIN employees e ON e.id = ps.employee_id
      WHERE ps.payroll_run_id = ?
      ORDER BY e.name COLLATE NOCASE
    `).all(req.params.id);
    res.json({ payslips });
  } catch (error: any) {
    console.error('[API] Error fetching payslips:', error);
    res.status(500).json({ error: 'Failed to fetch payslips' });
  }
});

hrRoutes.post('/payroll/runs/:id/approve', requirePermission('staff.privileged.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const { disburse_finance_movements } = req.body;

    const run = approvePayrollRun(
      db,
      String(req.params.id),
      user?.id || user?.userId || 'system',
      Boolean(disburse_finance_movements)
    );


    res.json({ run });
  } catch (error: any) {
    console.error('[API] Error approving payroll run:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to approve payroll run' });
  }
});
