import React, { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label className="block text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
            {label}
          </label>
        )}
        <input
          {...props}
          ref={ref}
          className={`
          w-full bg-input border border-input rounded-lg px-4 py-2.5
          text-foreground text-sm placeholder:text-muted-more
          focus:outline-none focus:border-cyber-blue/50 focus:ring-1 focus:ring-cyber-blue/20
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
