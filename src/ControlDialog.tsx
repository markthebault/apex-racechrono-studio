import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { TouchButton } from "./TouchButton";

/** Secondary controls live in a modal, leaving the working surface clear. */
export function ControlDialog({
  label,
  title = label,
  children,
}: {
  label: string;
  title?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => setOpen(false);
  useLayoutEffect(() => {
    const el = dialog.current!;
    if (open) el.showModal();
    else if (el.open) {
      el.close();
      trigger.current?.querySelector("button")?.focus();
    }
  }, [open]);
  useEffect(() => {
    const el = dialog.current!;
    return () => el.close();
  }, []);
  return (
    <div className="control-dialog-trigger" ref={trigger}>
      <TouchButton
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {label}
      </TouchButton>
      <dialog
        ref={dialog}
        className="control-dialog"
        aria-labelledby={id}
        onClose={() => {
          close();
          if (!document.querySelector("dialog[open]"))
            trigger.current?.querySelector("button")?.focus();
        }}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const rect = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < rect.left ||
              event.clientX > rect.right ||
              event.clientY < rect.top ||
              event.clientY > rect.bottom
            )
              close();
          }
        }}
      >
        <div className="control-dialog-heading">
          <h2 id={id}>{title}</h2>
          <TouchButton aria-label={`Close ${title}`} onClick={close}>
            <X size={20} />
          </TouchButton>
        </div>
        <div className="control-dialog-body">
          {typeof children === "function" ? children(close) : children}
        </div>
      </dialog>
    </div>
  );
}
