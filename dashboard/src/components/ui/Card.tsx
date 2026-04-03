import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'glass' | 'solid' | 'outline';
  padding?: 'none' | 'sm' | 'md' | 'lg';
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
    solid: 'bg-black/40 border border-white/5',
    outline: 'border border-white/10 bg-transparent',
  }[variant];

  const paddingStyles = {
    none: 'p-0',
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
