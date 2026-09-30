'use client';

import { useState } from 'react';
import { X, Tag, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';
import { useTranslations } from 'use-intl';

interface Props {
  title: string;
  currentLabel?: string | null;
  onSave: (label: string | null) => Promise<void>;
  onClose: () => void;
}

export default function InternalLabelModal({ title, currentLabel, onSave, onClose }: Props) {
  const tPos = useTranslations('pos');
  const tCommon = useTranslations('common');
  const [label, setLabel] = useState(currentLabel || '');
  const [submitting, setSubmitting] = useState(false);

  const handleSave = async () => {
    setSubmitting(true);
    try {
      await onSave(label.trim() || null);
      toast.success(tPos('internalLabelUpdated'));
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err as Error)?.message ||
        tPos('internalLabelUpdateFailed');
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card w-full max-w-sm rounded-2xl border border-border shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Tag size={18} className="text-brand" />
            <h3 className="font-semibold text-foreground">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-muted-foreground hover:text-foreground active:bg-muted"
            aria-label={tCommon('cancel')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-foreground block mb-1">
              {tPos('internalLabelRef')}
            </label>
            <input
              type="text"
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, 50))}
              placeholder={tPos('internalLabelPlaceholderModal')}
              className="w-full px-3 py-2 text-sm border border-border bg-card rounded-lg focus:outline-none focus:ring-2 focus:ring-brand/30"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave();
              }}
            />
          </div>

          <div className="p-3 bg-muted/60 rounded-xl flex gap-2 text-xs text-muted-foreground">
            <Info size={16} className="shrink-0 mt-0.5" />
            <p>
              {tPos('internalLabelNotice')}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1" disabled={submitting}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={submitting} className="flex-1">
            {submitting ? tPos('savingLabel') : tPos('saveLabel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
