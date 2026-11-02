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
