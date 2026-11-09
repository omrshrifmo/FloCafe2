import { Router, Request, Response } from 'express';
import { getDatabase } from '../db';
import {
  verifyHardwareLicense,
  activateWithKeyFile,
  revokeLicense,
  deactivateLicenseForTest,
  getHardwareFingerprint,
} from '../services/hardware-license';

export const licenseRoutes = Router();

// GET /api/license/status
licenseRoutes.get('/status', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const status = verifyHardwareLicense(db);
    return res.json({ ...status });
  } catch (err: any) {
    return res.status(500).json({
      error: 'Failed to verify license',
      details: err.message,
      hwid: getHardwareFingerprint(),
    });
  }
});

// POST /api/license/activate
licenseRoutes.post('/activate', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      tierKeyContent,
      tierKeyFilePath,
      ownerMasterKeyContent,
      reactivationPassword,
      forceReplaceActive,
    } = req.body || {};

    if (!tierKeyContent) {
      return res.status(400).json({ error: 'Missing tierKeyContent in request body.' });
    }

    const result = activateWithKeyFile(db, {
      tierKeyContent,
      tierKeyFilePath,
      ownerMasterKeyContent,
      reactivationPassword,
      forceReplaceActive: Boolean(forceReplaceActive),
    });

    if (result.success) {
      return res.json({
        success: true,
        license: result.license,
      });
    }

    if (result.requires_owner_override) {
      return res.status(403).json({
        success: false,
        requires_owner_override: true,
        error: 'REQUIRES_OWNER_OVERRIDE',
        message: result.message || 'Owner Re-Activation Override Required.',
      });
    }

    return res.status(400).json({
      success: false,
      error: result.error || 'Activation failed.',
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'License activation error',
      details: err.message,
    });
  }
});

// POST /api/license/revoke
licenseRoutes.post('/revoke', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { ownerMasterKeyContent, reactivationPassword } = req.body || {};

    const result = revokeLicense(db, {
      ownerMasterKeyContent,
      reactivationPassword,
    });

    if (result.success) {
      return res.json({ success: true, message: 'License revoked and device locked.' });
    }
    return res.status(400).json({ success: false, error: result.error || 'Revocation failed.' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/license/deactivate-for-test
licenseRoutes.post('/deactivate-for-test', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { masterPin, ownerMasterKeyContent, reactivationPassword } = req.body || {};

    const result = deactivateLicenseForTest(db, {
      masterPin,
      ownerMasterKeyContent,
      reactivationPassword,
    });

    if (result.success) {
      return res.json({ success: true, message: 'License deactivated for testing.' });
    }
    return res.status(400).json({ success: false, error: result.error || 'Deactivation failed.' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/license/renewal-banner
licenseRoutes.get('/renewal-banner', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'license_renewal_banner_json'").get() as { value?: string } | undefined;
    let customBanner: any = null;
    if (row?.value) {
      try {
        customBanner = JSON.parse(row.value);
      } catch {}
    }

    if (customBanner && customBanner.active !== false) {
      return res.json({ banner: customBanner });
    }

    // Auto-warning if within 3 days (259,200,000 ms) of expiration or expired
    const status = verifyHardwareLicense(db);
    const now = Date.now();
    if (status.tier && status.tier !== 'forever' && status.expires_at) {
      const remainingMs = status.expires_at - now;
      const daysLeft = Math.ceil(remainingMs / 86_400_000);
      if (remainingMs <= 3 * 86_400_000) {
        const isExpired = remainingMs <= 0;
        return res.json({
          banner: {
            active: true,
            banner_type: isExpired ? 'critical' : 'warning',
            message: isExpired
              ? 'FloCafe Subscription Expired. Please contact store owner to renew hardware license.'
              : `FloCafe Subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Please renew your license.`,
            expires_at: status.expires_at,
            days_left: Math.max(0, daysLeft),
            dismissible: !isExpired,
          },
        });
      }
    }

    return res.json({ banner: customBanner || { active: false } });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to retrieve renewal banner', details: err.message });
  }
});

// POST /api/license/renewal-banner
licenseRoutes.post('/renewal-banner', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { active, message, banner_type, action_url, dismissible } = req.body || {};
    const bannerObj = {
      active: active !== undefined ? Boolean(active) : true,
      message: typeof message === 'string' ? message : '',
      banner_type: banner_type || 'warning',
      action_url: action_url || '',
      dismissible: dismissible !== undefined ? Boolean(dismissible) : true,
      updated_at: new Date().toISOString(),
    };
    db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('license_renewal_banner_json', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(JSON.stringify(bannerObj));
    return res.json({ success: true, banner: bannerObj });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to set renewal banner', details: err.message });
  }
});
