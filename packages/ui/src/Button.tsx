import React from 'react';
import { THEME } from './theme';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'danger' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  uppercase?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  uppercase = false,
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const variantStyles = {
    primary: THEME.CLASSES.BUTTON_PRIMARY,
    danger: THEME.CLASSES.BUTTON_DANGER,
    outline:
      'border border-[var(--surface-border)] hover:bg-[var(--surface-card)] text-[var(--surface-foreground)]',
    ghost: 'hover:bg-[var(--surface-card)] text-[var(--surface-foreground)]/70 hover:text-[var(--surface-foreground)]',
  }[variant];

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-6 py-4 text-sm',
    lg: 'px-8 py-5 text-base',
  }[size];

  return (
    <button
      {...props}
      className={`
        flex items-center justify-center gap-2 rounded-sm transition-all group
        ${variantStyles} 
        ${sizeStyles} 
        ${fullWidth ? 'w-full' : ''} 
        ${uppercase ? 'uppercase' : ''} 
        ${loading || disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} 
        ${className}
      `}
      disabled={loading || disabled}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {!loading && icon}
      <span className={loading ? 'opacity-0' : ''}>{children}</span>
    </button>
  );
};

export default Button;
export { Button };
