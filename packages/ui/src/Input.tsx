import React, { forwardRef } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--text-muted)]">
            {label}
          </label>
        )}
        <input
          {...props}
          ref={ref}
          className={`
          w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-sm px-4 py-2.5
          text-[var(--surface-foreground)] text-sm placeholder:text-[var(--text-muted-more)]
          focus:outline-none focus:border-brand-secondary/50 focus:ring-1 focus:ring-brand-secondary/20
          transition-all
          ${error ? 'border-red-500/50' : ''}
          ${className}
        `}
        />
        {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;
export { Input };
