import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'glass' | 'glass-elevated' | 'solid' | 'outline';
  padding?: 'none' | 'xs' | 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  className?: string;
}

const Card: React.FC<CardProps> = ({
  variant = 'glass',
  padding = 'md',
  children,
  className = '',
  ...props
}) => {
  const variantStyles = {
    glass: 'glass-card backdrop-blur-md',
    'glass-elevated': 'glass-card-elevated backdrop-blur-md',
    solid: 'bg-[var(--surface-card)] border border-[var(--surface-border)] shadow-premium',
    outline: 'border border-[var(--surface-border)] bg-transparent',
  }[variant];

  const paddingStyles = {
    none: 'p-0',
    xs: 'p-3',
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  }[padding];

  return (
    <div className={`${variantStyles} ${paddingStyles} ${className}`} {...props}>
      {children}
    </div>
  );
};

export default Card;
export { Card };
