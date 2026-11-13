import { useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';

interface Props {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  wide?: boolean;
}

/** Accessible modal: focus moves in, Escape closes, focus returns on close. */
export function Modal({ title, onClose, children, wide }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, [tabindex="0"]');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
      <motion.div
        className={`modal ${wide ? 'modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
      >
        <div className="modal__head">
          <h2>{title}</h2>
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
        <div className="modal__body">{children}</div>
      </motion.div>
    </motion.div>
  );
}
